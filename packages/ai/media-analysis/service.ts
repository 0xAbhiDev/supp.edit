import { Channel, invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { desktop, type Capabilities } from "../../platform";
import { readDerived, writeDerived } from "../../platform/derived";
import { type Asset, type Project } from "../../project-schema";
import {
  backgroundJobs,
  type JobContext,
  type JobProgress,
  type JobScheduler,
} from "../../jobs";
import { freezeSnapshot } from "../context";
import { AIModelManager, type AIModel } from "../models";
import {
  analysisResultSchema,
  VISION_MODEL_VERSION,
  analysisSettingsSchema,
  defaultAnalysisSettings,
  type AnalysisSettings,
  type AnalysisTask,
  type MediaAnalysis,
} from "./model";
const queryEmbeddingSchema = z
  .object({
    modelVersion: z.string().max(128),
    processing: z.literal("LOCAL"),
    embedding: z.array(z.number().finite().min(-1).max(1)).length(512),
  })
  .strict();
export const speechModel: AIModel = {
  id: "whisper-tiny-multilingual",
  name: "Whisper Tiny · multilingual",
  task: "Transcribe",
  providerId: "whisper-cpp-local",
  sizeBytes: 77691713,
  installedState: "not-installed",
  executionDevice: "CPU",
  supportedDevices: ["CPU"],
  version: "whisper.cpp-b5454-tiny-be07e048",
  download: { state: "not-requested" },
  runtime: "native-inference",
};
export interface ModelStatus {
  id: string;
  name: string;
  version: string;
  sizeBytes: number;
  downloadBytes: number;
  installed: boolean;
  installSupported: boolean;
  device: "CPU";
}
export const visionModel: AIModel = {
  id: "mobileclip-s0-yolox-nano",
  name: "MobileCLIP S0 + YOLOX Nano",
  task: "SemanticSearch",
  providerId: "onnx-local-vision",
  sizeBytes: 94240379,
  installedState: "not-installed",
  executionDevice: "CPU",
  supportedDevices: ["CPU"],
  version: VISION_MODEL_VERSION,
  download: { state: "not-requested" },
  runtime: "native-inference",
};
export interface AnalysisBackend {
  readonly processing: "LOCAL" | "CLOUD";
  analyze(
    asset: Asset,
    settings: AnalysisSettings,
    job: JobContext,
  ): Promise<MediaAnalysis>;
}
export const personModel: AIModel = {
  id: "pphumanseg-2023mar",
  name: "PP-HumanSeg · people",
  task: "SegmentSubject",
  providerId: "onnx-local-vision",
  sizeBytes: 6163938,
  installedState: "not-installed",
  executionDevice: "CPU",
  supportedDevices: ["CPU"],
  version: "2023mar-552d8a98",
  download: { state: "not-requested" },
  runtime: "native-inference",
};
/** MediaPipe Pose (OpenCV model zoo, Apache 2.0): a person detector and 33 body joints, pinned by
 * commit, size and hash in native `pose_model.rs`. What a body does, whatever the framing. */
export const poseModel: AIModel = {
  id: "mediapipe-pose-2023mar",
  name: "MediaPipe Pose · body joints",
  task: "SegmentSubject",
  providerId: "onnx-local-vision",
  sizeBytes: 17570112,
  installedState: "not-installed",
  executionDevice: "CPU",
  supportedDevices: ["CPU"],
  version: "2023mar-9d89c599",
  download: { state: "not-requested" },
  runtime: "native-inference",
};
/** Native analysis runs at most this many jobs at once (the desktop enforces the same cap, see
 * src-tauri/src/analysis.rs); further jobs wait here for a free slot instead of failing. */
export const NATIVE_SLOTS = 4;
let nativeActive = 0;
const nativeWaiting: (() => void)[] = [];
async function nativeSlot(signal: AbortSignal) {
  while (nativeActive >= NATIVE_SLOTS) {
    await new Promise<void>((resolve) => nativeWaiting.push(resolve));
    if (signal.aborted) throw new Error("Cancelled");
  }
  nativeActive++;
}
function nativeRelease() {
  nativeActive--;
  nativeWaiting.shift()?.();
}
export async function nativeJob<T>(
  command: string,
  args: Record<string, unknown>,
  job: JobContext,
): Promise<T> {
  if (!desktop)
    throw new Error(
      "Local media analysis runs in the Windows desktop application.",
    );
  await job.checkpoint();
  await nativeSlot(job.signal);
  try {
    return await runNativeJob<T>(command, args, job);
  } finally {
    nativeRelease();
  }
}
async function runNativeJob<T>(command: string, args: Record<string, unknown>, job: JobContext): Promise<T> {
  const id = await invoke<string>("prepare_analysis_job");
  const cancel = () => {
    void invoke("cancel_analysis_job", { id }).catch(() => undefined);
  };
  const onProgress = new Channel<JobProgress>();
  onProgress.onmessage = (p) => {
    if (!job.signal.aborted) job.report(p);
  };
  job.signal.addEventListener("abort", cancel, { once: true });
  try {
    await job.checkpoint();
    return await invoke<T>(command, { ...args, id, onProgress });
  } catch (e) {
    throw new Error(String(e));
  } finally {
    job.signal.removeEventListener("abort", cancel);
    cancel();
  }
}
export const nativeAnalysisBackend: AnalysisBackend = {
  processing: "LOCAL",
  async analyze(asset, settings, job) {
    return analysisResultSchema.parse(
      await nativeJob(
        "analyze_media",
        { assetId: asset.id, path: asset.path, settings },
        job,
      ),
    );
  },
};
function key(asset: Pick<Asset, "id" | "fingerprint">, task: AnalysisTask) {
  return `analysis-v1:${asset.id}:${asset.fingerprint}:${task}`;
}
/** Cached results never mutate history; Apply is a separate validated editor command. */
export class MediaAnalysisService {
  readonly models = new AIModelManager();
  private results: readonly MediaAnalysis[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  constructor(
    readonly backend: AnalysisBackend = nativeAnalysisBackend,
    readonly jobs: JobScheduler = backgroundJobs,
  ) {
    this.models.register(speechModel);
    this.models.register(visionModel);
    this.models.register(personModel);
    this.models.register(poseModel);
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.results;
  private remember(result: MediaAnalysis) {
    this.results = Object.freeze(
      [
        ...this.results.filter(
          (r) =>
            !(
              r.assetId === result.assetId &&
              r.settings.task === result.settings.task
            ),
        ),
        freezeSnapshot(result),
      ].slice(-128),
    );
    this.listeners.forEach((fn) => fn());
  }
  async restore(asset: Asset) {
    for (const task of ["speech", "audio", "video", "vision"] as const) {
      const raw = await readDerived<unknown>(key(asset, task));
      const parsed = analysisResultSchema.safeParse(raw);
      if (
        parsed.success &&
        parsed.data.assetId === asset.id &&
        parsed.data.fingerprint === asset.fingerprint
      )
        this.remember(parsed.data);
    }
  }
  async capabilities() {
    if (!desktop)
      return {
        model: null,
        visionModel: null,
        personModel: null,
        poseModel: null,
        audio: false,
        video: false,
      };
    const [model, media, vision, person, pose] = await Promise.all([
      invoke<ModelStatus>("speech_model_status"),
      invoke<Capabilities>("probe_capabilities"),
      invoke<ModelStatus>("vision_model_status"),
      invoke<ModelStatus>("person_model_status"),
      invoke<ModelStatus>("pose_model_status"),
    ]);
    this.models.reportRuntimeState(speechModel.id, {
      installedState: model.installed ? "installed" : "not-installed",
      download: { state: "not-requested" },
    });
    this.models.reportRuntimeState(visionModel.id, {
      installedState: vision.installed ? "installed" : "not-installed",
      download: { state: "not-requested" },
    });
    this.models.reportRuntimeState(personModel.id, {
      installedState: person.installed ? "installed" : "not-installed",
      download: { state: "not-requested" },
    });
    this.models.reportRuntimeState(poseModel.id, {
      installedState: pose.installed ? "installed" : "not-installed",
      download: { state: "not-requested" },
    });
    return {
      model,
      personModel: person,
      poseModel: pose,
      visionModel: vision,
      audio: media.ffmpeg && media.ffprobe,
      video: media.ffmpeg && media.ffprobe,
    };
  }
  install(projectId: string, kind: "speech" | "vision" | "person" | "pose" = "speech") {
    const selected =
        kind === "speech"
          ? speechModel
          : kind === "person"
            ? personModel
            : kind === "pose"
              ? poseModel
              : visionModel,
      bytes =
        kind === "speech" ? 86620353 : kind === "person" ? 6175375 : kind === "pose" ? 17570112 : 177170323;
    return this.jobs.enqueue({
      label: `Install ${selected.name} (${Math.ceil(bytes / 1048576)} MiB download)`,
      scope: projectId,
      run: async (job) => {
        this.models.reportRuntimeState(selected.id, {
          installedState: "not-installed",
          download: {
            state: "downloading",
            receivedBytes: 0,
            totalBytes: bytes,
          },
        });
        try {
          const model = await nativeJob<ModelStatus>(
            kind === "speech"
              ? "install_speech_model"
              : kind === "person"
                ? "install_person_model"
                : kind === "pose"
                  ? "install_pose_model"
                  : "install_vision_model",
            {},
            {
              ...job,
              report: (p) => {
                job.report(p);
                this.models.reportRuntimeState(selected.id, {
                  installedState: "not-installed",
                  download: {
                    state: "downloading",
                    receivedBytes: p.completed,
                    totalBytes: p.total,
                  },
                });
              },
            },
          );
          this.models.reportRuntimeState(selected.id, {
            installedState: "installed",
            download: {
              state: "completed",
              receivedBytes: model.downloadBytes,
            },
          });
          return model;
        } catch (e) {
          const d = this.models.get(selected.id).download;
          this.models.reportRuntimeState(selected.id, {
            installedState: "not-installed",
            download: {
              state: job.signal.aborted ? "cancelled" : "failed",
              receivedBytes: "receivedBytes" in d ? d.receivedBytes : 0,
            },
          });
          throw e;
        }
      },
    });
  }
  async remove(kind: "speech" | "vision" | "person" | "pose") {
    if (!desktop) throw new Error("Model management requires the desktop app");
    const model =
      kind === "speech"
        ? speechModel
        : kind === "person"
          ? personModel
          : kind === "pose"
            ? poseModel
            : visionModel;
    await invoke("remove_ai_model", { modelId: model.id });
    this.models.reportRuntimeState(model.id, {
      installedState: "not-installed",
      download: { state: "not-requested" },
    });
  }
  async embedQuery(query: string, job: JobContext) {
    const text = z.string().trim().min(1).max(512).parse(query),
      key = `vision-query:${visionModel.version}:${text}`;
    const cached = queryEmbeddingSchema.safeParse(await readDerived(key));
    if (cached.success && cached.data.modelVersion === visionModel.version) {
      await job.checkpoint();
      return cached.data;
    }
    const result = queryEmbeddingSchema.parse(
      await nativeJob("embed_vision_query", { query: text }, job),
    );
    if (result.modelVersion !== visionModel.version)
      throw new Error(
        "Search encoder version differs from the installed image model",
      );
    await job.checkpoint();
    await writeDerived(key, result, JSON.stringify(result).length * 2);
    return result;
  }
  /** A batch job calls this directly so it never waits on another job in its own queue. */
  async runTask(asset: Asset, input: AnalysisSettings, job: JobContext) {
    const settings = analysisSettingsSchema.parse(input);
    if (this.backend.processing !== "LOCAL")
      throw new Error(
        "Cloud analysis needs explicit upload consent; no media was uploaded.",
      );
    const cached = this.results.find(
      (r) =>
        r.assetId === asset.id &&
        r.fingerprint === asset.fingerprint &&
        JSON.stringify(r.settings) === JSON.stringify(settings),
    );
    if (!desktop && this.backend === nativeAnalysisBackend && cached) {
      await job.checkpoint();
      return cached;
    }
    const result = analysisResultSchema.parse(
      await this.backend.analyze(asset, settings, job),
    );
    if (
      result.assetId !== asset.id ||
      result.fingerprint !== asset.fingerprint ||
      JSON.stringify(result.settings) !== JSON.stringify(settings)
    )
      throw new Error(
        "Analysis source or settings changed. Relink the source and retry.",
      );
    await job.checkpoint();
    await writeDerived(
      key(asset, settings.task),
      result,
      JSON.stringify(result).length * 2,
    );
    await job.checkpoint();
    this.remember(result);
    return result;
  }
  submit(project: Project, assetId: string, input: AnalysisSettings) {
    const settings = analysisSettingsSchema.parse(input),
      asset = project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error("Choose imported source media first");
    if (this.backend.processing !== "LOCAL")
      throw new Error(
        "Cloud analysis requires an explicit upload consent flow; no upload was made.",
      );
    return this.jobs.enqueue({
      label: `${settings.task === "speech" ? "Transcribe" : settings.task === "vision" ? "Local vision" : settings.task === "video" ? "Scenes and quality" : "Silence and music"} · ${asset.name}`,
      scope: project.id,
      run: (job) => this.runTask(asset, settings, job),
    });
  }
  analyze(project: Project, assetId: string, task: AnalysisTask) {
    return this.submit(project, assetId, defaultAnalysisSettings(task));
  }
}
export const mediaAnalysis = new MediaAnalysisService();
