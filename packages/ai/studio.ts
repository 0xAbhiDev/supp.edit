import type { Project } from "../project-schema";
import { backgroundJobs, type JobScheduler } from "../jobs";
import { AIModelManager, captionModel } from "./models";
import {
  snapshotContext,
  freezeSnapshot,
  type ContextSelection,
} from "./context";
import { contentDigest } from "./privacy";
import { parseSrt } from "./srt";
import {
  createCaptionPreview,
  localCaptionProvider,
  type CaptionPreview,
} from "./captions";
import type { GenerateCaptionsOperation, OperationKind } from "./operations";

export interface AICommandPlan {
  id: string;
  intent: "captions-from-transcript";
  operation: GenerateCaptionsOperation;
  commands: readonly ["ImportTranscript", "CreateCaptionLayers"];
  requiresConfirmation: true;
  processing: "LOCAL";
}
export interface StudioEntry {
  readonly id: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly plan: AICommandPlan;
  readonly preview?: CaptionPreview;
  readonly applied: boolean;
}
/** An allowlisted planner. Unrecognized natural language is rejected, not guessed
 * or evaluated. A future intent resolver must return the same validated plan. */
export function resolveIntent(request: string): AICommandPlan["intent"] {
  if (
    /^(generate captions|captions from (srt|transcript)|create captions)[.!]?$/i.test(
      request.trim(),
    )
  )
    return "captions-from-transcript";
  throw new Error(
    'Available command: "generate captions" from an SRT transcript. Other AI tasks have no installed backend.',
  );
}
export class AIStudioService {
  readonly models = new AIModelManager();
  readonly providers = Object.freeze([localCaptionProvider]);
  private entries: readonly StudioEntry[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  constructor(readonly jobs: JobScheduler = backgroundJobs) {
    this.models.register(captionModel);
  }
  getSnapshot = () => this.entries;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  availableActions() {
    return this.providers.flatMap((p) =>
      p.capabilities.filter((c) =>
        this.models
          .list()
          .some(
            (m) =>
              m.providerId === p.descriptor.id &&
              m.task === c.kind &&
              ["builtin", "installed", "remote"].includes(m.installedState),
          ),
      ),
    );
  }
  supports(kind: OperationKind) {
    return this.availableActions().some((c) => c.kind === kind);
  }
  private update(entry: StudioEntry) {
    this.entries = Object.freeze(
      [
        ...this.entries.filter((e) => e.id !== entry.id),
        freezeSnapshot(entry),
      ].slice(-100),
    );
    for (const fn of this.listeners) fn();
  }
  async submit(
    request: string,
    srt: string,
    project: Project,
    revision: number,
    selection: ContextSelection = {},
    offsetFrames = 0,
  ): Promise<string> {
    const intent = resolveIntent(request);
    if (!this.supports("GenerateCaptions"))
      throw new Error("Caption backend is unavailable");
    const context = snapshotContext(project, revision, selection),
      transcript = parseSrt(srt);
    const operation: GenerateCaptionsOperation = freezeSnapshot({
      id: crypto.randomUUID(),
      kind: "GenerateCaptions",
      projectId: project.id,
      contextSnapshotId: context.snapshotId,
      revision,
      providerId: captionModel.providerId,
      modelId: captionModel.id,
      modelVersion: captionModel.version,
      sources: [
        {
          kind: "transcript",
          transcriptId: transcript.id,
          contentDigest: await contentDigest(transcript),
        },
      ],
      transcript,
      offsetFrames,
    });
    localCaptionProvider.validate(operation, context);
    const plan: AICommandPlan = freezeSnapshot({
      id: crypto.randomUUID(),
      intent,
      operation,
      commands: ["ImportTranscript", "CreateCaptionLayers"],
      requiresConfirmation: true,
      processing: "LOCAL",
    });
    const job = this.jobs.enqueue({
      label: "Captions from SRT",
      scope: project.id,
      supportsPause: true,
      run: async (job) =>
        createCaptionPreview(
          await localCaptionProvider.run(operation, context, job),
          operation,
          project,
          context,
        ),
    });
    const entry: StudioEntry = {
      id: operation.id,
      projectId: project.id,
      jobId: job.id,
      plan,
      applied: false,
    };
    this.update(entry);
    void job.finished.then((outcome) => {
      if (outcome.state === "Completed")
        this.update({ ...entry, preview: outcome.result });
    });
    return entry.id;
  }
  markApplied(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry?.preview) throw new Error("No result to apply");
    this.update({ ...entry, applied: true });
  }
}
export const aiStudio = new AIStudioService();
