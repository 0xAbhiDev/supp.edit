import { describe, it, expect } from "vitest";
import { newProject, newClip, parseProject } from "../packages/project-schema";
import { History, moveClip } from "../packages/commands";
import { snapshotContext } from "../packages/ai/context";
import { JobScheduler } from "../packages/jobs";
import {
  AIEditorAgent,
  localCommandInterpreter,
} from "../packages/ai/editor-agent/agent";
import {
  previewEditPlan,
  applyEditPreview,
  isEditPreviewCurrent,
  type EditorPlan,
} from "../packages/ai/editor-agent/execution";
function fixture() {
  const p = newProject(),
    c = newClip(p.tracks[0].id, 0, 90, "shape");
  p.clips = [c];
  const plan: EditorPlan = {
    id: "plan",
    projectId: p.id,
    revision: 0,
    compositionId: null,
    summary: "Move, grade and animate",
    processing: "LOCAL",
    commands: [
      { tool: "clip.move", clipId: c.id, startFrame: 10 },
      {
        tool: "effect.add",
        clipId: c.id,
        effectId: "contrast",
        type: "contrast",
        value: 1.2,
      },
      {
        tool: "keyframe.set",
        clipId: c.id,
        property: "x",
        frame: 10,
        value: 20,
        easing: "ease-in",
      },
    ],
  };
  return { p, c, plan };
}
describe("AI editor command boundary", () => {
  it("previews actual edits without applying and commits one undoable shared command transaction", () => {
    const { p, plan } = fixture(),
      preview = previewEditPlan(plan, p, 0);
    expect(p.clips[0].start).toBe(0);
    expect(p.clips[0].effectStack).toHaveLength(0);
    expect(preview.changedLayerIds).toEqual([p.clips[0].id]);
    const h = new History(p),
      result = h.execute(p, "AI edit", applyEditPreview(preview, p, 0));
    expect(result.clips).toEqual(preview.project.clips);
    expect(h.past).toHaveLength(1);
    expect(h.undo(result).clips).toEqual(p.clips);
    expect(parseProject(JSON.parse(JSON.stringify(result))).clips).toEqual(
      result.clips,
    );
  });
  it("rejects stale, forged and delayed previews", () => {
    const { p, c, plan } = fixture(),
      preview = previewEditPlan(plan, p, 0),
      h = new History(p),
      delayed = applyEditPreview(preview, p, 0),
      next = h.execute(p, "move", moveClip(c.id, 3));
    expect(isEditPreviewCurrent(preview, next, 1)).toBe(false);
    expect(() => applyEditPreview(preview, next, 1)).toThrow(/changed/);
    expect(() => applyEditPreview({ ...preview }, p, 0)).toThrow();
    expect(() => h.execute(next, "delayed", delayed)).toThrow(/changed/);
  });
  it("rejects unknown tools, injected fields, invalid ranges and locked edits atomically", () => {
    const { p, c, plan } = fixture();
    expect(() =>
      previewEditPlan(
        { ...plan, commands: [{ tool: "eval", code: "anything" }] },
        p,
        0,
      ),
    ).toThrow();
    expect(() =>
      previewEditPlan(
        { ...plan, commands: [{ ...plan.commands[0], code: "anything" }] },
        p,
        0,
      ),
    ).toThrow();
    expect(() =>
      previewEditPlan(
        {
          ...plan,
          commands: [
            { tool: "clip.trim", clipId: c.id, edge: "in", targetFrame: 1000 },
          ],
        },
        p,
        0,
      ),
    ).toThrow(/bounds/);
    expect(p.clips[0].start).toBe(0);
    p.tracks[0].locked = true;
    expect(() => previewEditPlan(plan, p, 0)).toThrow(/Unlock/);
  });
  it("uses exact local commands, revises an existing effect and refuses unsupported creative claims", async () => {
    const { p, c } = fixture(),
      agent = new AIEditorAgent(localCommandInterpreter, new JobScheduler());
    const outcome = await agent.plan("Set contrast to 1.2", p, 0, {
      selectedLayerId: c.id,
    }).finished;
    expect(outcome.state).toBe("Completed");
    if (outcome.state !== "Completed") throw new Error("No preview");
    const h = new History(p),
      edited = h.execute(p, "apply", applyEditPreview(outcome.result, p, 0));
    const context = snapshotContext(edited, 1, { selectedLayerId: c.id });
    const intent = await localCommandInterpreter.interpret(
      "Set contrast to 1.5",
      context,
    );
    expect(intent.commands[0].tool).toBe("effect.update");
    await expect(
      localCommandInterpreter.interpret(
        "Choose my strongest lifts and sync beats",
        context,
      ),
    ).rejects.toThrow(/not installed/);
    expect(edited.clips[0].effectStack).toHaveLength(1);
  });
  it("validates trim/delete tools and leaves the source unchanged on a later failure", () => {
    const { p, c, plan } = fixture();
    const preview = previewEditPlan(
      {
        ...plan,
        commands: [
          { tool: "clip.trim", clipId: c.id, edge: "out", targetFrame: 40 },
        ],
      },
      p,
      0,
    );
    expect(preview.project.clips[0].duration).toBe(40);
    expect(() =>
      previewEditPlan(
        {
          ...plan,
          commands: [
            plan.commands[0],
            { tool: "clip.delete", clipId: "missing" },
          ],
        },
        p,
        0,
      ),
    ).toThrow();
    expect(p.clips[0].start).toBe(0);
    const removed = previewEditPlan(
      { ...plan, commands: [{ tool: "clip.delete", clipId: c.id }] },
      p,
      0,
    );
    expect(removed.removedLayerIds).toEqual([c.id]);
  });
});
