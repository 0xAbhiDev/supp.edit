import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment(),
  dir = path.resolve("test-results/speed-remap"),
  ff = env.SUPP_FFMPEG || "ffmpeg",
  probe = env.SUPP_FFPROBE || "ffprobe";
execFileSync(
  "cargo",
  ["run", "-p", "supp-export", "--example", "render_frames", "--", dir],
  { env, windowsHide: true, stdio: "inherit" },
);
const file = path.join(dir, "render.mp4"),
  run = (args) =>
    execFileSync(ff, ["-v", "error", ...args], {
      env,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
const metadata = JSON.parse(
  execFileSync(
    probe,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
    { env, windowsHide: true, encoding: "utf8" },
  ),
);
const video = metadata.streams.find((s) => s.codec_type === "video"),
  audio = metadata.streams.find((s) => s.codec_type === "audio");
assert.equal(video.codec_name, "h264");
assert.equal(audio.codec_name, "aac");
assert.equal(Number(video.nb_frames), 60);
assert.ok(Math.abs(Number(metadata.format.duration) - 2) < 0.05);
const pixels = run([
    "-xerror",
    "-i",
    file,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-an",
    "pipe:1",
  ]),
  size = 320 * 180 * 3;
assert.equal(pixels.length / size, 60);
const means = Array.from(
  { length: 60 },
  (_, i) =>
    pixels.subarray(i * size, (i + 1) * size).reduce((a, b) => a + b, 0) / size,
);
assert.ok(means.every((m) => m > 5));
const errors = [];
for (const frame of [0, 15, 30, 45, 59]) {
  const reference = run([
    "-i",
    path.join(dir, `${frame}.png`),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
  const decoded = pixels.subarray(frame * size, (frame + 1) * size);
  const mae =
    reference.reduce((n, v, i) => n + Math.abs(v - decoded[i]), 0) / size;
  assert.ok(mae < 8, `Frame ${frame} differs: ${mae}`);
  errors.push({ frame, mae });
}
const pcm = run([
  "-i",
  file,
  "-vn",
  "-ac",
  "1",
  "-ar",
  "48000",
  "-f",
  "f32le",
  "pipe:1",
]);
function hz(from, to) {
  let crossings = 0,
    last = 0;
  for (let i = Math.floor(from * 48000); i < Math.floor(to * 48000); i++) {
    const value = pcm.readFloatLE(i * 4);
    if (i > from * 48000 && value >= 0 && last < 0) crossings++;
    last = value;
  }
  return crossings / (to - from);
}
const openingHz = hz(0.05, 0.15),
  highlightHz = hz(0.95, 1.05);
assert.ok(openingHz > 480 && openingHz < 560, `Opening pitch ${openingHz}`);
assert.ok(
  highlightHz > 260 && highlightHz < 320,
  `Manual .65 speed key not reflected in audio: ${highlightHz}`,
);
const project = JSON.parse(
  readFileSync(path.join(dir, "project.supp"), "utf8"),
);
assert.equal(project.clips[0].timeRemap.keys[1].speed, 0.65);
const result = {
  frames: 60,
  duration: metadata.format.duration,
  width: video.width,
  height: video.height,
  video: video.codec_name,
  audio: audio.codec_name,
  blackFrames: means.filter((m) => m <= 5).length,
  openingHz,
  highlightHz,
  errors,
};
writeFileSync(
  path.join(dir, "verification.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
