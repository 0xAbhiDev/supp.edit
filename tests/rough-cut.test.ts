import { describe, it, expect } from "vitest";
import capture from "./fixtures/gym-analysis.json";
import {
  newProject,
  assetSchema,
  parseProject,
  newClip,
  fps,
} from "../packages/project-schema";
import { analysisResultSchema } from "../packages/ai/media-analysis/model";
import { parseEditBrief, routeRequest } from "../packages/ai/rough-cut/model";
import {
  rankMoments,
  buildRoughCut,
  chooseMusic,
  diversify,
} from "../packages/ai/rough-cut/planner";
import {
  strongEvents,
  nearestStrongBeat,
  nextStrongBeat,
} from "../packages/ai/rough-cut/beats";
import {
  previewEditPlan,
  applyEditPreview,
} from "../packages/ai/editor-agent/execution";
import { History } from "../packages/commands";
const prompt = "Pick my best gym lifts and sync cuts to the music.";
const analyses = capture.analyses.map((a) => analysisResultSchema.parse(a));
function setup() {
  const p = newProject("Gym acceptance", 320, 180);
  p.assets = capture.assets.map((a) => assetSchema.parse(a));
  p.clips = [newClip(p.tracks[0].id, 0, 90, "shape")];
  const brief = parseEditBrief(prompt),
    evidence = rankMoments(p, analyses, brief),
    music = chooseMusic(p),
    beatMap = analyses.find((a) => a.audio)!.audio!.beatMap;
  return { p, brief, evidence, music, beatMap };
}
describe("Real captured gym footage rough-cut planning", () => {
  it("routes both acceptance prompts through the same pipeline and preserves requested intent", () => {
    for (const s of [
      prompt,
      "Create a 30-second cinematic gym Reel using my best lifts. Start with the strongest shot and sync important cuts to the music.",
    ])
      expect(routeRequest(s)).toBe("creative");
    expect(
      parseEditBrief(
        "Create a 30-second cinematic gym Reel using my best lifts.",
      ),
    ).toMatchObject({
      durationSeconds: 30,
      aspect: "9:16",
      profile: "gym",
      pacing: "cinematic",
    });
  });
  it("ranks actual exercising people and rejects the actual flower footage even with a gym filename", () => {
    const { p, brief, evidence } = setup();
    expect(evidence.candidates.length).toBeGreaterThanOrEqual(5);
    expect(new Set(evidence.candidates.map((c) => c.assetId)).size).toBe(5);
    expect(
      evidence.candidates.every(
        (c) => c.subject.presence >= 0.55 && c.motionScore > 0,
      ),
    ).toBe(true);
    const negative = p.assets.find((a) => a.id === "non-gym-flower")!;
    negative.name = "best gym lifts barbell.mp4";
    p.assets = [negative];
    const rejected = rankMoments(p, analyses, brief);
    expect(rejected.candidates).toEqual([]);
    expect(() => buildRoughCut(p, 0, brief, rejected, null, null)).toThrow(
      /No sufficiently relevant/,
    );
  });
  it("creates genuine source ranges with measured music timing, one atomic undo and identical reopen", () => {
    const { p, brief, evidence, music, beatMap } = setup(),
      cut = buildRoughCut(p, 0, brief, evidence, music, beatMap),
      h = new History(p),
      preview = previewEditPlan(cut.plan, p, 0);
    expect(cut.durationSeconds).toBeGreaterThanOrEqual(20);
    expect(cut.durationSeconds).toBeLessThanOrEqual(30);
    expect(cut.shots[0].candidate.id).toBe(evidence.candidates[0].id);
    expect(
      cut.shots.filter((s) => s.beatAligned).length,
    ).toBeGreaterThanOrEqual(3);
    for (const s of cut.shots) {
      expect(s.sourceIn).toBeGreaterThanOrEqual(
        Math.ceil((s.candidate.sourceStartMs * fps(p)) / 1000),
      );
      expect(s.sourceIn + s.duration).toBeLessThanOrEqual(
        Math.floor((s.candidate.sourceEndMs * fps(p)) / 1000),
      );
      if (s.beatAligned)
        expect(
          nearestStrongBeat(
            beatMap,
            ((s.startFrame + s.duration) / fps(p)) * 1000,
            1000 / fps(p),
          ),
        ).not.toBeNull();
    }
    const edited = h.execute(
      p,
      "Apply AI Edit",
      applyEditPreview(preview, p, 0),
    );
    expect(h.past).toHaveLength(1);
    expect(edited.clips).toEqual(p.clips);
    const seq = edited.compositions[0];
    expect(seq.name).toBe("AI Gym Edit 01");
    expect(seq.layers).toHaveLength(cut.shots.length + 1);
    expect(seq.layers.at(-1)?.assetId).toBe(music?.id);
    expect(parseProject(JSON.parse(JSON.stringify(edited)))).toEqual(edited);
    expect(h.undo(edited)).toEqual(p);
    expect(h.redo(p)).toEqual(edited);
  });
  it("does not silently choose among music sources and refuses repeated or stale candidates", () => {
    const { p, brief, evidence, music, beatMap } = setup();
    p.assets.push({ ...music!, id: "another-song" });
    expect(() => chooseMusic(p)).toThrow(/Choose the music/);
    expect(chooseMusic(p, music!.id)).toBe(music);
    const id = evidence.candidates[0].id;
    expect(() =>
      buildRoughCut(p, 0, brief, evidence, music, beatMap, [id, id]),
    ).toThrow(/repeated/);
    p.assets.find((a) => a.id === evidence.candidates[0].assetId)!.fingerprint =
      "relinked";
    expect(() => buildRoughCut(p, 0, brief, evidence, music, beatMap)).toThrow(
      /changed/,
    );
  });
  it("supports deselect/reorder and names a subsequent sequence without destroying the first", () => {
    const { p, brief, evidence, music, beatMap } = setup(),
      ids = diversify(evidence.candidates)
        .slice(0, 4)
        .map((c) => c.id)
        .reverse(),
      cut = buildRoughCut(p, 0, brief, evidence, music, beatMap, ids);
    expect(cut.shots.map((s) => s.candidate.id)).toEqual(ids);
    const preview = previewEditPlan(cut.plan, p, 0),
      next = buildRoughCut(preview.project, 1, brief, evidence, music, beatMap);
    expect(next.plan.summary).toContain("AI Gym Edit 02");
  });
  it("reports an honest single moment and does not invent musical downbeats", () => {
    const { p, brief, evidence, music, beatMap } = setup();
    const cut = buildRoughCut(
      p,
      0,
      brief,
      { ...evidence, candidates: evidence.candidates.slice(0, 1) },
      music,
      beatMap,
    );
    expect(cut.shots).toHaveLength(1);
    expect(cut.warnings.join(" ")).toMatch(/Only one usable/);
    expect(beatMap.downbeats).toEqual([]);
    expect(
      strongEvents(beatMap).every(
        (b) =>
          beatMap.beats.some((a) => a.timeMs === b.timeMs) ||
          beatMap.onsets.some((a) => a.timeMs === b.timeMs),
      ),
    ).toBe(true);
    expect(nextStrongBeat(beatMap, 1000)?.timeMs).toBeGreaterThan(1000);
  });
});
