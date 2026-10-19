import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { mediaEnvironment } from "./runtime.mjs";
const dir = path.resolve("test-results/fixtures");
mkdirSync(dir, { recursive: true });
const ffmpeg = mediaEnvironment().SUPP_FFMPEG || "ffmpeg";
function ff(args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    windowsHide: true,
    stdio: "inherit",
  });
}
ff([
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=30",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000",
  "-t",
  "3",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  path.join(dir, "footage.mp4"),
]);
ff([
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=48000",
  "-t",
  "3",
  path.join(dir, "tone.wav"),
]);
ff([
  "-f",
  "lavfi",
  "-i",
  "color=c=0x325a7c:size=640x360",
  "-frames:v",
  "1",
  path.join(dir, "still.png"),
]);
console.log(`Test-only media written to ${dir}`);
