// Side-by-side comparison video: the reference interval beside the recreation, at the same height,
// with two selectable audio tracks (1: recreation, 2: reference) so sync can be judged by ear.
// Usage: node scripts/compare-av.mjs REFERENCE.mp4 START_MS END_MS RENDER.mp4 OUT.mp4
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [reference, start, end, render, out] = process.argv.slice(2);
if (!out) throw Error("Supply the reference, its in/out milliseconds, the render and an output file.");
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg",
  seconds = (Number(end) - Number(start)) / 1000,
  font = "C\\:/Windows/Fonts/arialbd.ttf",
  label = (text) => `drawtext=fontfile='${font}':text='${text}':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10:x=20:y=20`;
execFileSync(
  ffmpeg,
  [
    "-v", "error", "-y",
    "-ss", String(Number(start) / 1000), "-t", String(seconds), "-i", reference,
    "-t", String(seconds), "-i", render,
    "-filter_complex",
    `[0:v]fps=30,scale=-2:960,setsar=1,${label("Reference")}[a];[1:v]fps=30,scale=-2:960,setsar=1,${label("Recreation")}[b];[a][b]hstack=inputs=2,format=yuv420p[v]`,
    "-map", "[v]", "-map", "1:a:0?", "-map", "0:a:0?",
    "-metadata:s:a:0", "title=Recreation", "-metadata:s:a:1", "title=Reference",
    "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", "-shortest", out,
  ],
  { env, stdio: "inherit" },
);
console.log("wrote", out);
