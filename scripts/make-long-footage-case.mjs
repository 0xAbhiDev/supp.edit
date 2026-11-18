// Long-footage acceptance case from local clips: one 90 s raw clip in which the usable action
// sits only at known places (12–14, 31–34, 46–48, 67–70, 82–85 s) between long held frames of
// the same exercises (look-alike but motionless), and an 8 s, 6-shot reference cut from other
// moments of those exercises, with music. truth.json records where the right answers are.
// Usage: node scripts/make-long-footage-case.mjs OUT_DIR
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const out = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Supply an output directory.");
fs.mkdirSync(out, { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const clip = (name) => path.resolve(name === "squat" ? "work/vision/squat.webm" : `work/gym/${name}.webm`);
const W = 1280,
  H = 720,
  FPS = 30;
const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;
// [source, from s, to s] for action; [source, frame s, length s, "hold"] for a held frame.
const timeline = [
  ["bench", 0.3, 12, "hold"],
  ["bench", 2.0, 2],
  ["row", 0.4, 17, "hold"],
  ["deadlift", 2.0, 3],
  ["incline", 0.3, 12, "hold"],
  ["incline", 1.5, 2],
  ["bench", 5.5, 19, "hold"],
  ["row", 1.0, 3],
  ["deadlift", 0.3, 12, "hold"],
  ["squat", 4.0, 3],
  ["squat", 12.0, 5, "hold"],
];
const inputs = [],
  chains = [];
let t = 0;
const planted = [];
timeline.forEach(([name, from, length, hold], k) => {
  if (hold) {
    inputs.push("-ss", String(from), "-i", clip(name));
    chains.push(`[${k}:v]trim=end_frame=1,${fit},loop=loop=${Math.round(length * FPS) - 1}:size=1:start=0,setpts=N/${FPS}/TB[v${k}]`);
  } else {
    inputs.push("-ss", String(from), "-t", String(length), "-i", clip(name));
    chains.push(`[${k}:v]${fit},trim=end_frame=${Math.round(length * FPS)},setpts=PTS-STARTPTS[v${k}]`);
    planted.push({ source: name, startMs: Math.round(t * 1000), endMs: Math.round((t + length) * 1000), sourceFromS: from });
  }
  t += length;
});
const graph = chains.join(";") + ";" + chains.map((_, k) => `[v${k}]`).join("") + `concat=n=${chains.length}:v=1:a=0[out]`;
const raw = path.join(out, "long-raw-90s.mp4");
execFileSync(ffmpeg, ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), raw], { env, stdio: "inherit" });
// Reference: six shots from other moments of the same exercises, 8 s in all, with music.
const shots = [
  ["deadlift", 3.4, 1.3],
  ["bench", 3.2, 0.9],
  ["squat", 5.0, 1.5],
  ["row", 2.5, 1.1],
  ["incline", 2.6, 1.3],
  ["deadlift", 4.4, 1.9],
];
const rin = [],
  rch = [];
shots.forEach(([name, from, length], k) => {
  rin.push("-ss", String(from), "-t", String(length), "-i", clip(name));
  rch.push(`[${k}:v]${fit},trim=end_frame=${Math.round(length * FPS)},setpts=PTS-STARTPTS[r${k}]`);
});
const reference = path.join(out, "reference-8s-6shots.mp4");
execFileSync(
  ffmpeg,
  ["-v", "error", "-y", ...rin, "-i", path.resolve("work/gym/music.wav"), "-filter_complex", rch.join(";") + ";" + rch.map((_, k) => `[r${k}]`).join("") + `concat=n=${shots.length}:v=1:a=0[out]`, "-map", "[out]", "-map", `${shots.length}:a`, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-t", "8", reference],
  { env, stdio: "inherit" },
);
// Which planted moment each reference shot should come from (same exercise).
const expected = shots.map(([name]) => planted.filter((p) => p.source === name).map((p) => [p.startMs, p.endMs]));
fs.writeFileSync(path.join(out, "truth.json"), JSON.stringify({ raw, reference, rawDurationMs: Math.round(t * 1000), planted, shots: shots.map(([source, from, length], i) => ({ source, fromS: from, lengthS: length, expectedWindowsMs: expected[i] })) }, null, 2));
console.log("raw", raw, (t).toFixed(1) + " s; reference", reference);
