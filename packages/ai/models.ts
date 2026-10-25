import { freezeSnapshot } from "./context";
import type { OperationKind } from "./operations";

export type ExecutionDevice =
  "CPU" | "CUDA" | "DirectML" | "Core ML" | "Metal" | "remote";
export type DownloadState =
  | { state: "not-requested" }
  | {
      state: "queued" | "downloading" | "paused";
      receivedBytes: number;
      totalBytes: number | null;
    }
  | { state: "completed"; receivedBytes: number }
  | { state: "failed" | "cancelled"; receivedBytes: number };
export interface AIModel {
  id: string;
  name: string;
  task: OperationKind;
  providerId: string;
  sizeBytes: number | null;
  installedState:
    "builtin" | "not-installed" | "installed" | "remote" | "unavailable";
  executionDevice: ExecutionDevice;
  supportedDevices: ExecutionDevice[];
  version: string;
  download: DownloadState;
  runtime: "builtin" | "native-inference" | "remote-api";
}
/** Metadata registry, not a downloader. Only a future verified host runtime can report installation. */
export class AIModelManager {
  private models = new Map<string, Readonly<AIModel>>();
  register(model: AIModel): void {
    if (this.models.has(model.id)) throw new Error("Model already registered");
    this.validate(model);
    this.models.set(model.id, freezeSnapshot(structuredClone(model)));
  }
  list(): readonly Readonly<AIModel>[] {
    return Object.freeze([...this.models.values()]);
  }
  get(id: string): Readonly<AIModel> {
    const model = this.models.get(id);
    if (!model) throw new Error("Model is not registered");
    return model;
  }
  selectDevice(id: string, device: ExecutionDevice): void {
    const model = this.get(id);
    if (!model.supportedDevices.includes(device))
      throw new Error("Execution device is unavailable for this model");
    this.models.set(
      id,
      freezeSnapshot({ ...structuredClone(model), executionDevice: device }),
    );
  }
  /** Explicit host metadata event; this performs no download and grants no execution capability. */
  reportRuntimeState(
    id: string,
    state: Pick<AIModel, "installedState" | "download">,
  ): void {
    const model = {
      ...structuredClone(this.get(id)),
      ...structuredClone(state),
    };
    this.validate(model);
    this.models.set(id, freezeSnapshot(model));
  }
  private validate(model: AIModel) {
    if (
      !model.id ||
      !model.name ||
      !model.version ||
      !model.providerId ||
      !model.supportedDevices.includes(model.executionDevice)
    )
      throw new Error("Invalid model metadata");
    if (
      model.sizeBytes !== null &&
      (!Number.isSafeInteger(model.sizeBytes) || model.sizeBytes < 0)
    )
      throw new Error("Invalid model size");
    const download = model.download;
    if (
      "receivedBytes" in download &&
      (!Number.isSafeInteger(download.receivedBytes) ||
        download.receivedBytes < 0)
    )
      throw new Error("Invalid download byte count");
    if (
      "totalBytes" in download &&
      download.totalBytes !== null &&
      (!Number.isSafeInteger(download.totalBytes) ||
        download.totalBytes < download.receivedBytes)
    )
      throw new Error("Invalid download total");
    if (
      (model.runtime === "remote-api") !==
      (model.executionDevice === "remote")
    )
      throw new Error("Model runtime and execution device do not match");
  }
}

export const captionModel: AIModel = {
  id: "builtin-srt-captions-v1",
  name: "SRT captions (built-in, no ML)",
  task: "GenerateCaptions",
  providerId: "builtin-local",
  sizeBytes: 0,
  installedState: "builtin",
  executionDevice: "CPU",
  supportedDevices: ["CPU"],
  version: "1",
  download: { state: "not-requested" },
  runtime: "builtin",
};
