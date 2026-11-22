// Labelling aid: where the picture changes in a video (hard cuts, flashes, fades), from the
// correlation of neighbouring small grey frames. Flat frames (black, white, fades) are reported
// as spans. Usage: node scripts/eval/cuts.mjs VIDEO [--fps=25] [--below=0.5]
import { greyFrames, normalise, correlation } from "./frames.mjs";

const video = process.argv.slice(2).find((a) => !a.startsWith("--"));
const opt = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d);
const fps = opt("fps", 25),
  below = opt("below", 0.5);
const raw = greyFrames(video, fps, null).frames;
const frames = raw.map(normalise);
const mean = (f) => f.reduce((a, b) => a + b, 0) / f.length;
const events = [];
let flat = null;
for (let i = 1; i < frames.length; i++) {
  const t = (i / fps).toFixed(2);
  if (!frames[i]) {
    flat ??= { from: t, level: Math.round(mean(raw[i])) };
    continue;
  }
  if (flat) {
    events.push(`flat ${flat.from}–${t} s (grey level ${flat.level})`);
    flat = null;
  }
  if (frames[i - 1]) {
    const c = correlation(frames[i - 1], frames[i]);
    if (c < below) events.push(`cut ${t} s (similarity ${c.toFixed(2)})`);
  }
}
if (flat) events.push(`flat ${flat.from}–end (grey level ${flat.level})`);
console.log(events.join("\n"));
