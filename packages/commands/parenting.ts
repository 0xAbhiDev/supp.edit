import { current, isDraft } from "immer";
import { type Project } from "../project-schema";
import {
  identity,
  inverse,
  layerTransforms,
  localMatrix,
  multiply,
} from "../animation/affine";
import { editable, type Edit } from "./index";

export function parentCandidates(project: Project, id: string) {
  const descendants = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of project.clips)
      if (c.parentId && descendants.has(c.parentId) && !descendants.has(c.id)) {
        descendants.add(c.id);
        changed = true;
      }
  }
  return project.clips.filter(
    (c) =>
      !descendants.has(c.id) &&
      project.tracks.find((t) => t.id === c.trackId)?.kind === "video",
  );
}
export function setParent(
  id: string,
  parentId: string | null,
  frame: number,
  preserveWorld = true,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) throw new Error("Unlock the child layer before parenting");
    if (parentId === c.parentId || (!parentId && !c.parentId)) return;
    if (p.tracks.find((t) => t.id === c.trackId)?.kind !== "video")
      throw new Error("Only visual layers can be parented");
    const snapshot = isDraft(p) ? current(p) : p;
    if (
      parentId &&
      !parentCandidates(snapshot, id).some((c) => c.id === parentId)
    )
      throw new Error(
        "Parent must be another layer in this composition without a cycle",
      );
    if (!Number.isFinite(frame)) throw new Error("Invalid parenting time");
    const transforms = layerTransforms(snapshot, frame);
    c.parentOffset = preserveWorld
      ? multiply(
          multiply(
            parentId ? inverse(transforms.world(parentId)) : identity(),
            transforms.world(id),
          ),
          inverse(localMatrix(c, frame)),
        )
      : identity();
    if (parentId) c.parentId = parentId;
    else delete c.parentId;
    // The containing inComposition command validates the full canonical graph.
    if (c.parentOffset.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9))
      throw new Error("Parent offset exceeds the project range");
  };
}
