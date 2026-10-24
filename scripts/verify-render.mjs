import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment();
const dir = path.resolve(process.argv[2] || "test-results/render-media"),
  output = path.join(dir, "render.mp4"),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg",
  ffprobe = env.SUPP_FFPROBE || "ffprobe";
const project = JSON.parse(
  fs.readFileSync(path.join(dir, "project.supp"), "utf8"),
);
const probe = JSON.parse(
  execFileSync(
    ffprobe,
    [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      output,
    ],
    { windowsHide: true, encoding: "utf8" },
  ),
);
const v = probe.streams.find((s) => s.codec_type === "video"),
  a = probe.streams.find((s) => s.codec_type === "audio"),
  frames = Math.max(...project.clips.map((c) => c.start + c.duration));
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
assert(
  v.width === project.settings.width && v.height === project.settings.height,
  "Output dimensions mismatch",
);
assert(Number(v.nb_read_frames) === frames, "Encoded frame count mismatch");
assert(a?.codec_name === "aac", "AAC audio stream missing");
const raw = (file, args = []) =>
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      file,
      ...args,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { windowsHide: true, maxBuffer: 128 * 1024 * 1024 },
  );
const sampledPixelErrors = [
  ...new Set([0, Math.floor(frames / 2), frames - 1]),
].map((frame) => {
  const expected = raw(path.join(dir, `${frame}.png`)),
    actual = raw(output, ["-vf", `select=eq(n\\,${frame})`]);
  assert(expected.length === actual.length, "Pixel buffer lengths differ");
  let error = 0;
  for (let i = 0; i < actual.length; i++)
    error += Math.abs(actual[i] - expected[i]);
  const mae = error / actual.length;
  assert(
    mae < 12,
    `Encoded frame ${frame} diverges from preview: mean error ${mae}`,
  );
  return { frame, mae };
});
const mae = sampledPixelErrors[0].mae;
const audio = execFileSync(
  ffmpeg,
  [
    "-v",
    "error",
    "-i",
    output,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ],
  { windowsHide: true, maxBuffer: 128 * 1024 * 1024 },
);
let energy = 0;
for (let i = 0; i < audio.length; i += 4) energy += audio.readFloatLE(i) ** 2;
const rms = Math.sqrt(energy / (audio.length / 4));
if (process.argv.includes("--silent-source"))
  assert(rms < 0.00001, `Expected silent source audio, got ${rms}`);
else if (project.assets.some((a) => a.hasAudio))
  assert(rms > 0.005 && rms < 0.5, `Unexpected mixed audio level ${rms}`);
const report = {
  frames,
  width: v.width,
  height: v.height,
  videoCodec: v.codec_name,
  audioCodec: a.codec_name,
  duration: Number(probe.format.duration),
  meanAbsolutePixelError: mae,
  sampledPixelErrors,
  audioRms: rms,
};
fs.writeFileSync(
  path.join(dir, "verification.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
