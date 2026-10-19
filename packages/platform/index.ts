import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  type Asset,
  type Project,
  uid,
  parseProject,
  fps,
} from "../project-schema";
import { readLocal, writeLocal, deleteLocal, type Recovery } from "./storage";
export const desktop = isTauri();
export interface Capabilities {
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegVersion: string;
  encoders: string[];
  hardwareAccels: string[];
  cpuCores: number;
  platform: string;
}
export interface Imported {
  asset: Asset;
  thumbnail: string | null;
}
const urls = new Map<string, string>();
export const thumbnails = new Map<string, string>();
export const waveforms = new Map<string, number[]>();
export async function restoreThumbnail(asset: Asset): Promise<void> {
  if (thumbnails.has(asset.id) || asset.kind === "audio") return;
  if (desktop) {
    const path = await invoke<string | null>("get_thumbnail", {
      assetId: asset.id,
      path: asset.path,
    });
    if (path) thumbnails.set(asset.id, convertFileSrc(path));
  } else {
    const cached = await readLocal<string>("state", `thumbnail:${asset.id}`);
    if (cached) thumbnails.set(asset.id, cached);
  }
}
export async function sourceUrl(asset: Asset): Promise<string> {
  if (desktop) return convertFileSrc(asset.path);
  const cached = urls.get(asset.id);
  if (cached) return cached;
  const file = await readLocal<Blob>("media", asset.id);
  if (!file)
    throw new Error(
      `Media offline: ${asset.name}. Use Relink in the asset menu.`,
    );
  const url = URL.createObjectURL(file);
  urls.set(asset.id, url);
  return url;
}
export function invalidateAsset(id: string) {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  thumbnails.delete(id);
  waveforms.delete(id);
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
      await writeLocal("media", id, file);
      urls.set(id, url);
      if (thumbnail) {
        thumbnails.set(id, thumbnail);
        await writeLocal("state", `thumbnail:${id}`, thumbnail);
      }
      imported.push({ asset, thumbnail });
      if (kind === "audio" && file.size < 64 * 1024 * 1024)
        void extractWaveform(id, file).catch(() => {
          /* Waveforms are optional; decoding errors surface in playback. */
        });
    } catch (error) {
      URL.revokeObjectURL(url);
      errors.push(
        `${file.name}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return { imported, errors };
}
async function extractWaveform(id: string, file: File) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer()),
      data = buffer.getChannelData(0),
      peaks: number[] = [];
    const step = Math.max(1, Math.floor(data.length / 400));
    for (let i = 0; i < data.length; i += step) {
      let peak = 0;
      for (let j = i; j < Math.min(data.length, i + step); j++)
        peak = Math.max(peak, Math.abs(data[j]));
      peaks.push(peak);
    }
    waveforms.set(id, peaks);
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
