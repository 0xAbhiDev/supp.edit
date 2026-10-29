import { Channel, invoke } from "@tauri-apps/api/core";
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
  analysisSettingsSchema,
  defaultAnalysisSettings,
  type AnalysisSettings,
  type AnalysisTask,
  type MediaAnalysis,
} from "./model";
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
export interface AnalysisBackend {
  readonly processing: "LOCAL" | "CLOUD";
  analyze(
    asset: Asset,
    settings: AnalysisSettings,
    job: JobContext,
  ): Promise<MediaAnalysis>;
}
async function nativeJob<T>(
  command: string,
  args: Record<string, unknown>,
  job: JobContext,
): Promise<T> {
  if (!desktop)
    throw new Error(
      "Local media analysis runs in the Windows desktop application.",
    );
  await job.checkpoint();
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
    for (const task of ["speech", "audio", "video"] as const) {
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
    if (!desktop) return { model: null, audio: false, video: false };
    const [model, media] = await Promise.all([
      invoke<ModelStatus>("speech_model_status"),
      invoke<Capabilities>("probe_capabilities"),
    ]);
    this.models.reportRuntimeState(speechModel.id, {
      installedState: model.installed ? "installed" : "not-installed",
      download: { state: "not-requested" },
    });
    return {
      model,
      audio: media.ffmpeg && media.ffprobe,
      video: media.ffmpeg && media.ffprobe,
    };
  }
  install(projectId: string) {
    return this.jobs.enqueue({
      label: "Install local Whisper Tiny (83 MiB download)",
      scope: projectId,
      run: async (job) => {
        this.models.reportRuntimeState(speechModel.id, {
          installedState: "not-installed",
          download: {
            state: "downloading",
            receivedBytes: 0,
            totalBytes: 86620353,
          },
        });
        try {
          const model = await nativeJob<ModelStatus>(
            "install_speech_model",
            {},
            {
              ...job,
              report: (p) => {
                job.report(p);
                this.models.reportRuntimeState(speechModel.id, {
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
          this.models.reportRuntimeState(speechModel.id, {
            installedState: "installed",
            download: {
              state: "completed",
              receivedBytes: model.downloadBytes,
            },
          });
          return model;
        } catch (e) {
          const d = this.models.get(speechModel.id).download;
          this.models.reportRuntimeState(speechModel.id, {
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
  submit(project: Project, assetId: string, input: AnalysisSettings) {
    const settings = analysisSettingsSchema.parse(input),
      asset = project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error("Choose imported source media first");
    if (this.backend.processing !== "LOCAL")
      throw new Error(
        "Cloud analysis requires an explicit upload consent flow; no upload was made.",
      );
    return this.jobs.enqueue({
      label: `${settings.task === "speech" ? "Transcribe" : settings.task === "video" ? "Scenes and quality" : "Silence and music"} · ${asset.name}`,
      scope: project.id,
      run: async (job) => {
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
      },
    });
  }
  analyze(project: Project, assetId: string, task: AnalysisTask) {
    return this.submit(project, assetId, defaultAnalysisSettings(task));
  }
}
export const mediaAnalysis = new MediaAnalysisService();
