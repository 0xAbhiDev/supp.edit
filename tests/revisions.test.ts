import { describe, it, expect } from "vitest";
import capture from "./fixtures/gym-analysis.json";
import {
  newProject,
  assetSchema,
  newClip,
  newTrack,
  parseProject,
} from "../packages/project-schema";
import { History } from "../packages/commands";
import { newMask } from "../packages/masks/model";
import { analysisResultSchema } from "../packages/ai/media-analysis/model";
import { parseEditBrief, routeRequest } from "../packages/ai/rough-cut/model";
import {
  rankMoments,
  buildRoughCut,
  chooseMusic,
} from "../packages/ai/rough-cut/planner";
import {
  previewEditPlan,
  applyEditPreview,
} from "../packages/ai/editor-agent/execution";
import { planRevision } from "../packages/ai/revisions/planner";
const analyses = capture.analyses.map((a) => analysisResultSchema.parse(a));
function setup() {
  const p = newProject("Revision acceptance", 320, 180);
  p.assets = capture.assets.map((a) => assetSchema.parse(a));
  const brief = parseEditBrief(
      "Pick my best gym lifts and sync cuts to the music.",
    ),
    evidence = rankMoments(p, analyses, brief);
  const cut = buildRoughCut(
    p,
    0,
    brief,
    evidence,
    chooseMusic(p),
    analyses.find((a) => a.audio)!.audio!.beatMap,
  );
  const preview = previewEditPlan(cut.plan, p, 0),
    h = new History(p);
  const generated = h.execute(p, "Create", applyEditPreview(preview, p, 0));
  const project = structuredClone(generated),
    c = project.compositions[0];
  c.layers[0].masks = [newMask()];
  c.layers[0].effects.contrast = 1.25;
  c.layers[0].keyframes.x = [
    { frame: 0, value: 4, easing: "linear" },
    { frame: 70, value: 8, easing: "linear" },
  ];
  return { project, c, evidence, h: new History(project) };
}
describe("existing sequence revisions", () => {
  it("routes every required request to revisions, never to creation", () => {
    for (const s of [
      "Make it shorter.",
      "Make it 20 seconds.",
      "Replace the first clip.",
      "Replace the second shot.",
      "Replace the third shot.",
      "Remove the fourth shot.",
      "Use more gym footage.",
      "Use less bench footage.",
      "Make the cuts tighter to the music.",
      "Move the strongest shot to the beginning.",
      "Undo that revision.",
    ])
      expect(routeRequest(s), s).toBe("revision");
  });
  it("shortens in place, preserves masks/effects/animation, and exactly undoes and redoes two persisted revisions", () => {
    const { project, c, h } = setup();
    const first = planRevision("Make it 20 seconds.", project, 0, c.id);
    const revised = h.execute(
      project,
      "AI Revision: shorter",
      applyEditPreview(first, project, 0),
    );
    const out = revised.compositions[0];
    expect(out.id).toBe(c.id);
    expect(out.duration).toBe(600);
    expect(out.layers.map((l) => l.id)).toEqual(c.layers.map((l) => l.id));
    expect(out.layers[0].masks).toEqual(c.layers[0].masks);
    expect(out.layers[0].effects).toEqual(c.layers[0].effects);
    expect(out.layers[0].keyframes).toEqual(c.layers[0].keyframes);
    expect(h.undo(revised)).toEqual(project);
    expect(h.redo(project)).toEqual(revised);
    const second = planRevision("Use another clip first.", revised, 1, c.id);
    const result = h.execute(
      revised,
      "AI Revision: intro",
      applyEditPreview(second, revised, 1),
    );
    expect(result.compositions).toHaveLength(1);
    expect(result.compositions[0].revisions).toHaveLength(2);
    expect(parseProject(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(h.undo(result)).toEqual(revised);
    expect(h.redo(revised)).toEqual(result);
    expect(() => applyEditPreview(first, result, 2)).toThrow(/Project changed/);
  });
  it("replaces only the named shot and keeps its identity and attached edits", () => {
    const { project, c, evidence } = setup(),
      before = structuredClone(c.layers);
    const preview = planRevision(
      "Replace the first clip.",
      project,
      0,
      c.id,
      analyses,
      evidence,
    );
    const after = preview.project.compositions[0].layers;
    expect(after[0].assetId).not.toBe(before[0].assetId);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].masks).toEqual(before[0].masks);
    expect(after.slice(1)).toEqual(before.slice(1));
  });
  it("removes a numbered shot, closes the gap and preserves all other identities", () => {
    const { project, c } = setup(),
      removed = c.layers[3];
    const preview = planRevision("Remove the fourth shot.", project, 0, c.id);
    const out = preview.project.compositions[0];
    expect(out.layers.some((l) => l.id === removed.id)).toBe(false);
    expect(out.duration).toBe(c.duration - removed.duration);
    expect(out.layers.length).toBe(c.layers.length - 1);
  });
  it("moves an anchored overlay with its shot and rejects detached or locked dependencies", () => {
    const { project, c } = setup(),
      track = newTrack("video", 3);
    c.tracks.unshift(track);
    const overlay = newClip(track.id, c.layers[1].start + 2, 10, "text");
    overlay.parentId = c.layers[1].id;
    c.layers.push(overlay);
    const preview = planRevision("Use another clip first.", project, 0, c.id);
    expect(
      preview.project.compositions[0].layers.find((l) => l.id === overlay.id),
    ).toMatchObject({ start: 2, parentId: overlay.parentId });
    overlay.start = c.layers[0].duration - 2;
    overlay.duration = 20;
    expect(() => planRevision("Make it 20 seconds.", project, 0, c.id)).toThrow(
      /detach/,
    );
    const locked = structuredClone(project),
      lockedSequence = locked.compositions[0];
    lockedSequence.layers.pop();
    lockedSequence.tracks.find(
      (t) => t.id === lockedSequence.layers[0].trackId,
    )!.locked = true;
    expect(() => planRevision("Make it 20 seconds.", locked, 0, c.id)).toThrow(
      /locked/,
    );
  });
  it("cannot delete a parent or matte source while its dependent layer survives", () => {
    const { project, c } = setup();
    c.layers[0].parentId = c.layers[3].id;
    expect(() =>
      planRevision("Remove the fourth shot.", project, 0, c.id),
    ).toThrow(/Unparent/);
  });
});
