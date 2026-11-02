import { describe, it, expect } from "vitest";
import capture from "./fixtures/gym-analysis.json";
import {
  assetSchema,
  fps,
  newProject,
  parseProject,
} from "../packages/project-schema";
import {
  analysisResultSchema,
  type BeatMap,
} from "../packages/ai/media-analysis/model";
import { parseEditBrief } from "../packages/ai/rough-cut/model";
import { gymStyles, gymStyleSchema } from "../packages/ai/rough-cut/styles";
import { rankMoments, buildRoughCut } from "../packages/ai/rough-cut/planner";
import { rankHooks } from "../packages/ai/rough-cut/hooks";
import { musicEvents } from "../packages/ai/rough-cut/music";
import { History } from "../packages/commands";
import {
  previewEditPlan,
  applyEditPreview,
} from "../packages/ai/editor-agent/execution";
const acceptance =
  "Create a 25-second dark aesthetic Instagram gym Reel from my best footage. Start with the strongest shot, keep me centered in 9:16, sync important cuts to the music, use tasteful speed ramps on the strongest movements, add subtle punch-in zooms, keep transitions minimal, preserve natural skin tone, use deep contrast and slightly muted colors, add subtle grain, and balance the music under any speech.";
const analyses = capture.analyses.map((a) => analysisResultSchema.parse(a));
function setup(prompt = acceptance) {
  const p = newProject("Aesthetic", 320, 180);
  p.assets = capture.assets.map((a) => assetSchema.parse(a));
  const brief = parseEditBrief(prompt),
    evidence = rankMoments(p, analyses, brief),
    music = p.assets.find((a) => a.kind === "audio")!,
    beatMap = analyses.find((a) => a.audio)!.audio!.beatMap;
  const cut = buildRoughCut(p, 0, brief, evidence, music, beatMap);
  return { p, brief, evidence, music, beatMap, cut };
}
describe("Aesthetic profiles use measured evidence and ordinary project commands", () => {
  it("keeps the exact requested style despite minimal transitions and respects ramps off", () => {
    expect(parseEditBrief(acceptance)).toMatchObject({
      style: "dark-aesthetic",
      durationSeconds: 25,
      aspect: "9:16",
      speedRamps: "subtle",
    });
    expect(
      parseEditBrief("Create a hardcore gym Reel, speed ramps off").speedRamps,
    ).toBe("off");
    for (const style of gymStyleSchema.options)
      expect(
        Object.values(gymStyles[style].hook).reduce((a, b) => a + b, 0),
      ).toBeCloseTo(1);
  });
  it("ranks an evidence-based hook, fills 25 seconds from distinct ranges and writes editable color/gain", () => {
    const { p, cut, evidence } = setup(),
      rate = fps(p),
      h = new History(p),
      preview = previewEditPlan(cut.plan, p, 0);
    expect(cut.shots[0].candidate.id).toBe(
      rankHooks(
        evidence.candidates,
        gymStyles["dark-aesthetic"],
        cut.musicEvents,
      )[0].candidate.id,
    );
    expect(cut.shots[0].duration / rate).toBeGreaterThanOrEqual(1);
    expect(cut.shots[0].duration / rate).toBeLessThanOrEqual(2);
    expect(cut.durationSeconds).toBe(25);
    expect(new Set(cut.shots.map((s) => s.candidate.id)).size).toBe(
      cut.shots.length,
    );
    for (const shot of cut.shots) {
      expect(shot.sourceIn).toBeGreaterThanOrEqual(
        Math.ceil((shot.candidate.sourceStartMs * rate) / 1000),
      );
      expect(shot.sourceIn + shot.duration).toBeLessThanOrEqual(
        Math.floor((shot.candidate.sourceEndMs * rate) / 1000),
      );
    }
    const edited = h.execute(
        p,
        "Aesthetic edit",
        applyEditPreview(preview, p, 0),
      ),
      sequence = edited.compositions[0];
    expect(sequence.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(
      sequence.layers.filter(
        (c) =>
          c.kind === "media" &&
          c.effectStack.some(
            (e) => e.type === "saturation" && e.value === 0.92,
          ),
      ),
    ).toHaveLength(cut.shots.length);
    expect(sequence.layers.at(-1)?.gain).toBe(-14);
    expect(h.past).toHaveLength(1);
    expect(parseProject(JSON.parse(JSON.stringify(edited)))).toEqual(edited);
    expect(h.undo(edited)).toEqual(p);
    expect(h.redo(p)).toEqual(edited);
  });
  it("makes different pacing/ranking decisions for physique, cinematic and hardcore", () => {
    const plans = ["Physique", "Cinematic", "Hardcore"].map((style) =>
      setup(`Create a 20-second ${style} gym Reel with music.`),
    );
    const [physique, cinematic, hardcore] = plans;
    expect(physique.cut.shots[1].duration).toBeGreaterThan(
      hardcore.cut.shots[1].duration,
    );
    expect(cinematic.cut.shots[1].duration).toBeGreaterThan(
      hardcore.cut.shots[1].duration,
    );
    expect(physique.evidence.candidates.map((c) => c.overallScore)).not.toEqual(
      hardcore.evidence.candidates.map((c) => c.overallScore),
    );
    expect(
      [...hardcore.cut.plan.commands]
        .reverse()
        .find((c) => c.tool === "sequence.insert"),
    ).toMatchObject({ gain: -11 });
    for (const { cut } of plans)
      expect(cut.shots.length).toBeLessThan(
        cut.musicEvents.filter((e) => e.kind === "beat").length,
      );
  });
  it("keeps explicit review order and clearly reports insufficient footage", () => {
    const { p, brief, evidence, music, beatMap } = setup(),
      ids = evidence.candidates
        .slice(0, 2)
        .map((c) => c.id)
        .reverse();
    const cut = buildRoughCut(p, 0, brief, evidence, music, beatMap, ids);
    expect(cut.shots.map((s) => s.candidate.id)).toEqual(ids);
    expect(cut.warnings.join(" ")).toMatch(/Only .*seconds of distinct/);
  });
  it("proposes selective editable ramps and can disable one without changing cuts", () => {
    const { p, brief, evidence, music, beatMap, cut } = setup();
    expect(cut.ramps.length).toBeGreaterThan(0);
    expect(cut.ramps.length).toBeLessThan(cut.shots.length);
    const first = cut.ramps[0];
    const reduced = buildRoughCut(
      p,
      0,
      brief,
      evidence,
      music,
      beatMap,
      cut.shots.map((s) => s.candidate.id),
      [first.candidateId],
    );
    expect(
      reduced.ramps.find((r) => r.candidateId === first.candidateId)?.enabled,
    ).toBe(false);
    expect(
      reduced.plan.commands.filter((c) => c.tool === "sequence.speed").length,
    ).toBe(cut.ramps.length - 1);
    expect(
      reduced.shots.map((s) => [
        s.candidate.id,
        s.startFrame,
        s.sourceIn,
        s.duration,
      ]),
    ).toEqual(
      cut.shots.map((s) => [
        s.candidate.id,
        s.startFrame,
        s.sourceIn,
        s.duration,
      ]),
    );
  });
});
describe("Measured music events", () => {
  const map = (
    energy: BeatMap["energyCurve"],
    onsets: BeatMap["onsets"] = [],
  ): BeatMap => ({
    bpm: null,
    confidence: 0,
    beats: [],
    onsets,
    downbeats: [],
    energyCurve: energy,
    method: "energy-flux-autocorrelation",
  });
  const envelope = (change: boolean) =>
    Array.from({ length: 101 }, (_, i) => ({
      timeMs: i * 100,
      rmsDb: change && i >= 50 ? -12 : -24,
    }));
  it("does not invent events for silence, constant energy or incomplete sampling", () => {
    expect(musicEvents(map([]))).toEqual([]);
    expect(musicEvents(map(envelope(false)))).toEqual([]);
    expect(
      musicEvents(
        map([
          { timeMs: 0, rmsDb: -50 },
          { timeMs: 5000, rmsDb: -10 },
        ]),
      ),
    ).toEqual([]);
    expect(
      musicEvents(
        map(envelope(true).map((e) => ({ ...e, rmsDb: e.rmsDb - 70 }))),
      ),
    ).toEqual([]);
  });
  it("qualifies energy changes and requires a real onset before reporting a possible drop", () => {
    const noOnsets = musicEvents(map(envelope(true)));
    expect(noOnsets.some((e) => e.kind === "energy-rise")).toBe(true);
    expect(noOnsets.some((e) => e.kind === "section-change")).toBe(true);
    expect(noOnsets.some((e) => e.kind === "possible-drop")).toBe(false);
    const events = musicEvents(
      map(envelope(true), [{ timeMs: 5000, strength: 1 }]),
    );
    expect(events.find((e) => e.kind === "possible-drop")).toMatchObject({
      timeMs: 5000,
    });
    expect(events.every((e) => e.confidence > 0 && e.confidence < 1)).toBe(
      true,
    );
    expect(
      events.filter((e) => e.kind === "strong-onset").map((e) => e.timeMs),
    ).toEqual([5000]);
  });
});
