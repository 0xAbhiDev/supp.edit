import { expect, it } from "vitest";
import { assessReferenceText } from "../packages/ai/reference/text-evidence";
import { measureTextDepth } from "../packages/ai/reference/text-depth";
import {
  projectInk,
  visiblePicture,
} from "../packages/ai/reference/text-layout";
import { createTypography } from "../packages/typography/commands";
import {
  stabilize,
  editablePersonMask,
  type PersonSample,
} from "../packages/ai/reference/subject-mask";
import { referenceLayer } from "../packages/commands/reference-layers";
import {
  newProject,
  newClip,
  parseProject,
  assetSchema,
} from "../packages/project-schema";
import { newMask } from "../packages/masks/model";
import { resolveMask } from "../packages/masks/evaluate";
import { History } from "../packages/commands";
import {
  batchCompositionEdits,
  inComposition,
} from "../packages/commands/compositions";
import type { Transcript } from "../packages/ai/transcript";
import type { TextAppearance } from "../packages/ai/reference/appearance";

const line = (
  content: string,
  extra: Partial<TextAppearance> = {},
): TextAppearance => ({
  content,
  startMs: 1000,
  endMs: 2000,
  x: 0.1,
  y: 0.2,
  width: 0.4,
  height: 0.1,
  words: content.split(" ").length,
  observations: 3,
  passAgreements: 2,
  ...extra,
});
const transcript = {
  segments: [
    {
      text: "♪ PUSH HARD ♪",
      startMs: 1000,
      endMs: 2000,
      words: [
        { text: "PUSH", startMs: 1050, endMs: 1300, confidence: 0.92 },
        { text: "HARD", startMs: 1320, endMs: 1700, confidence: 0.91 },
      ],
    },
  ],
} as Transcript;
it("requires exact visible and timed audio agreement and never fills missing words", () => {
  const result = assessReferenceText(
    [
      line("PUSH HARD"),
      line("PUSH HARP", { passAgreements: 0 }),
      line("fAk3", { observations: 10, passAgreements: 10 }),
    ],
    transcript,
  );
  expect(result[0].evidence).toMatchObject({
    status: "audio-visual",
    kind: "captioned-lyrics",
    wordStartsMs: [1050, 1320],
  });
  expect(result.slice(1).map((l) => l.evidence?.status)).toEqual([
    "uncertain",
    "uncertain",
  ]);
  expect(result[1].content).toBe("PUSH HARP");
  expect(
    assessReferenceText(
      [line("PUSH", { startMs: 6000, endMs: 7000, passAgreements: 0 })],
      transcript,
    )[0].evidence?.status,
  ).toBe("uncertain");
});
it("confirms a line read identically over many frames even when only one OCR pass reads it", () => {
  const result = assessReferenceText([
    line("NEW HEIGHTS", { observations: 12, passAgreements: 0 }),
    line("we", { observations: 6, passAgreements: 0 }),
    line("FALLS", { observations: 3, passAgreements: 0 }),
  ]);
  expect(result.map((l) => l.evidence?.status)).toEqual(["visual-consensus", "uncertain", "uncertain"]);
});
it("keeps reliable titles separate from vocals and marks repeated edge labels uncertain", () => {
  const result = assessReferenceText([
    line("OPENING DAY"),
    line("CREATOR", { role: "persistent-overlay" }),
  ]);
  expect(result.map((l) => l.evidence?.kind)).toEqual(["title", "label"]);
  expect(result[1].evidence?.status).toBe("uncertain");
});
const points: PersonSample["points"] = Array.from({ length: 96 }, (_, i) => [
  0.5 + 0.2 * Math.cos((i * Math.PI) / 48),
  0.5 + 0.3 * Math.sin((i * Math.PI) / 48),
]);
it("aligns contour phase before interpolation and does not bridge a missing subject", () => {
  const shifted = [...points.slice(19), ...points.slice(0, 19)];
  const samples = stabilize([
    { timeMs: 0, points },
    { timeMs: 100, points: shifted },
    { timeMs: 200, points: [] },
    { timeMs: 300, points: shifted },
  ]);
  expect(samples[1].points[0][0]).toBeCloseTo(points[0][0]);
  expect(samples[2].points).toEqual([]);
  expect(samples[3].points).toEqual(shifted);
});
const asset = assetSchema.parse({
  id: "raw",
  path: "independent.mp4",
  name: "Raw",
  kind: "video",
  width: 1920,
  height: 1080,
  duration: 10,
  fps: 30,
  codec: "h264",
  hasAudio: true,
  fingerprint: "raw-only",
  size: 100,
});
function fixture() {
  const p = newProject("Editable layering", 1080, 1920);
  p.assets = [asset];
  const c = newClip(p.tracks[0].id, 0, 30, "media", asset);
  p.clips = [c];
  return { p, c, h: new History(p) };
}
it("requires repeated loss of expected ink inside the person, not just intersecting rectangles", () => {
  const filled = Array(16).fill(0xffffffff);
  const people = [0, 125].map((timeMs) => ({
    timeMs,
    points: [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ] as PersonSample["points"],
  }));
  const trial = (bits: number, observations = 2) =>
    measureTextDepth(
      line("TITLE", {
        face: { family: "Arial", weight: "700", fit: 0.9 },
        templateRows: filled,
        geometry: people
          .slice(0, observations)
          .map(({ timeMs }) => ({
            timeMs,
            x: 0,
            y: 0.25,
            width: 1,
            height: 0.5,
            rows: Array(16).fill(bits),
          })),
      }),
      people,
    ).depth?.relation;
  expect(trial(0xffff0000)).toBe("behind");
  expect(trial(0xffffffff)).toBe("front");
  expect(trial(0xffff0000, 1)).toBe("unknown");
  expect(trial(0)).toBe("unknown");
});
it("maps reference ink to the uncropped foreground and stores its movement without preset fades", () => {
  const { p, c, h } = fixture();
  c.crop.cropTop = 0.4;
  c.crop.cropBottom = 0.4;
  const picture = visiblePicture(p, c, asset, 0)!;
  expect(picture.top).toBeCloseTo(768);
  expect(picture.bottom).toBeCloseTo(1152);
  const box = projectInk(
    p,
    picture,
    { x: 0.25, y: 0.25, width: 0.5, height: 0.25 },
    true,
  )!;
  expect(box.y).toBeCloseTo(-48);
  expect(box.height).toBeCloseTo(96);
  const after = h.execute(
    p,
    "Original lettering",
    createTypography({
      tool: "text.create",
      trackId: "type",
      id: "caption",
      start: 0,
      duration: 16,
      style: "Bold",
      treatment: "Pop",
      timing: "manual",
      content: "TEST",
      face: { family: "Arial", weight: "700" },
      measuredInk: {
        widthEm: 3,
        heightEm: 0.75,
        centerXEm: 0,
        centerYEm: 0,
        samples: [
          { frame: 0, ...box },
          { frame: 8, ...box, x: 65, width: 270 },
        ],
      },
    }),
  );
  const title = after.clips.at(-1)!;
  expect(title.text.size * title.transform.scaleX * 3).toBeCloseTo(540);
  expect(title.keyframes.opacity).toEqual([]);
  expect(title.keyframes.x.at(-1)?.value).toBe(65);
  expect(
    title.keyframes.scaleX.at(-1)!.value * title.text.size * 3,
  ).toBeCloseTo(270);
  expect(parseProject(JSON.parse(JSON.stringify(after)))).toEqual(after);
});
it("maps source masks into fitted composition coordinates and gates subject exit", () => {
  const { c } = fixture();
  const samples = Array.from({ length: 11 }, (_, i) => ({
    timeMs: i * 100,
    points: i >= 5 ? [] : points,
  }));
  const mask = editablePersonMask(samples, c, asset, 1080, 1920, 30)!;
  expect(mask.vertices[0].x).toBeCloseTo(0.7);
  expect(Math.max(...mask.vertices.map((v) => v.y))).toBeLessThan(0.6);
  expect(resolveMask(mask, 0).opacity).toBe(1);
  expect(resolveMask(mask, 29).opacity).toBe(0);
  expect(mask.pathKeys.length).toBeLessThanOrEqual(128);
});
it("preserves timing, raw-only assets and editable masks through apply undo redo and serialization", () => {
  const { p, c, h } = fixture();
  c.sourceIn = 60;
  const mask = newMask();
  const after = h.execute(
    p,
    "Layered reference",
    batchCompositionEdits((d) => {
      referenceLayer({
        tool: "sequence.backgroundFill",
        sequenceId: "unused",
        sourceId: c.id,
        id: "fill",
        trackId: "back",
        blur: 24,
      })(d);
      referenceLayer({
        tool: "sequence.subjectLayer",
        sequenceId: "unused",
        sourceId: c.id,
        id: "person",
        trackId: "front",
        mask,
      })(d);
    }),
  );
  expect(after.tracks.map((t) => t.id).indexOf("front")).toBe(0);
  expect(after.tracks.find((t) => t.id === "back")?.muted).toBe(true);
  expect(after.tracks.find((t) => t.id === "front")?.muted).toBe(true);
  expect(
    after.clips.every((l) => l.assetId === asset.id && l.sourceIn === 60),
  ).toBe(true);
  expect(
    (after.clips.find((l) => l.id === "fill")!.transform.scale * 1080 * 1080) /
      1920,
  ).toBeGreaterThanOrEqual(1920);
  expect(after.clips.find((l) => l.id === "person")?.masks).toEqual([mask]);
  expect(parseProject(JSON.parse(JSON.stringify(after)))).toEqual(after);
  expect(h.undo(after)).toEqual(p);
  expect(h.redo(p)).toEqual(after);
});
it("rejects an invalid final compound edit without changing history or source state", () => {
  const { p, h } = fixture();
  expect(() =>
    h.execute(
      p,
      "Invalid batch",
      batchCompositionEdits((d) => {
        inComposition(null, (v) => {
          v.clips[0].duration = -1;
        })(d);
      }),
    ),
  ).toThrow();
  expect(p.clips[0].duration).toBe(30);
  expect(h.past).toHaveLength(0);
});
it("fills from the active picture rather than magnifying encoded black bars", () => {
  const { p, c, h } = fixture();
  const pictureHeight = (1080 * 1080) / 1920;
  c.keyframes.cropTop = [
    { frame: 0, value: 0.5 - (0.375 * pictureHeight) / 1920, easing: "linear" },
  ];
  c.keyframes.cropBottom = [...c.keyframes.cropTop];
  const after = h.execute(
    p,
    "Fill active picture",
    referenceLayer({
      tool: "sequence.backgroundFill",
      sequenceId: "unused",
      sourceId: c.id,
      id: "fill",
      trackId: "back",
      blur: 24,
    }),
  );
  const fill = after.clips.at(-1)!;
  expect(fill.crop.cropTop).toBeCloseTo(c.keyframes.cropTop[0].value);
  expect(fill.transform.scale * pictureHeight * 0.75).toBeGreaterThanOrEqual(
    1920,
  );
  expect(fill.transform.y).toBeCloseTo(0);
  expect(fill.assetId).toBe(asset.id);
});
