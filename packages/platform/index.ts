import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  type Asset,
  type Project,
  uid,
  parseProject,
  fps,
} from "../project-schema";
import { readLocal, writeLocal, deleteLocal, type Recovery } from "./storage";
import { DerivedMemory, readDerived, writeDerived } from "./derived";
export { useDerivedRevision } from "./derived";
export const desktop = isTauri();
export interface Capabilities {
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegVersion: string;
  encoders: string[];
  hardwareAccels: string[];
  cpuCores: number;
  platform: string;
  machine: {
    gpus: {
      name: string;
      dedicatedBytes: number;
      sharedBytes: number;
      software: boolean;
    }[];
    ramBytes: number | null;
    inventoryError: string | null;
    probes: {
      name: string;
      kind: string;
      advertised: boolean;
      available: boolean;
      detail: string;
    }[];
  };
}
export interface Imported {
  asset: Asset;
  thumbnail: string | null;
}
const urls = new Map<string, string>();
export const thumbnails = new DerivedMemory<string>(
  16 * 1024 * 1024,
  512,
  (v) => v.length * 2,
);
export const waveforms = new DerivedMemory<number[]>(
  8 * 1024 * 1024,
  512,
  (v) => v.length * 8,
);
export const derivedErrors = new DerivedMemory<string>(
  1024 * 1024,
  512,
  (v) => v.length * 2,
);
const analysis = new Map<string, Promise<void>>();
const derivedVersions = new Map<string, string>();
let waveformQueue: Promise<unknown> = Promise.resolve();
export async function restoreThumbnail(asset: Asset): Promise<void> {
  const key = asset.id + ":" + asset.fingerprint;
  if (derivedVersions.get(asset.id) !== asset.fingerprint) {
    thumbnails.delete(asset.id);
    waveforms.delete(asset.id);
    derivedErrors.delete(asset.id);
    derivedVersions.set(asset.id, asset.fingerprint);
  }
  if (derivedErrors.has(asset.id)) return;
  const existing = analysis.get(key);
  if (existing) return existing;
  const task = restoreDerived(asset)
    .catch((e) => {
      if (derivedVersions.get(asset.id) === asset.fingerprint)
        derivedErrors.set(asset.id, e instanceof Error ? e.message : String(e));
    })
    .finally(() => analysis.delete(key));
  analysis.set(key, task);
  return task;
}
async function restoreDerived(asset: Asset) {
  if (asset.kind !== "audio" && !thumbnails.has(asset.id)) {
    if (desktop) {
      const path = await invoke<string | null>("get_thumbnail", {
        assetId: asset.id,
        path: asset.path,
      });
      if (path && derivedVersions.get(asset.id) === asset.fingerprint)
        thumbnails.set(asset.id, convertFileSrc(path));
    } else {
      const cached =
        (await readDerived<string>(
          `thumbnail:${asset.id}:${asset.fingerprint}`,
        )) ?? (await readLocal<string>("state", `thumbnail:${asset.id}`));
      if (cached && derivedVersions.get(asset.id) === asset.fingerprint)
        thumbnails.set(asset.id, cached);
    }
  }
  if (asset.hasAudio && !waveforms.has(asset.id)) {
    const cached = await readDerived<number[]>(
      `waveform:${asset.id}:${asset.fingerprint}`,
    );
    if (cached) {
      if (derivedVersions.get(asset.id) === asset.fingerprint)
        waveforms.set(asset.id, cached);
      return;
    }
    const job = waveformQueue
      .catch(() => undefined)
      .then(async () => {
        const peaks = desktop
          ? await invoke<number[]>("get_waveform", { path: asset.path })
          : await browserWaveform(asset);
        if (derivedVersions.get(asset.id) === asset.fingerprint)
          waveforms.set(asset.id, peaks);
        await writeDerived(
          `waveform:${asset.id}:${asset.fingerprint}`,
          peaks,
          peaks.length * 8,
        );
      });
    waveformQueue = job;
    await job;
  }
}
export async function sourceUrl(asset: Asset): Promise<string> {
  if (desktop) return convertFileSrc(asset.path);
  const key = `${asset.id}:${asset.fingerprint}`;
  const cached = urls.get(key);
  if (cached) return cached;
  const file = await assetBlob(asset);
  if (!file)
    throw new Error(
      `Media offline: ${asset.name}. Use Relink in the asset menu.`,
    );
  const url = URL.createObjectURL(file);
  urls.set(key, url);
  return url;
}
export function assetStorageKey(asset: Asset) {
  return `${asset.id}:${asset.fingerprint}`;
}
export async function assetBlob(asset: Asset) {
  return (
    (await readLocal<Blob>("media", assetStorageKey(asset))) ??
    (await readLocal<Blob>("media", asset.id))
  );
}
export function invalidateAsset(id: string) {
  for (const [key, url] of urls)
    if (key === id || key.startsWith(id + ":")) {
      URL.revokeObjectURL(url);
      urls.delete(key);
    }
  thumbnails.delete(id);
  waveforms.delete(id);
  derivedErrors.delete(id);
}
export function waitEvent(
  target: EventTarget,
  name: string,
  timeout = 20000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      target.removeEventListener(name, success);
      target.removeEventListener("error", fail);
    };
    const success = () => {
      clean();
      resolve();
    };
    const fail = () => {
      clean();
      reject(
        new Error(
          "Media decoding failed. The system webview may not support this codec. Transcode to H.264/AAC MP4 or PNG.",
        ),
      );
    };
    const timer = setTimeout(() => {
      clean();
      reject(new Error(`Timed out waiting for media ${name}`));
    }, timeout);
    target.addEventListener(name, success, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}
