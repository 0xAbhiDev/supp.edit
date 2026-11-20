// Validate a delivered movie: a video and an audio stream that decode, the expected duration,
// no audio/video drift, no black frames and no silent stretch. Prints one JSON line; exits 1 on
// any failure. Usage: node scripts/validate-export.mjs RENDER.mp4 EXPECTED_SECONDS
import { execFileSync, spawnSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [file, expectedArg] = process.argv.slice(2);
if (!file || !expectedArg) throw Error("Usage: validate-export.mjs RENDER.mp4 EXPECTED_SECONDS");
const expected = Number(expectedArg);
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg",
  ffprobe = env.SUPP_FFPROBE || "ffprobe";
const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", file], { env }).toString());
const video = probe.streams.find((s) => s.codec_type === "video"),
  audio = probe.streams.find((s) => s.codec_type === "audio");
const seconds = (s) => (s ? Number(s.duration ?? probe.format.duration) : NaN);
// Decode everything once: black frames (≥ 2 frames below 10% luma) and silence (≥ 0.5 s at -60 dB).
const decode = spawnSync(ffmpeg, ["-v", "info", "-i", file, "-vf", "blackdetect=d=0.06:pix_th=0.10", "-af", "silencedetect=n=-60dB:d=0.5", "-f", "null", "-"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const log = decode.stderr ?? "";
const blacks = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const silences = [...log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const decodeErrors = (log.match(/error|corrupt|invalid/gi) ?? []).length;
const result = {
  file,
  video: video ? { codec: video.codec_name, width: video.width, height: video.height, frames: Number(video.nb_read_frames), seconds: seconds(video) } : null,
  audio: audio ? { codec: audio.codec_name, rate: Number(audio.sample_rate), channels: audio.channels, seconds: seconds(audio) } : null,
  expectedSeconds: expected,
  driftMs: video && audio ? Math.round(Math.abs(seconds(video) - seconds(audio)) * 1000) : null,
  blackFrames: blacks,
  silences,
  decodeExit: decode.status,
  decodeErrors,
};
const failures = [];
if (!video || !(result.video.frames > 0)) failures.push("no decodable video");
if (!audio) failures.push("no audio stream");
if (video && Math.abs(seconds(video) - expected) > 0.1) failures.push(`video lasts ${seconds(video).toFixed(3)} s, expected ${expected}`);
if (result.driftMs !== null && result.driftMs > 60) failures.push(`audio and video lengths differ by ${result.driftMs} ms`);
if (blacks.length) failures.push(`${blacks.length} black stretch(es)`);
if (silences.length) failures.push(`${silences.length} silent stretch(es)`);
if (decode.status !== 0) failures.push("decode failed");
result.ok = failures.length === 0;
result.failures = failures;
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
