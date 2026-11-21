// Validate a delivered movie: a video and an audio stream that decode, the expected duration,
// no audio/video drift, no black frames and no silent stretch. Prints one JSON line; exits 1 on
// any failure. Usage: node scripts/validate-export.mjs RENDER.mp4 EXPECTED_SECONDS [--reference=FILE]
// --reference: a silent or black stretch the reference itself has at the same time (each end
// within 0.2 s, or inside a longer reference stretch; a reference without audio counts as silent
// throughout) is reproduced, not a defect; it is reported under `intended` and does not fail.
import { execFileSync, spawnSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [file, expectedArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const referenceArg = process.argv.find((a) => a.startsWith("--reference="))?.slice(12);
// Project asset paths may carry the Windows extended-length prefix (\\?\), which ffmpeg does not need.
const referenceFile = referenceArg?.startsWith("\\\\?\\") ? referenceArg.slice(4) : referenceArg;
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
const scan = (f) => spawnSync(ffmpeg, ["-v", "info", "-i", f, "-vf", "blackdetect=d=0.06:pix_th=0.10", "-af", "silencedetect=n=-60dB:d=0.5", "-f", "null", "-"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const stretches = (log) => ({
  blacks: [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]),
  silences: [...log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]),
});
const decode = scan(file);
const log = decode.stderr ?? "";
const found = stretches(log);
const ref = referenceFile ? stretches(scan(referenceFile).stderr ?? "") : { blacks: [], silences: [] };
// A reference with no sound at all: silence in the edit is not a defect (nothing to recreate).
const referenceSilent = referenceFile ? !JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", referenceFile], { env }).toString()).streams.some((x) => x.codec_type === "audio") : false;
if (referenceSilent) ref.silences.push([0, Number.MAX_SAFE_INTEGER]);
const inReference = (list) => (x) => list.some((r) => (Math.abs(r[0] - x[0]) <= 0.2 && Math.abs(r[1] - x[1]) <= 0.2) || (r[0] <= x[0] && r[1] >= x[1]));
const blacks = found.blacks.filter((x) => !inReference(ref.blacks)(x)),
  silences = found.silences.filter((x) => !inReference(ref.silences)(x));
const intended = { blacks: found.blacks.filter(inReference(ref.blacks)), silences: found.silences.filter(inReference(ref.silences)) };
const decodeErrors = (log.match(/error|corrupt|invalid/gi) ?? []).length;
const result = {
  file,
  video: video ? { codec: video.codec_name, width: video.width, height: video.height, frames: Number(video.nb_read_frames), seconds: seconds(video) } : null,
  audio: audio ? { codec: audio.codec_name, rate: Number(audio.sample_rate), channels: audio.channels, seconds: seconds(audio) } : null,
  expectedSeconds: expected,
  driftMs: video && audio ? Math.round(Math.abs(seconds(video) - seconds(audio)) * 1000) : null,
  blackFrames: blacks,
  silences,
  ...(referenceFile ? { reference: referenceFile, intended } : {}),
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
