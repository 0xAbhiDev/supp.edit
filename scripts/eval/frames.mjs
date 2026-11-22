// Small grey frames of a video for the labelling aids (no application code involved).
import { spawnSync } from "node:child_process";
import { mediaEnvironment } from "../runtime.mjs";

export const W = 64,
  H = 36;
const ffmpeg = () => mediaEnvironment().SUPP_FFMPEG || "ffmpeg";

/** The picture area without letterbox or pillarbox bars (ffmpeg cropdetect over the whole clip). */
export function pictureArea(file) {
  const run = spawnSync(ffmpeg(), ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "fps=1,cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"], { encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 });
  const crops = [...(run.stderr ?? "").matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  return crops.length ? crops.at(-1)[0] : null;
}

/** Frames at `fps`, W×H grey, inside the picture area: { fps, frames: Uint8Array[] }. */
export function greyFrames(file, fps = 10, crop = pictureArea(file)) {
  const filters = [`fps=${fps}`, ...(crop ? [crop] : []), `scale=${W}:${H}:flags=area`, "format=gray"].join(",");
  const run = spawnSync(ffmpeg(), ["-hide_banner", "-loglevel", "error", "-i", file, "-an", "-vf", filters, "-f", "rawvideo", "-"], { windowsHide: true, maxBuffer: 1 << 30 });
  if (run.status !== 0) throw Error(`ffmpeg could not read ${file}: ${run.stderr}`);
  const buf = run.stdout;
  const frames = [];
  for (let o = 0; o + W * H <= buf.length; o += W * H) frames.push(buf.subarray(o, o + W * H));
  return { fps, frames };
}

/** Zero-mean, unit-variance copy of a frame (null when the frame is flat: black, white, a fade). */
export function normalise(f) {
  let sum = 0,
    sq = 0;
  for (const v of f) {
    sum += v;
    sq += v * v;
  }
  const n = f.length,
    mean = sum / n,
    sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  if (sd < 4) return null;
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) z[i] = (f[i] - mean) / sd;
  return z;
}

/** Pearson correlation of two normalised frames. */
export function correlation(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
}
