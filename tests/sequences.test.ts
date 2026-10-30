import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  parseProject,
  projectSchema,
  type Asset,
} from "../packages/project-schema";
import { History } from "../packages/commands";
import { compositionView } from "../packages/commands/compositions";
import { sequenceExportSnapshot } from "../packages/commands/sequences";
import {
  previewEditPlan,
  applyEditPreview,
  type EditorPlan,
} from "../packages/ai/editor-agent/execution";
import { parseEditBrief } from "../packages/ai/rough-cut/model";
function setup() {
  const p = newProject();
  const asset: Asset = {
    id: "video",
    name: "source.mp4",
    kind: "video",
    path: "source.mp4",
    size: 10,
    duration: 20,
    width: 640,
    height: 480,
    fps: 30,
    codec: "h264",
    hasAudio: true,
    fingerprint: "original",
  };
  p.assets = [asset];
  p.clips = [newClip(p.tracks[0].id, 0, 60, "shape")];
  const plan: EditorPlan = {
    id: "plan",
    projectId: p.id,
    revision: 0,
    compositionId: null,
    resultCompositionId: "sequence",
    processing: "LOCAL",
    summary: "Create a sequence",
    commands: [
      {
        tool: "sequence.create",
        id: "sequence",
        name: "AI Gym Edit 01",
        settings: p.settings,
        duration: 90,
        videoTrackId: "shots",
        audioTrackId: "music",
        ai: {
          plannerVersion: "rough-cut-1",
          createdAt: new Date().toISOString(),
          brief: parseEditBrief(
            "Pick my best gym lifts and sync cuts to the music.",
          ),
          evidence: [],
          warnings: [],
        },
      },
      {
        tool: "sequence.insert",
        sequenceId: "sequence",
        clipId: "shot",
        trackId: "shots",
        assetId: asset.id,
        fingerprint: asset.fingerprint,
        startFrame: 0,
        sourceIn: 90,
        duration: 90,
        gain: 0,
      },
      {
        tool: "sequence.marker",
        sequenceId: "sequence",
        id: "hook",
        frame: 0,
        name: "HOOK",
      },
    ],
  };
  return { p, plan };
}
describe("Editable AI sequences", () => {
  it("previews the new scope, applies atomically, undoes exactly and redoes stable ranges", () => {
    const { p, plan } = setup(),
      preview = previewEditPlan(plan, p, 0),
      h = new History(p);
    expect(p.compositions).toHaveLength(0);
    expect(preview.removedLayerIds).toEqual([]);
    expect(preview.changedLayerIds).toEqual(["shot"]);
    const result = h.execute(
      p,
      "Apply AI Edit",
      applyEditPreview(preview, p, 0),
    );
    expect(result.clips).toEqual(p.clips);
    expect(result.compositions).toEqual(preview.project.compositions);
    expect(compositionView(result, "sequence").markers[0].name).toBe("HOOK");
    const before = h.undo(result);
    expect(before).toEqual(p);
    expect(h.redo(before)).toEqual(result);
    const reopened = parseProject(JSON.parse(JSON.stringify(result)));
    expect(reopened).toEqual(result);
    const exported = sequenceExportSnapshot(reopened, "sequence");
    expect(projectSchema.safeParse(exported).success).toBe(true);
    expect(exported.clips[0].compositionId).toBe("sequence");
    expect(exported.clips[0].duration).toBe(90);
  });
  it("rejects changed media and invalid insertions without publishing any partial sequence", () => {
    const { p, plan } = setup();
    p.assets[0].fingerprint = "changed";
    expect(() => previewEditPlan(plan, p, 0)).toThrow(/changed/);
    expect(p.compositions).toHaveLength(0);
    p.assets[0].fingerprint = "original";
    plan.commands.push({
      ...plan.commands[1],
      tool: "sequence.insert",
      sequenceId: "sequence",
      clipId: "overlap",
      trackId: "shots",
      assetId: "video",
      fingerprint: "original",
      startFrame: 0,
      sourceIn: 0,
      duration: 30,
      gain: 0,
    });
    expect(() => previewEditPlan(plan, p, 0)).toThrow(/overlaps/);
    expect(p.compositions).toHaveLength(0);
  });
});
