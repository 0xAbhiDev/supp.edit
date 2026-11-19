import { z } from "zod";
import type { Asset } from "../../project-schema";
import type { JobContext } from "../../jobs";
import { sourceUrl } from "../../platform";
import { seekMedia } from "../../engine/seek-media";
import { readDerived, writeDerived } from "../../platform/derived";
import { frameStripes, frameTone, toneSampleSchema, type ToneSample } from "./tone";

/** Sampled tone of a local video, two frames a second. Cached by content fingerprint. */
export async function sourceTone(
  asset: Asset,
  job: Pick<JobContext, "checkpoint">,
  url?: string,
): Promise<ToneSample[]> {
  const key = "source-tone-v3:" + asset.fingerprint,
    validate = z.array(toneSampleSchema).max(600);
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
    const duration = Math.min(video.duration || asset.duration, 300);
    for (let t = 0.25; t < duration; t += 0.5) {
      await job.checkpoint();
      await seekMedia(video, Math.min(video.duration - 0.00001, t), asset.fps || 30);
      ctx.drawImage(video, 0, 0, w, h);
      samples.push({
        timeMs: Math.round(t * 1000),
        tone: frameTone(ctx.getImageData(0, 0, w, h).data, w, h, 4),
        stripes: frameStripes(ctx.getImageData(0, 0, w, h).data, w, h, 4),
      });
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
  if (samples.length)
    await writeDerived(key, samples, JSON.stringify(samples).length * 2).catch(() => {});
  return samples;
}
