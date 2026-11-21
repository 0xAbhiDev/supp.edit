// Gradient banding in a region of exported frames, and the tone difference between two exports.
// Per column of the region, along rows: jumps of 2+ codes between neighbouring pixels (visible
// steps), mean plateau length (runs of identical luma; longer = more banded), distinct levels.
// Usage: node scripts/measure-banding.mjs A.mp4 B.mp4 FRAME[,FRAME...] [y0=0] [y1=0.25] [x0=0] [x1=1]
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [a, b, framesArg, y0 = "0", y1 = "0.25", x0 = "0", x1 = "1"] = process.argv.slice(2);
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg",
  ffprobe = env.SUPP_FFPROBE || "ffprobe";
const [W, H] = execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", a], { env }).toString().trim().split(",").map(Number);
const frame = (file, n) => execFileSync(ffmpeg, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { env, maxBuffer: W * H * 3 + 1024 });
const region = { ya: Math.floor(Number(y0) * H), yb: Math.floor(Number(y1) * H), xa: Math.floor(Number(x0) * W), xb: Math.floor(Number(x1) * W) };
const luma = (p, i) => Math.round(0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]);
function measure(p) {
  let jumps = 0,
    runs = 0,
    runTotal = 0;
  const levels = new Set();
  for (let x = region.xa; x < region.xb; x += 4) {
    let run = 1;
    for (let y = region.ya + 1; y < region.yb; y++) {
      const v = luma(p, (y * W + x) * 3),
        u = luma(p, ((y - 1) * W + x) * 3);
      levels.add(v);
      const d = Math.abs(v - u);
      if (d >= 2) jumps++;
      if (d === 0) run++;
      else {
        runs++;
        runTotal += run;
        run = 1;
      }
    }
    runs++;
    runTotal += run;
  }
  return { jumps, meanPlateau: Number((runTotal / Math.max(1, runs)).toFixed(2)), levels: levels.size };
}
const out = [];
for (const n of framesArg.split(",").map(Number)) {
  const pa = frame(a, n),
    pb = frame(b, n);
  let diff = 0,
    count = 0;
  for (let y = region.ya; y < region.yb; y++)
    for (let x = region.xa; x < region.xb; x += 2) {
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) diff += Math.abs(pa[i + c] - pb[i + c]);
      count += 3;
    }
  out.push({ frame: n, a: measure(pa), b: measure(pb), meanToneDifference: Number((diff / count).toFixed(2)) });
}
console.log(JSON.stringify(out, null, 1));
