import { type Project, uid } from "../../project-schema";
import { sourceFrameAt } from "../../time-remap/model";
import { History } from "../../commands";
import { duplicateSequence } from "../../commands/reframe";
import { revisionTarget } from "../revisions/planner";
import { previewEditPlan } from "../editor-agent/execution";
import type { EditorToolCall } from "../editor-agent/registry";
import { VISION_MODEL_VERSION } from "../media-analysis/model";
import { cameraPath } from "./tracking";
import {
  subjectSamplesSchema,
  type SubjectSamples,
  type ReframeMode,
  type SubjectChoice,
  type ReframeChange,
} from "./model";
export function planReframe(
  request: string,
  project: Project,
  revision: number,
  activeId: string | null,
  evidence: ReadonlyMap<string, SubjectSamples>,
  mode: ReframeMode = "smooth",
  choice: SubjectChoice = "main",
) {
  const original = revisionTarget(project, activeId),
    commands: EditorToolCall[] = [];
  const portrait =
    original.settings.width / original.settings.height === 9 / 16;
  let target = original;
  if (
    !portrait &&
    !/in[- ]place|existing sequence|same sequence/i.test(request)
  ) {
    const id = uid(),
      name = `${original.name.slice(0, 235)} · Vertical`;
    commands.push({
      tool: "sequence.duplicate",
      sequenceId: original.id,
      id,
      name,
    });
    target = new History(project)
      .execute(
        project,
        "Preview portrait copy",
        duplicateSequence(original.id, id, name),
      )
      .compositions.find((c) => c.id === id)!;
  }
  const height = portrait
      ? target.settings.height
      : Math.max(
          32,
          Math.round(
            Math.max(target.settings.width, target.settings.height) / 32,
          ) * 32,
        ),
    width = (height * 9) / 16;
  const changes: ReframeChange["changes"] = [],
    warnings = new Set<string>();
  target.layers.forEach((clip, index) => {
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (asset?.kind !== "video") return;
    const data = subjectSamplesSchema.parse(
      evidence.get(original.layers[index].id),
    );
    if (
      data.assetId !== asset.id ||
      data.fingerprint !== asset.fingerprint ||
      data.modelVersion !== VISION_MODEL_VERSION
    )
      throw Error("Person evidence does not match the current source/model");
    const rate = target.settings.fps.num / target.settings.fps.den,
      startMs = Math.floor((sourceFrameAt(clip, 0) * 1000) / rate),
      endMs = Math.floor((sourceFrameAt(clip, clip.duration) * 1000) / rate);
    if (data.sampling.startMs !== startMs || data.sampling.endMs !== endMs)
      throw Error("Person evidence does not match the selected source range");
    const path = cameraPath(
      data,
      rate,
      clip.duration,
      width,
      height,
      mode,
      choice,
      clip.timeRemap
        ? (frame) => (sourceFrameAt(clip, frame) * 1000) / rate
        : undefined,
    );
    changes.push({
      clipId: clip.id,
      assetId: asset.id,
      fingerprint: asset.fingerprint,
      sourceIn: clip.sourceIn,
      duration: clip.duration,
      ...(clip.timeRemap ? { timeRemap: clip.timeRemap } : {}),
      x: path.x,
      y: path.y,
      scale: path.scale,
    });
    if (path.uncertain)
      warnings.add(
        "Missing/uncertain detections hold the last associated subject; review occlusions.",
      );
    if (path.letterbox)
      warnings.add(
        "Some shots retain letterboxing to keep measured subjects visible.",
      );
    if (
      clip.keyframes.x.length ||
      clip.keyframes.y.length ||
      clip.keyframes.scale.length ||
      clip.transform.x ||
      clip.transform.y ||
      clip.transform.scale !== 1
    )
      warnings.add(
        "Existing position/scale animation is replaced on the reframed layers; other edits are preserved.",
      );
  });
  if (!changes.length)
    throw Error("Choose a sequence with video shots to reframe");
  if (choice === "white-shirt")
    warnings.add(
      "White-shirt selection uses measured bright neutral torso pixels, not identity or clothing recognition.",
    );
  const summary = `${target === original ? "Reframe the existing sequence" : "Create a separate portrait sequence"} · ${width}×${height} · ${mode} camera · ${changes.length} shots. ${[...warnings].join(" ")}`;
  commands.push({
    tool: "sequence.reframe",
    sequenceId: target.id,
    width,
    height,
    changes,
    record: {
      id: uid(),
      request,
      summary,
      createdAt: new Date().toISOString(),
      changedLayerIds: changes.map((c) => c.clipId),
    },
  });
  return previewEditPlan(
    {
      id: uid(),
      projectId: project.id,
      revision,
      compositionId: null,
      resultCompositionId: target.id,
      summary,
      processing: "LOCAL",
      commands,
    },
    project,
    revision,
  );
}
