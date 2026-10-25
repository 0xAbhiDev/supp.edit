import { z } from "zod";
import { original } from "immer";
import {
  newClip,
  newTrack,
  clipSchema,
  trackSchema,
  type Project,
  type Clip,
  type Track,
} from "../project-schema";
import type { Edit } from "../commands";
import type { JobContext } from "../jobs";
import { freezeSnapshot, type AIProjectContext } from "./context";
import { captionModel } from "./models";
import { contentDigest } from "./privacy";
import { transcriptSchema, type Transcript } from "./transcript";
import type {
  GenerateCaptionsOperation,
  GenerateCaptionsResult,
} from "./operations";
import type { AIProvider } from "./providers";

const frame = z.number().finite().int().min(0).max(2_000_000_000);
const captionResultSchema = z
  .object({
    kind: z.literal("GenerateCaptions"),
    transcript: transcriptSchema,
    captions: z
      .array(
        z
          .object({
            segmentId: z.string().min(1).max(128),
            startFrame: frame,
            endFrame: frame,
            text: z.string().min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();

export const localCaptionProvider: AIProvider<"GenerateCaptions"> = {
  descriptor: Object.freeze({
    id: "builtin-local",
    name: "Built-in local processing",
    type: "Local",
    processing: "LOCAL",
    version: "1",
  }),
  capabilities: Object.freeze([
    Object.freeze({
      kind: "GenerateCaptions",
      label: "Captions from SRT",
      supportsPause: true,
      implementation: "deterministic",
    }),
  ]),
  validate(operation, context) {
    if (
      operation.kind !== "GenerateCaptions" ||
      operation.providerId !== captionModel.providerId ||
      operation.modelId !== captionModel.id ||
      operation.modelVersion !== captionModel.version
    )
      throw new Error("This provider only supports built-in SRT captions");
    if (
      operation.projectId !== context.projectId ||
      operation.contextSnapshotId !== context.snapshotId ||
      operation.revision !== context.revision ||
      context.activeComposition
    )
      throw new Error(
        "Caption operation does not match the main sequence context",
      );
    if (
      !Number.isSafeInteger(operation.offsetFrames) ||
      operation.offsetFrames < 0 ||
      operation.offsetFrames > 2_000_000_000
    )
      throw new Error("Caption offset must be a nonnegative frame number");
    const transcript = transcriptSchema.parse(operation.transcript);
    if (transcript.source !== "srt" || transcript.assetId)
      throw new Error(
        "The built-in caption provider requires a sequence-relative imported SRT transcript",
      );
    if (
      operation.sources.length !== 1 ||
      operation.sources[0].kind !== "transcript" ||
      operation.sources[0].transcriptId !== transcript.id
    )
      throw new Error("Caption source binding does not match the transcript");
  },
  async run(operation, context, job) {
    this.validate(operation, context);
    if (
      operation.sources[0].contentDigest !==
      (await contentDigest(operation.transcript))
    )
      throw new Error("Caption source content changed");
    const { num, den } = context.sequence.fps;
    const captions: GenerateCaptionsResult["captions"] = [];
    const segments = operation.transcript.segments;
    for (let i = 0; i < segments.length; i++) {
      await job.checkpoint();
      const segment = segments[i];
      // Half-open frame intervals: nearest-frame boundaries preserve adjacency.
      const startFrame =
        operation.offsetFrames +
        Math.round((segment.startMs * num) / (1000 * den));
      const endFrame =
        operation.offsetFrames +
        Math.round((segment.endMs * num) / (1000 * den));
      if (endFrame <= startFrame)
        throw new Error(
          `Caption ${i + 1} is shorter than a frame at this sequence's frame rate`,
        );
      if (
        captions.length &&
        startFrame < captions[captions.length - 1].endFrame
      )
        throw new Error(
          "Overlapping caption cues cannot be applied to one track",
        );
      if (endFrame > 2_000_000_000)
        throw new Error("Caption exceeds the timeline frame limit");
      captions.push({
        segmentId: segment.id,
        startFrame,
        endFrame,
        text: segment.text,
      });
      job.report({ completed: i + 1, total: segments.length, unit: "cues" });
      // Yield to real input/cancellation without adding a simulated progress delay.
      if ((i + 1) % 64 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return freezeSnapshot(
      captionResultSchema.parse({
        kind: "GenerateCaptions",
        transcript: operation.transcript,
        captions,
      }),
    );
  },
};

export interface CaptionPreview {
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly operationId: string;
  readonly result: GenerateCaptionsResult;
  readonly track: Track;
  readonly clips: readonly Clip[];
}
const previewOrigins = new WeakMap<CaptionPreview, Project>();
export function createCaptionPreview(
  result: GenerateCaptionsResult,
  operation: GenerateCaptionsOperation,
  project: Project,
  context: AIProjectContext,
): CaptionPreview {
  localCaptionProvider.validate(operation, context);
  const parsed = captionResultSchema.parse(result);
  if (
    project.id !== context.projectId ||
    parsed.transcript.id !== operation.transcript.id ||
    JSON.stringify(parsed.transcript) !==
      JSON.stringify(operation.transcript) ||
    parsed.captions.length !== parsed.transcript.segments.length
  )
    throw new Error("Caption result does not match the requested transcript");
  const track = newTrack(
    "video",
    project.tracks.filter((t) => t.kind === "video").length + 1,
  );
  track.name = "Captions";
  const clips = parsed.captions.map((cue, i) => {
    const segment = parsed.transcript.segments[i];
    const factor = context.sequence.fps.num / (1000 * context.sequence.fps.den);
    if (
      cue.segmentId !== segment.id ||
      cue.text !== segment.text ||
      cue.startFrame !==
        operation.offsetFrames + Math.round(segment.startMs * factor) ||
      cue.endFrame !==
        operation.offsetFrames + Math.round(segment.endMs * factor) ||
      cue.endFrame <= cue.startFrame ||
      (i > 0 && cue.startFrame < parsed.captions[i - 1].endFrame)
    )
      throw new Error("Caption result contains invalid timing or text");
    const clip = newClip(
      track.id,
      cue.startFrame,
      cue.endFrame - cue.startFrame,
      "text",
    );
    clip.name = `Caption ${i + 1}`;
    clip.text.content = cue.text;
    clip.text.size = Math.max(
      6,
      Math.min(72, Math.round(project.settings.height * 0.05)),
    );
    clip.transform.y = Math.round(project.settings.height * 0.37);
    return clipSchema.parse(clip);
  });
  const preview = freezeSnapshot({
    id: crypto.randomUUID(),
    projectId: project.id,
    revision: context.revision,
    operationId: operation.id,
    result: parsed,
    track: trackSchema.parse(track),
    clips,
  });
  previewOrigins.set(preview, project);
  return preview;
}
export function isCaptionPreviewCurrent(
  preview: CaptionPreview,
  project: Project,
  revision: number,
): boolean {
  return (
    preview.projectId === project.id &&
    preview.revision === revision &&
    previewOrigins.get(preview) === project
  );
}
/** One ordinary History Edit. Nothing is persisted until this Edit succeeds atomically. */
export function captionPreviewEdit(
  preview: CaptionPreview,
  project: Project,
  revision: number,
): Edit {
  if (!isCaptionPreviewCurrent(preview, project, revision))
    throw new Error(
      "Project changed since preview. Generate a new caption preview",
    );
  return (draft) => {
    if (original(draft) !== project)
      throw new Error("Project changed before captions could be applied");
    const target = draft as typeof draft & { transcripts: Transcript[] };
    if (!Array.isArray(target.transcripts))
      throw new Error("This project schema does not support transcripts yet");
    if (
      target.transcripts.some((t) => t.id === preview.result.transcript.id) ||
      draft.tracks.some((t) => t.id === preview.track.id) ||
      preview.clips.some((clip) => draft.clips.some((c) => c.id === clip.id))
    )
      throw new Error("This caption preview has already been applied");
    if (
      draft.tracks.length >= 1000 ||
      draft.clips.length + preview.clips.length > 100000 ||
      target.transcripts.length >= 10000
    )
      throw new Error("Caption import exceeds project capacity");
    target.transcripts.push(structuredClone(preview.result.transcript));
    draft.tracks.unshift(structuredClone(preview.track));
    draft.clips.push(...structuredClone([...preview.clips]));
  };
}

// This backend is deliberately independent from JobScheduler; other hosts can provide JobContext.
export type CaptionExecutionContext = JobContext;
