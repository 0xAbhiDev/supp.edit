import { z } from "zod";
import type { Asset } from "../../project-schema";
import type { JobContext } from "../../jobs";
import { sourceUrl } from "../../platform";
import { seekMedia } from "../../engine/seek-media";
import { readDerived, writeDerived } from "../../platform/derived";
import { frameStripes, frameTone, toneSampleSchema, type ToneSample } from "./tone";

/** Where tone sampling spends its time, per clip (ms), for the analysis profile. */
export const toneProfiles = new Map<string, { samples: number; open: number; seek: number; draw: number; read: number; compute: number; save: number }>();

/** Sampled tone of a local video, two frames a second, over the whole clip. Cached by file identity. */
export async function sourceTone(
  asset: Asset,
  job: Pick<JobContext, "checkpoint">,
  url?: string,
): Promise<ToneSample[]> {
  const key = "source-tone-v4:" + asset.fingerprint,
    validate = z.array(toneSampleSchema).max(14400);
  const cached = validate.safeParse(await readDerived(key).catch(() => undefined));
  if (cached.success && cached.data.length) return cached.data;
  if (typeof document === "undefined") return [];
  const video = document.createElement("video"),
    canvas = document.createElement("canvas");
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  const scale = Math.min(1, 256 / Math.max(asset.width, asset.height)),
    w = (canvas.width = Math.max(1, Math.round(asset.width * scale))),
    h = (canvas.height = Math.max(1, Math.round(asset.height * scale)));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const samples: ToneSample[] = [];
  const prof = { samples: 0, open: 0, seek: 0, draw: 0, read: 0, compute: 0, save: 0 };
  let mark = performance.now();
  const lap = (k: keyof typeof prof) => {
    const now = performance.now();
    prof[k] += now - mark;
    mark = now;
  };
  try {
    const src = url ?? (await sourceUrl(asset));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Loading local footage timed out.")), 20000);
      const finish = (err?: Error) => {
        clearTimeout(timer);
        video.onloadeddata = video.onerror = null;
        err ? reject(err) : resolve();
      };
      video.onloadeddata = () => finish();
      video.onerror = () => finish(new Error("Could not decode local footage."));
      video.src = src;
    });
    lap("open");
    const duration = video.duration || asset.duration;
    for (let t = 0.25; t < duration; t += 0.5) {
      await job.checkpoint();
      mark = performance.now();
      await seekMedia(video, Math.min(video.duration - 0.00001, t), asset.fps || 30);
      lap("seek");
      ctx.drawImage(video, 0, 0, w, h);
      lap("draw");
      // One readback serves both measurements.
      const pixels = ctx.getImageData(0, 0, w, h).data;
      lap("read");
      samples.push({ timeMs: Math.round(t * 1000), tone: frameTone(pixels, w, h, 4), stripes: frameStripes(pixels, w, h, 4) });
      lap("compute");
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
  mark = performance.now();
  if (samples.length)
    await writeDerived(key, samples, JSON.stringify(samples).length * 2).catch(() => {});
  lap("save");
  prof.samples = samples.length;
  toneProfiles.set(asset.fingerprint, Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, Math.round(v)])) as typeof prof);
  return samples;
}