export async function importBrowser(
  files: File[],
): Promise<{ imported: Imported[]; errors: string[] }> {
  const imported: Imported[] = [],
    errors: string[] = [];
  for (const file of files) {
    const id = uid(),
      url = URL.createObjectURL(file);
    try {
      const kind = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : file.type.startsWith("video/")
            ? "video"
            : null;
      if (!kind) throw new Error(`Unsupported file: ${file.name}`);
      const asset: Asset = {
        id,
        name: file.name,
        kind,
        path: file.name,
        size: file.size,
        duration: 0,
        width: 0,
        height: 0,
        fps: 0,
        codec: file.type,
        hasAudio: kind === "audio" || kind === "video",
        fingerprint: `${file.name}:${file.size}:${file.lastModified}`,
      };
      let thumbnail: string | null = null;
      if (kind === "image") {
        const image = new Image();
        image.src = url;
        await image.decode();
        asset.width = image.naturalWidth;
        asset.height = image.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = Math.max(
          1,
          Math.round((320 * image.height) / image.width),
        );
        canvas
          .getContext("2d")!
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL("image/jpeg", 0.75);
      } else {
        const media = document.createElement(
          kind === "audio" ? "audio" : "video",
        );
        media.preload = "auto";
        media.muted = true;
        media.src = url;
        await waitEvent(media, "loadedmetadata");
        if (!Number.isFinite(media.duration) || media.duration <= 0)
          throw new Error("Media duration is not usable.");
        asset.duration = media.duration;
        if (media instanceof HTMLVideoElement) {
          asset.width = media.videoWidth;
          asset.height = media.videoHeight;
          if (media.readyState < 2) await waitEvent(media, "loadeddata");
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = Math.max(
            1,
            Math.round((320 * asset.height) / asset.width),
          );
          canvas
            .getContext("2d")!
            .drawImage(media, 0, 0, canvas.width, canvas.height);
          thumbnail = canvas.toDataURL("image/jpeg", 0.75);
        }
        media.removeAttribute("src");
        media.load();
      }
      await writeLocal("media", assetStorageKey(asset), file);
      urls.set(assetStorageKey(asset), url);
      if (thumbnail) {
        thumbnails.set(id, thumbnail);
        await writeDerived(
          `thumbnail:${id}:${asset.fingerprint}`,
          thumbnail,
          thumbnail.length * 2,
        );
      }
      imported.push({ asset, thumbnail });
    } catch (error) {
      URL.revokeObjectURL(url);
      errors.push(
        `${file.name}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return { imported, errors };
}
async function browserWaveform(asset: Asset): Promise<number[]> {
  const file = await assetBlob(asset);
  if (!file) throw new Error("Waveform source is offline");
  if (file.size > 64 * 1024 * 1024 || asset.duration > 600)
    throw new Error(
      "Browser waveform analysis is limited to 64 MiB / 10 minutes. Use the desktop worker for larger sources.",
    );
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0).slice(),
      worker = new Worker(new URL("./waveform.worker.ts", import.meta.url), {
        type: "module",
      });
    return await new Promise<number[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Waveform worker timed out"));
      }, 30000);
      worker.onmessage = (e) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(e.data);
      };
      worker.onerror = (e) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(e.message));
      };
      worker.postMessage({ samples: data }, [data.buffer]);
    });
  } finally {
    await context.close();
  }
}
export async function importNative() {
  const result = await invoke<{ imported: Imported[]; errors: string[] }>(
    "import_media",
  );
  for (const item of result.imported)
    if (item.thumbnail) {
      item.thumbnail = convertFileSrc(item.thumbnail);
      thumbnails.set(item.asset.id, item.thumbnail);
    }
  return result;
}
export async function relinkNative(assetId: string) {
  const item = await invoke<Imported | null>("relink_media", { assetId });
  if (item) {
    invalidateAsset(assetId);
    if (item.thumbnail) thumbnails.set(assetId, convertFileSrc(item.thumbnail));
  }
  return item?.asset;
}
export async function saveProject(
  project: Project,
  saveAs = false,
): Promise<string | null> {
  parseProject(project);
  if (desktop)
    return invoke<string | null>("save_project", { project, saveAs });
  download(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
    `${project.name}.supp`,
  );
  return `${project.name}.supp`;
}
export function download(blob: Blob, name: string) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function saveImage(blob: Blob, name: string) {
  if (desktop) await invoke("save_png", await blob.arrayBuffer());
  else download(blob, name);
}
export async function openNative() {
  const result = await invoke<Recovery | null>("open_project");
  if (result) result.project = parseProject(result.project);
  return result;
}
let recoveryWrites: Promise<unknown> = Promise.resolve();
export async function autosave(project: Project, path: string | null) {
  const task = recoveryWrites
    .catch(() => undefined)
    .then(async () => {
      if (desktop) await invoke("autosave_project", { project, path });
      else
        await writeLocal("state", "recovery", {
          project,
          path,
          missing: [],
        } satisfies Recovery);
    });
  recoveryWrites = task;
  await task;
}
export async function recovery(restore = false) {
  const result = desktop
    ? await invoke<Recovery | null>("recovery", { restore })
    : await readLocal<Recovery>("state", "recovery");
  if (result) result.project = parseProject(result.project);
  return result ?? null;
}
export async function discardRecovery() {
  const task = recoveryWrites
    .catch(() => undefined)
    .then(async () => {
      if (desktop) await invoke("discard_recovery");
      else await deleteLocal("state", "recovery");
    });
  recoveryWrites = task;
  await task;
}
export async function capabilities(): Promise<Capabilities> {
  return desktop
    ? invoke("probe_capabilities")
    : {
        ffmpeg: false,
        ffprobe: false,
        ffmpegVersion: "",
        encoders: [],
        hardwareAccels: [],
        cpuCores: navigator.hardwareConcurrency || 1,
        platform: "Web companion",
        machine: {
          gpus: [],
          ramBytes: null,
          inventoryError: "Native hardware probes require the desktop app",
          probes: [],
        },
      };
}
export function validateRelink(project: Project, old: Asset, next: Asset) {
  if (old.kind !== next.kind)
    throw new Error("Replacement must have the same media type.");
  const used = project.clips.filter((c) => c.assetId === old.id);
  if (
    next.kind !== "image" &&
    used.some(
      (c) => c.sourceIn + c.duration > Math.ceil(next.duration * fps(project)),
    )
  )
    throw new Error(
      "Replacement is shorter than the media used by this project.",
    );
}
