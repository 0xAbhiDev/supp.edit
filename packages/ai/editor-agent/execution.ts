import { z } from "zod";
import { original } from "immer";
import { type Project, projectSchema } from "../../project-schema";
import { History, type Edit } from "../../commands";
import {
  inComposition,
  compositionView,
  batchCompositionEdits,
} from "../../commands/compositions";
import { freezeSnapshot } from "../context";
import { toolCallSchema, toolEdit } from "./registry";
export const editPlanSchema = z
  .object({
    id: z.string().min(1).max(128),
    projectId: z.string().min(1).max(128),
    revision: z.number().int().nonnegative(),
    compositionId: z.string().min(1).max(128).nullable(),
    resultCompositionId: z.string().min(1).max(128).optional(),
    summary: z.string().min(1).max(2000),
    processing: z.literal("LOCAL"),
    commands: z.array(toolCallSchema).min(1).max(512),
  })
  .strict();
export type EditorPlan = z.infer<typeof editPlanSchema>;
export interface EditPreview {
  readonly plan: EditorPlan;
  readonly project: Project;
  readonly changedLayerIds: readonly string[];
  readonly removedLayerIds: readonly string[];
  readonly validation: "Project structure validated";
  readonly frame: number;
}
const origins = new WeakMap<
  EditPreview,
  { project: Project; revision: number }
>();
function planEdit(plan: EditorPlan): Edit {
  return batchCompositionEdits(
    inComposition(plan.compositionId, (p) => {
      for (const call of plan.commands) toolEdit(call)(p);
    }),
  );
}
export function previewEditPlan(
  input: unknown,
  project: Project,
  revision: number,
): EditPreview {
  const plan = editPlanSchema.parse(input);
  if (plan.projectId !== project.id || plan.revision !== revision)
    throw new Error("Plan context is stale");
  if (
    plan.compositionId &&
    !project.compositions.some((c) => c.id === plan.compositionId)
  )
    throw new Error("Planned composition no longer exists");
  const h = new History(project),
    result = h.execute(project, "Preview AI edit", planEdit(plan));
  projectSchema.parse(result);
  if (result === project)
    throw new Error("The plan produces no project changes");
  const resultScope = plan.resultCompositionId ?? plan.compositionId;
  if (resultScope && !result.compositions.some((c) => c.id === resultScope))
    throw new Error("The planned preview sequence does not exist");
  const before =
      resultScope && !project.compositions.some((c) => c.id === resultScope)
        ? { clips: [] }
        : compositionView(project, resultScope),
    after = compositionView(result, resultScope);
  const preview = freezeSnapshot({
    frame: (() => {
      const call = plan.commands[0],
        clip =
          "clipId" in call
            ? after.clips.find((c) => c.id === call.clipId)
            : undefined;
      return clip
        ? Math.max(
            clip.start,
            Math.min(
              clip.start + clip.duration - 1,
              "frame" in call ? call.frame : clip.start,
            ),
          )
        : 0;
    })(),
    plan,
    project: result,
    changedLayerIds: after.clips
      .filter((c) => before.clips.find((b) => b.id === c.id) !== c)
      .map((c) => c.id),
    removedLayerIds: before.clips
      .filter((c) => !after.clips.some((a) => a.id === c.id))
      .map((c) => c.id),
    validation: "Project structure validated" as const,
  });
  origins.set(preview, { project, revision });
  return preview;
}
export function isEditPreviewCurrent(
  preview: EditPreview,
  project: Project,
  revision: number,
) {
  const origin = origins.get(preview);
  return !!origin && origin.project === project && origin.revision === revision;
}
export function applyEditPreview(
  preview: EditPreview,
  project: Project,
  revision: number,
): Edit {
  if (!isEditPreviewCurrent(preview, project, revision))
    throw new Error("Project changed. Preview the plan again before applying.");
  return (draft) => {
    if (original(draft) !== project)
      throw new Error("Project changed before the edit could apply");
    planEdit(preview.plan)(draft);
    projectSchema.parse(draft);
  };
}
