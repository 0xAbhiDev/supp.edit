import { it, expect } from "vitest";
import {
  newProject,
  newClip,
  parseProject,
  projectSchema,
} from "../packages/project-schema";
import { History } from "../packages/commands";
import { applyEditPreview } from "../packages/ai/editor-agent/execution";
import { planTypography } from "../packages/typography/planner";
import { animateText, styleText } from "../packages/typography/treatments";
import { textTreatments, typographyStyles } from "../packages/typography/model";
import { resolveClip } from "../packages/animation";
import { strongEvents } from "../packages/ai/rough-cut/beats";
import capture from "./fixtures/gym-analysis.json";
import { analysisResultSchema } from "../packages/ai/media-analysis/model";
const analyses = capture.analyses.map((a) => analysisResultSchema.parse(a));
function project() {
  const p = newProject("Typography", 360, 640);
  p.assets = capture.assets as typeof p.assets;
  const music = p.assets.find((a) => a.kind === "audio")!;
  const c = newClip(p.tracks[1].id, 0, 300);
  c.assetId = music.id;
  c.sourceIn = 30;
  p.clips = [c];
  return p;
}
it("uses actual source-offset music events, sparse phrases, ordinary history and lossless persistence", () => {
  const p = project(),
    h = new History(p),
    preview = planTypography(
      "Add aggressive motivational kinetic typography with strong music events",
      p,
      0,
      null,
      analyses,
    );
  expect(preview.plan.commands.length).toBeGreaterThan(1);
  expect(preview.plan.commands.length).toBeLessThanOrEqual(3);
  const music = p.clips[0],
    map = analyses.find((a) => a.assetId === music.assetId && a.audio)!.audio!
      .beatMap;
  for (const c of preview.plan.commands) {
    if (c.tool !== "text.create") throw Error();
    expect(
      strongEvents(map).some(
        (e) => Math.round(e.timeMs * 0.03) - 30 === c.start + (c.cueFrame ?? 0),
      ),
    ).toBe(true);
    expect(c.style).toBe("Aggressive");
    const rendered = preview.project.clips.find((x) => x.id === c.id)!;
    expect(
      resolveClip(rendered, c.start + (c.cueFrame ?? 0)).text.highlight,
    ).toBe(rendered.text.content.trim().split(/\s+/).length - 1);
  }
  const next = h.execute(p, "Typography", applyEditPreview(preview, p, 0));
  expect(
    next.clips
      .filter((c) => c.kind === "text")
      .every((c) => c.text.emphasis.length && c.keyframes.opacity.length),
  ).toBe(true);
  expect(h.undo(next)).toEqual(p);
  expect(h.redo(p)).toEqual(next);
  expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next);
  expect(() =>
    planTypography("Add typography with music", p, 0, null, []),
  ).toThrow(/measured/);
  expect(() => applyEditPreview(preview, next, 1)).toThrow(/changed/);
});
it("maps actual supplied word timestamps through source trim and refuses invented karaoke timing", () => {
  const p = project(),
    asset = p.assets.find((a) => a.kind === "video")!;
  const c = newClip(p.tracks[0].id, 0, 180);
  c.assetId = asset.id;
  c.sourceIn = 30;
  p.clips = [c];
  // Explicit controlled timestamp fixture, not an inference claim.
  p.transcripts = [
    {
      id: "t",
      name: "controlled timings",
      source: "transcription",
      assetId: asset.id,
      sourceFingerprint: asset.fingerprint,
      segments: [
        {
          id: "s",
          startMs: 1500,
          endMs: 3500,
          text: "STAY STRONG",
          words: [
            { text: "STAY", startMs: 1500, endMs: 2100 },
            { text: "STRONG", startMs: 2400, endMs: 3500 },
          ],
        },
      ],
    },
  ];
  const preview = planTypography(
      "Karaoke highlight typography from speech",
      p,
      0,
      null,
      [],
    ),
    c2 = preview.project.clips.find((c) => c.kind === "text")!;
  expect(c2.start).toBe(15);
  expect(c2.duration).toBe(60);
  expect(c2.keyframes.highlight.map((k) => k.frame)).toEqual([0, 27]);
  expect(resolveClip(c2, 15).text.highlight).toBe(0);
  expect(resolveClip(c2, 42).text.highlight).toBe(1);
  const missing = structuredClone(p);
  missing.transcripts[0].segments[0].words = undefined;
  expect(() =>
    planTypography(
      "Karaoke highlight typography from speech",
      missing,
      0,
      null,
      [],
    ),
  ).toThrow(/word timestamps/);
});
it("all treatments and styles create distinct valid editable render state without mutating source while resolving", () => {
  const signatures = new Set<string>();
  for (const style of typographyStyles) {
    const p = project(),
      c = newClip(p.tracks[0].id, 0, 60, "text");
    c.text.content = "ONE MORE REP";
    styleText(c, style, 360, 640);
    signatures.add(JSON.stringify(c.text));
  }
  expect(signatures.size).toBe(10);
  for (const treatment of textTreatments) {
    const p = project(),
      c = newClip(p.tracks[0].id, 0, 60, "text");
    c.text.content = "ONE MORE REP";
    styleText(c, "Aggressive", 360, 640, treatment);
    animateText(c, treatment, 30, [0, 15, 30]);
    p.clips = [c];
    projectSchema.parse(p);
    const before = JSON.stringify(c);
    for (const f of [0, 3, 10, 20, 40, 59]) resolveClip(c, f);
    expect(JSON.stringify(c)).toBe(before);
    expect(c.keyframes.opacity.length).toBeGreaterThan(1);
  }
});
it("places titles below a tall person's upper body when both safe bands intersect the detection", () => {
  const p = project(),
    row = p.assets.find((a) => a.id === "gym-fixture-row")!;
  const clip = newClip(p.tracks[0].id, 0, 150);
  clip.assetId = row.id;
  // Reproduce the full-height person from the row shot in portrait framing.
  clip.transform.scale =
    640 / row.height / Math.min(360 / row.width, 640 / row.height);
  p.clips.push(clip);
  const preview = planTypography(
    "Aggressive kinetic typography at the opening hook",
    p,
    0,
    null,
    analyses,
  );
  const text = preview.project.clips.find((c) => c.kind === "text")!;
  expect(text.transform.y).toBeGreaterThan(0);
});
