// Long-form acceptance case: ONE 11-minute raw clip with action moments planted mostly after the
// first five minutes (dense analysis used to stop at 5 minutes), separated by long held frames of
// the same exercises, and the same 15 s, 9-shot reference as the multi-clip case.
// Usage: node scripts/make-long-form-case.mjs OUT_DIR [--26]
// --26: one 26-minute clip with seven of nine action moments after minute 20.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const out = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Supply an output directory.");
fs.mkdirSync(out, { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const source = (name) => path.resolve(name === "squat" ? "work/vision/squat.webm" : `work/gym/${name}.webm`);
const W = 1280,
  H = 720,
  FPS = 30;
const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;
// Planted action per clip: [exercise, at s in the clip, from s in the exercise, length s].
const clips = process.argv.includes("--26")
  ? { "long-26m": { durationS: 1560, plants: [["bench", 100, 0.5, 2], ["deadlift", 420, 1.0, 3], ["incline", 1230, 0.5, 2], ["row", 1280, 0.6, 3], ["squat", 1330, 2.0, 3], ["bench", 1380, 4.6, 2], ["deadlift", 1430, 4.0, 3], ["incline", 1480, 3.8, 2], ["squat", 1530, 9.0, 3]] } }
  : {
  "long-11m": { durationS: 660, plants: [["bench", 40, 0.5, 2], ["deadlift", 170, 1.0, 3], ["incline", 330, 0.5, 2], ["row", 380, 0.6, 3], ["squat", 430, 2.0, 3], ["bench", 500, 4.6, 2], ["deadlift", 560, 4.0, 3], ["incline", 600, 3.8, 2], ["squat", 640, 9.0, 3]] },
};
const holdsFrom = ["bench", "row", "incline", "deadlift", "squat"];
const planted = [];
for (const [name, spec] of Object.entries(clips)) {
  const inputs = [],
    chains = [];
  let t = 0,
    k = 0,
    h = 0;
  const hold = (length) => {
    const ex = holdsFrom[h++ % holdsFrom.length];
    inputs.push("-ss", String(0.3 + (h % 3) * 0.7), "-i", source(ex));
    chains.push(`[${k}:v]trim=end_frame=1,${fit},loop=loop=${Math.round(length * FPS) - 1}:size=1:start=0,setpts=N/${FPS}/TB[v${k}]`);
    k++;
    t += length;
  };
  for (const [ex, at, from, length] of spec.plants) {
    if (at > t) hold(at - t);
    inputs.push("-ss", String(from), "-t", String(length), "-i", source(ex));
    chains.push(`[${k}:v]${fit},trim=end_frame=${Math.round(length * FPS)},setpts=PTS-STARTPTS[v${k}]`);
    k++;
    planted.push({ clip: name + ".mp4", source: ex, startMs: Math.round(at * 1000), endMs: Math.round((at + length) * 1000) });
    t = at + length;
  }
  if (spec.durationS > t) hold(spec.durationS - t);
  const graph = chains.join(";") + ";" + chains.map((_, j) => `[v${j}]`).join("") + `concat=n=${chains.length}:v=1:a=0[out]`;
  execFileSync(ffmpeg, ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-crf", "22", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", String(FPS), path.join(out, name + ".mp4")], { env, stdio: "inherit" });
  console.log(name, spec.durationS + " s");
}
// Reference: nine shots from other moments of the same exercises, 15 s in all, with music.
const shots = [
  ["incline", 2.6, 1.4],
  ["deadlift", 3.4, 1.6],
  ["bench", 3.2, 1.2],
  ["squat", 5.0, 1.8],
  ["row", 2.5, 1.5],
  ["bench", 5.6, 1.4],
  ["deadlift", 5.4, 1.9],
  ["incline", 1.2, 1.6],
  ["squat", 12.5, 2.6],
];
const rin = [],
  rch = [];
shots.forEach(([name, from, length], k) => {
  rin.push("-ss", String(from), "-t", String(length), "-i", source(name));
  rch.push(`[${k}:v]${fit},trim=end_frame=${Math.round(length * FPS)},setpts=PTS-STARTPTS[r${k}]`);
});
const reference = path.join(out, "reference-15s-9shots.mp4");
execFileSync(
  ffmpeg,
  ["-v", "error", "-y", ...rin, "-i", path.resolve("work/gym/music.wav"), "-filter_complex", rch.join(";") + ";" + rch.map((_, k) => `[r${k}]`).join("") + `concat=n=${shots.length}:v=1:a=0[out]`, "-map", "[out]", "-map", `${shots.length}:a`, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-t", "15", reference],
  { env, stdio: "inherit" },
);
fs.writeFileSync(
  path.join(out, "truth.json"),
  JSON.stringify({ reference, planted, shots: shots.map(([source, fromS, lengthS]) => ({ source, fromS, lengthS, expected: planted.filter((p) => p.source === source) })) }, null, 2),
);
console.log("reference", reference);
