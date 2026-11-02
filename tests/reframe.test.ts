import { it, expect } from "vitest";
import {
  newProject,
  newClip,
  newTrack,
  assetSchema,
  parseProject,
} from "../packages/project-schema";
import { History } from "../packages/commands";
import { newMask } from "../packages/masks/model";
import { applyEditPreview } from "../packages/ai/editor-agent/execution";
import {
  associate,
  cameraPath,
  reduceKeys,
} from "../packages/ai/reframe/tracking";
import {
  subjectSamplesSchema,
  reframeRequest,
  type SubjectSamples,
} from "../packages/ai/reframe/model";
import { planReframe } from "../packages/ai/reframe/planner";
import { VISION_MODEL_VERSION } from "../packages/ai/media-analysis/model";
function person(x = 0.4, white = 0) {
  return {
    confidence: 0.9,
    bounds: { x, y: 0.12, width: 0.15, height: 0.75 },
    whiteTorsoFraction: white,
  };
}
function evidence(): SubjectSamples {
  return {
    assetId: "video",
    fingerprint: "fingerprint",
    cacheKey: "a".repeat(64),
    algorithm: "subject-samples-1",
    modelVersion: VISION_MODEL_VERSION,
    processing: "LOCAL",
    device: "CPU",
    width: 960,
    height: 540,
    sampling: { startMs: 0, endMs: 3000, intervalMs: 250 },
    samples: Array.from({ length: 12 }, (_, i) => ({
      timeMs: i * 250,
      people: [person(0.2 + i * 0.025)],
    })),
  };
}
function setup() {
  const p = newProject("Camera", 1920, 1080);
  p.assets = [
    assetSchema.parse({
      id: "video",
      name: "Real source",
      fingerprint: "fingerprint",
      kind: "video",
      path: "source.webm",
      duration: 10,
      size: 100,
      width: 960,
      height: 540,
      fps: 30,
      hasAudio: false,
      codec: "vp9",
    }),
  ];
  const track = newTrack("video", 1),
    clip = newClip(track.id, 0, 90, "media");
  clip.assetId = "video";
  clip.masks = [newMask()];
  clip.effects.contrast = 1.2;
  p.compositions = [
    {
      id: "sequence",
      name: "Original",
      settings: p.settings,
      duration: 90,
      background: "#000000",
      tracks: [track],
      layers: [clip],
    },
  ];
  return { p, clip, map: new Map([[clip.id, evidence()]]) };
}
it("routes framing requests without misrouting new creative briefs", () => {
  for (const request of [
    "Make this vertical",
    "Make it a Reel",
    "Make this 9:16",
    "Keep me centered",
    "Track the person in a white shirt",
    "Keep both visible",
  ])
    expect(reframeRequest.test(request), request).toBe(true);
  expect(
    reframeRequest.test("Create a 25-second dark aesthetic gym Reel"),
  ).toBe(false);
});
it("associates a subject through temporary occlusion without selecting a distant bystander", () => {
  const data = evidence();
  data.samples[4].people = [person(0.8)];
  data.samples[5].people = [];
  const result = associate(data, "main");
  expect(result.uncertain).toBe(true);
  expect(result.samples[4].box.x).toBeCloseTo(
    data.samples[3].people[0].bounds.x,
  );
  expect(result.samples[6].box.x).toBeCloseTo(
    data.samples[6].people[0].bounds.x,
  );
});
it("white selection requires distinct measured torso evidence and both requires two people", () => {
  const data = evidence();
  expect(() => associate(data, "white-shirt")).toThrow(/unambiguous/);
  expect(() => associate(data, "both")).toThrow(/Two people/);
  data.samples = data.samples.map((s) => ({
    ...s,
    people: [person(0.2, 0.05), person(0.6, 0.9)],
  }));
  expect(associate(data, "white-shirt").samples[0].box.x).toBe(0.6);
  expect(associate(data, "both").samples[0].box.width).toBeCloseTo(0.55);
});
it("produces bounded reduced smooth keys, fixed locked camera, and honest letterboxing", () => {
  const data = evidence(),
    smooth = cameraPath(data, 30, 90, 1080, 1920),
    locked = cameraPath(data, 30, 90, 1080, 1920, "locked");
  expect(smooth.x.length).toBeGreaterThan(2);
  expect(smooth.x.length).toBeLessThan(40);
  expect(smooth.x.at(-1)!.value).toBeLessThan(smooth.x[0].value);
  expect(new Set(locked.x.map((k) => k.value)).size).toBe(1);
  expect(smooth.scale[0].value).toBeGreaterThan(1);
  const both = evidence();
  both.samples = both.samples.map((s) => ({
    ...s,
    people: [person(0.05), person(0.8)],
  }));
  expect(cameraPath(both, 30, 90, 1080, 1920, "smooth", "both").letterbox).toBe(
    true,
  );
});
it("key reduction stays within its tolerance at every source frame", () => {
  const values = Array.from({ length: 300 }, (_, i) => Math.sin(i / 25) * 40);
  const keys = reduceKeys(values, 0.25);
  for (let i = 0; i < values.length; i++) {
    const a = keys.filter((k) => k.frame <= i).at(-1)!,
      b = keys.find((k) => k.frame >= i)!;
    const value =
      a === b
        ? a.value
        : a.value + ((b.value - a.value) * (i - a.frame)) / (b.frame - a.frame);
    expect(Math.abs(value - values[i])).toBeLessThanOrEqual(0.250001);
  }
});
it("creates a separate portrait graph, preserves edits, and exactly undoes/redoes/save-reopens", () => {
  const { p, clip, map } = setup(),
    h = new History(p),
    preview = planReframe("Make this vertical", p, 0, "sequence", map);
  const result = h.execute(p, "Reframe", applyEditPreview(preview, p, 0));
  expect(result.compositions).toHaveLength(2);
  expect(result.compositions[0]).toEqual(p.compositions[0]);
  const next = result.compositions[1];
  expect(next.settings.width / next.settings.height).toBe(9 / 16);
  expect(next.layers[0].id).not.toBe(clip.id);
  expect(next.layers[0].masks[0].id).not.toBe(clip.masks[0].id);
  expect(next.layers[0].effects).toEqual(clip.effects);
  expect(next.layers[0].keyframes.x.length).toBeGreaterThan(0);
  expect(h.undo(result)).toEqual(p);
  expect(h.redo(p)).toEqual(result);
  expect(parseProject(JSON.parse(JSON.stringify(result)))).toEqual(result);
});
it("in-place framing preserves clip IDs and rejects stale, locked or dependent geometry", () => {
  const { p, clip, map } = setup();
  const preview = planReframe(
    "Make this vertical in place",
    p,
    0,
    "sequence",
    map,
  );
  expect(preview.project.compositions).toHaveLength(1);
  expect(preview.project.compositions[0].layers[0].id).toBe(clip.id);
  const bad = structuredClone(p);
  bad.compositions[0].layers[0].transform.rotation = 5;
  expect(() =>
    planReframe("Make this vertical", bad, 0, "sequence", map),
  ).toThrow(/geometry/);
  const stale = structuredClone(evidence());
  stale.fingerprint = "changed";
  expect(() =>
    planReframe(
      "Make this vertical",
      p,
      0,
      "sequence",
      new Map([[clip.id, stale]]),
    ),
  ).toThrow(/source/);
});
it("rejects unordered and out-of-range evidence", () => {
  const data = evidence();
  data.samples.reverse();
  expect(subjectSamplesSchema.safeParse(data).success).toBe(false);
});
it("holds stationary subjects without camera jitter through low confidence and missing detections", () => {
  const data = evidence();
  data.samples.forEach((s, i) => {
    s.people = [person(0.4 + Math.sin(i) * 0.001)];
  });
  data.samples[4].people[0].confidence = 0.2;
  data.samples[5].people = [];
  const track = associate(data, "main"),
    path = cameraPath(data, 30, 90, 1080, 1920);
  expect(track.uncertain).toBe(true);
  expect(track.samples[4].box).toEqual(track.samples[3].box);
  expect(track.samples[5].box).toEqual(track.samples[3].box);
  expect(
    Math.max(...path.x.map((k) => k.value)) -
      Math.min(...path.x.map((k) => k.value)),
  ).toBeLessThan(3);
});
it("rapid ambiguous displacement holds the last subject instead of jumping to a new person", () => {
  const data = evidence();
  data.samples.forEach((s, i) => {
    s.people = [person(i < 4 ? 0.2 : i < 8 ? 0.75 : 0.22)];
  });
  const track = associate(data, "main"),
    path = cameraPath(data, 30, 90, 1080, 1920);
  expect(track.uncertain).toBe(true);
  for (let i = 4; i < 8; i++) expect(track.samples[i].box.x).toBe(0.2);
  expect(track.samples[8].box.x).toBe(0.22);
  expect(
    Math.max(...path.x.map((k) => k.value)) -
      Math.min(...path.x.map((k) => k.value)),
  ).toBeLessThan(100);
});
it("rejects nonfinite detections and framing keys before they can enter project history", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const data = evidence();
    data.samples[0].people[0].bounds.x = invalid;
    expect(() => cameraPath(data, 30, 90, 1080, 1920)).toThrow();
    const { p } = setup();
    p.compositions[0].layers[0].keyframes.x = [
      { frame: 0, value: invalid, easing: "linear" },
    ];
    expect(() => parseProject(p)).toThrow();
  }
});
