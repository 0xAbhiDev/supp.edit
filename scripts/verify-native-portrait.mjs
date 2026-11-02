import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment(),
  dir = "test-results/reframe/",
  file = dir + "NATIVE_MANUAL.mp4";
const run = (args) =>
  execFileSync(env.SUPP_FFMPEG, ["-v", "error", "-xerror", ...args], {
    env,
    windowsHide: true,
    maxBuffer: 64e6,
  });
const probe = JSON.parse(
  execFileSync(
    env.SUPP_FFPROBE,
    [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ],
    { env, windowsHide: true, encoding: "utf8" },
  ),
);
const v = probe.streams.find((s) => s.codec_type === "video"),
  a = probe.streams.find((s) => s.codec_type === "audio");
assert.equal(v.codec_name, "h264");
assert.equal(a.codec_name, "aac");
assert.equal(v.width, 1080);
assert.equal(v.height, 1920);
assert.equal(Number(v.nb_read_frames), 600);
assert.equal(Number(v.duration), 20);
const raw = run([
  "-i",
  file,
  "-vf",
  "scale=32:56",
  "-pix_fmt",
  "rgb24",
  "-f",
  "rawvideo",
  "pipe:1",
]);
assert.equal(raw.length, 600 * 5376);
const black = [];
let minimum = 1;
for (let f = 0; f < 600; f++) {
  let sum = 0;
  for (let i = f * 5376; i < (f + 1) * 5376; i++) sum += raw[i];
  const mean = sum / 5376 / 255;
  minimum = Math.min(minimum, mean);
  if (mean < 0.005) black.push(f);
}
assert.equal(black.length, 0);
const pcm = run([
  "-i",
  file,
  "-vn",
  "-ac",
  "1",
  "-ar",
  "8000",
  "-f",
  "f32le",
  "pipe:1",
]);
let energy = 0;
for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
const rms = Math.sqrt(energy / (pcm.length / 4));
assert.ok(rms > 0.005);
const image = (path, filter) =>
  run([
    "-i",
    path,
    ...(filter ? ["-vf", filter] : []),
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
const mae = (a, b) => {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
const comparisons = [];
for (const frame of [0, 10, 21, 300, 599]) {
  const actual = image(file, `select=eq(n\\,${frame})`),
    edited = mae(actual, image(dir + `manual-${frame}.png`));
  assert.ok(
    edited < 12,
    `Frame ${frame} differs from edited reference: ${edited}`,
  );
  const original =
    frame <= 21 ? mae(actual, image(dir + `original-${frame}.png`)) : null;
  if (frame < 21)
    assert.ok(
      edited < original * 0.5,
      `Manual override not visible at ${frame}`,
    );
  comparisons.push({ frame, editedMae: edited, uneditedMae: original });
}
const before = JSON.parse(readFileSync(dir + "NATIVE_BEFORE_MANUAL.supp")),
  manual = JSON.parse(readFileSync(dir + "NATIVE_LANDSCAPE.supp")),
  reopened = JSON.parse(readFileSync(dir + "NATIVE_MANUAL_REOPENED.supp"));
assert.deepEqual(manual.compositions, reopened.compositions);
assert.equal(
  reopened.compositions.at(-1).layers[0].keyframes.x[0].value,
  249.088,
);
before.compositions.at(-1).layers[0].keyframes.x[0].value = 249.088;
assert.deepEqual(before.compositions, reopened.compositions);
const report = {
  videoCodec: v.codec_name,
  audioCodec: a.codec_name,
  width: v.width,
  height: v.height,
  duration: 20,
  decodedFrames: 600,
  blackFrames: black,
  minimumFrameMean: minimum,
  audioRms: rms,
  manualPositionX: 249.088,
  exactNativeReopen: true,
  onlyFirstPositionXKeyChanged: true,
  comparisons,
};
writeFileSync(
  dir + "native-manual-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
run(["-y", "-i", file, "-frames:v", "1", dir + "native-manual-first.png"]);
