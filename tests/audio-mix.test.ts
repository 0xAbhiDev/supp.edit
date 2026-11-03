import { describe, it, expect } from "vitest";
import capture from "./fixtures/gym-analysis.json";
import {
  newProject,
  assetSchema,
  parseProject,
  type Project,
} from "../packages/project-schema";
import {
  analysisResultSchema,
  defaultAnalysisSettings,
  type MediaAnalysis,
} from "../packages/ai/media-analysis/model";
import { parseEditBrief, routeRequest } from "../packages/ai/rough-cut/model";
import { buildRoughCut, rankMoments } from "../packages/ai/rough-cut/planner";
import {
  gainEnvelope,
  mixAestheticAudio,
} from "../packages/ai/rough-cut/audio";
import { evaluate } from "../packages/animation";
import { History } from "../packages/commands";
import { setProperty } from "../packages/commands/animation";
import { inComposition } from "../packages/commands/compositions";
import {
  previewEditPlan,
  applyEditPreview,
} from "../packages/ai/editor-agent/execution";
import { planAudioRevision } from "../packages/ai/revisions/audio";
function setup(speech = true, music = true) {
  const p = newProject("Audio mix", 320, 180);
  p.assets = capture.assets.map((a) => assetSchema.parse(a));
  const analyses = capture.analyses.map((a) => analysisResultSchema.parse(a));
  const brief = parseEditBrief(
      "Create a 25-second dark aesthetic gym Reel with speed ramps and captions",
    ),
    evidence = rankMoments(p, analyses, brief);
  const cut = buildRoughCut(
    p,
    0,
    brief,
    evidence,
    music ? p.assets.find((a) => a.kind === "audio")! : null,
    music ? analyses.find((a) => a.audio)!.audio!.beatMap : null,
  );
  const shot = cut.shots.find((s) =>
    cut.ramps.some((r) => r.candidateId === s.candidate.id),
  )!;
  p.assets = p.assets.map((a) =>
    a.kind === "video"
      ? { ...a, hasAudio: a.id === shot.candidate.assetId }
      : a,
  );
  const asset = p.assets.find((a) => a.id === shot.candidate.assetId)!,
    start = ((shot.sourceIn + shot.duration * 0.25) / 30) * 1000,
    end = ((shot.sourceIn + shot.duration * 0.6) / 30) * 1000;
  const spoken = analysisResultSchema.parse({
    assetId: asset.id,
    fingerprint: asset.fingerprint,
    cacheKey: "b".repeat(64),
    algorithm: "media-analysis-1",
    processing: "LOCAL",
    durationMs: Math.round(asset.duration * 1000),
    settings: defaultAnalysisSettings("speech"),
    speechDetected: speech,
    ...(speech
      ? {
          transcript: {
            id: "test-transcript",
            name: "Synthetic timing fixture",
            source: "transcription",
            assetId: asset.id,
            sourceFingerprint: asset.fingerprint,
            segments: [
              {
                id: "one",
                startMs: Math.round(start),
                endMs: Math.round(end),
                text: "Keep my voice clear",
                words: [
                  {
                    text: "Keep",
                    startMs: Math.round(start),
                    endMs: Math.round(start + 100),
                  },
                ],
              },
            ],
          },
        }
      : {}),
  });
  const audio: MediaAnalysis = {
    ...analyses.find((a) => a.audio)!,
    assetId: asset.id,
    fingerprint: asset.fingerprint,
  };
  const mixed = mixAestheticAudio(p, cut, [...analyses, spoken, audio]);
  mixed.plan.commands.push({
    tool: "sequence.remember",
    sequenceId: mixed.plan.resultCompositionId!,
  });
  return { p, cut: mixed, shot };
}
const apply = (
  p: Project,
  preview: ReturnType<typeof previewEditPlan>,
  h: History,
) => h.execute(p, "Apply", applyEditPreview(preview, p, 0));
describe("Speech-aware mix uses normal editable automation (synthetic speech timing)", () => {
  it("keeps mid-clip speech normal-speed, ducks only its ranges, and supports preview/Apply/Undo/Redo/save", () => {
    const { p, cut, shot } = setup(),
      preview = previewEditPlan(cut.plan, p, 0),
      h = new History(p),
      result = apply(p, preview, h),
      sequence = result.compositions[0];
    const clip = sequence.layers.find(
        (c) =>
          c.start === shot.startFrame &&
          c.kind === "media" &&
          c.assetId === shot.candidate.assetId,
      )!,
      music = sequence.layers.find(
        (c) => p.assets.find((a) => a.id === c.assetId)?.kind === "audio",
      )!;
    expect(clip.timeRemap).toBeUndefined();
    expect(
      cut.ramps.find((r) => r.candidateId === shot.candidate.id)?.enabled,
    ).toBe(false);
    expect(sequence.layers.some((c) => c.kind === "text")).toBe(true);
    expect(
      evaluate(
        music.keyframes.gain,
        shot.startFrame + shot.duration * 0.25 + 1,
        music.gain,
      ),
    ).toBeCloseTo(music.gain - 8);
    expect(evaluate(music.keyframes.gain, 0, music.gain)).toBe(-60);
    expect(parseProject(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(h.undo(result)).toEqual(p);
    expect(h.redo(p)).toEqual(result);
  });
  it("handles music-only and source-only mixes without inventing speech", () => {
    for (const [speech, music] of [
      [false, true],
      [true, false],
    ] as const) {
      const { p, cut } = setup(speech, music),
        preview = previewEditPlan(cut.plan, p, 0);
      expect(cut.audio?.speechClips).toBe(speech ? 1 : 0);
      expect(cut.audio?.duckedRanges).toBe(0);
      expect(
        preview.project.compositions[0].layers.some((l) => l.kind === "text"),
      ).toBe(speech);
      if (!speech) expect(cut.audio?.suppressedSources).toBeGreaterThan(0);
    }
  });
  it("preserves manually edited gain keys across remove/reapply ducking and routes the five audio requests", () => {
    const { p, cut } = setup(),
      h = new History(p);
    let current = apply(p, previewEditPlan(cut.plan, p, 0), h);
    const c = current.compositions[0],
      music = c.layers.find(
        (l) => p.assets.find((a) => a.id === l.assetId)?.kind === "audio",
      )!;
    current = h.execute(
      current,
      "Manual gain",
      inComposition(c.id, setProperty(music.id, "gain", -17.25, 70)),
    );
    for (const request of [
      "Remove the ducking.",
      "Lower the music when I speak.",
    ]) {
      expect(routeRequest(request)).toBe("revision");
      current = apply(current, planAudioRevision(request, current, 0, c.id), h);
      expect(
        current.compositions[0].layers
          .find((l) => l.id === music.id)!
          .keyframes.gain.find((k) => k.frame === 70)?.value,
      ).toBe(-17.25);
    }
    for (const request of [
      "Keep the music loud but make my voice clear.",
      "Make the music louder.",
      "Keep original gym sounds.",
    ]) {
      expect(routeRequest(request)).toBe("revision");
      current = apply(current, planAudioRevision(request, current, 0, c.id), h);
    }
    expect(parseProject(JSON.parse(JSON.stringify(current)))).toEqual(current);
  });
  it("smoothly restores music between separated phrases and does not pump between close phrases", () => {
    const keys = gainEnvelope(
      300,
      30,
      -12,
      [
        { start: 60, end: 90 },
        { start: 96, end: 120 },
        { start: 210, end: 240 },
      ],
      8,
      0.25,
    );
    expect(evaluate(keys, 93, -12)).toBe(-20);
    expect(evaluate(keys, 165, -12)).toBe(-12);
    expect(evaluate(keys, 225, -12)).toBe(-20);
    expect(evaluate(keys, 58, -12)).toBeLessThan(-12);
    expect(evaluate(keys, 245, -12)).toBeGreaterThan(-20);
  });
});
