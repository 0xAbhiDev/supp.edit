import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment(),
  dir = path.resolve("test-results/audio-mix"),
  ff = env.SUPP_FFMPEG,
  probe = env.SUPP_FFPROBE;
const original = JSON.parse(
    readFileSync(path.join(dir, "project.supp"), "utf8"),
  ),
  rate = original.settings.fps.num / original.settings.fps.den;
const run = (args) =>
  execFileSync(ff, ["-v", "error", ...args], {
    env,
    windowsHide: true,
    maxBuffer: 80 * 1024 * 1024,
  });
const pcm = (file) =>
  run(["-i", file, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"]);
const decoded = new Map(
  original.assets.filter((a) => a.hasAudio).map((a) => [a.id, pcm(a.path)]),
);
const evaluate = (keys, frame, base) => {
  if (!keys.length) return base;
  keys = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= keys[0].frame) return keys[0].value;
  const i = keys.findIndex((k) => k.frame > frame);
  if (i < 0) return keys.at(-1).value;
  const a = keys[i - 1],
    b = keys[i];
  assert.equal(a.easing, "linear");
  return (
    a.value + ((b.value - a.value) * (frame - a.frame)) / (b.frame - a.frame)
  );
};
const rms = (values) =>
  Math.sqrt(values.reduce((s, x) => s + x * x, 0) / values.length);
const results = [];
for (const mode of ["source-only", "music-only", "speech-and-music"]) {
  const p = structuredClone(original);
  assert.equal(p.clips.length, 1);
  const scope = p.compositions.find((c) => c.id === p.clips[0].compositionId);
  assert.ok(
    scope &&
      p.clips[0].start === 0 &&
      p.clips[0].sourceIn === 0 &&
      p.clips[0].gain === 0,
  );
  for (const t of scope.tracks)
    if (
      (mode === "music-only" && t.kind === "video") ||
      (mode === "source-only" && t.kind === "audio")
    )
      t.muted = true;
  const input = path.join(dir, `${mode}.supp`),
    output = path.join(dir, `${mode}.mp4`);
  writeFileSync(input, JSON.stringify(p));
  execFileSync(
    "cargo",
    [
      "run",
      "-p",
      "supp-export",
      "--example",
      "render_frames",
      "--",
      dir,
      input,
      output,
    ],
    { env, windowsHide: true, stdio: "inherit" },
  );
  const reloaded = JSON.parse(
    readFileSync(input.replace(/\.supp$/, ".reopened.supp"), "utf8"),
  );
  assert.deepEqual(
    reloaded.compositions
      .find((c) => c.id === scope.id)
      .layers.map((c) => c.keyframes.gain),
    scope.layers.map((c) => c.keyframes.gain),
  );
  const meta = JSON.parse(
    execFileSync(
      probe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
      { env, windowsHide: true, encoding: "utf8" },
    ),
  );
  const video = meta.streams.find((s) => s.codec_type === "video"),
    audio = meta.streams.find((s) => s.codec_type === "audio"),
    duration = Math.max(...p.clips.map((c) => c.start + c.duration)) / rate;
  assert.equal(video.codec_name, "h264");
  assert.equal(audio.codec_name, "aac");
  assert.ok(Math.abs(Number(meta.format.duration) - duration) < 0.05);
  run(["-xerror", "-i", output, "-f", "null", "-"]);
  const samples = pcm(output),
    expected = new Float32Array(Math.round(duration * 48000));
  for (const c of scope.layers) {
    if (
      scope.tracks.find((t) => t.id === c.trackId)?.muted ||
      !decoded.has(c.assetId) ||
      c.gain <= -60
    )
      continue;
    assert.ok(
      !c.timeRemap,
      "Intelligible speech must retain normal speed in this acceptance",
    );
    const source = decoded.get(c.assetId),
      start = Math.round((c.start / rate) * 48000),
      length = Math.round((c.duration / rate) * 48000),
      offset = Math.round((c.sourceIn / rate) * 48000);
    for (let i = 0; i < length && start + i < expected.length; i++) {
      const at = (offset + i) * 4;
      if (at + 4 > source.length) break;
      expected[start + i] +=
        source.readFloatLE(at) *
        10 **
          (evaluate(c.keyframes.gain ?? [], (i / 48000) * rate, c.gain) / 20);
    }
  }
  const windows = [];
  const alignment = [];
  if (mode === "source-only")
    for (const [from, to] of [
      [2.3, 3.6],
      [7.6, 8.8],
    ]) {
      let best = { lag: 0, correlation: -1 };
      for (let lag = -4096; lag <= 4096; lag += 8) {
        let aa = 0,
          bb = 0,
          ab = 0;
        for (
          let i = Math.round(from * 48000);
          i < Math.round(to * 48000);
          i += 32
        ) {
          const x = expected[i],
            y = samples.readFloatLE((i + lag) * 4);
          aa += x * x;
          bb += y * y;
          ab += x * y;
        }
        const correlation = ab / Math.sqrt(aa * bb);
        if (correlation > best.correlation) best = { lag, correlation };
      }
      assert.equal(best.lag, 0, `Speech timing drift at ${from}s`);
      assert.ok(
        best.correlation > 0.98,
        `Unexpected speech processing at ${from}s`,
      );
      alignment.push({ from, to, ...best });
    }
  for (let t = 0.4; t < duration - 0.4; t += 0.4) {
    const start = Math.round(t * 48000),
      count = 4800,
      reference = Array.from(expected.subarray(start, start + count));
    const actual = reference.map((_, i) =>
      samples.readFloatLE((start + i) * 4),
    );
    const wanted = rms(reference),
      got = rms(actual);
    if (wanted < 0.001) continue;
    const errorDb = 20 * Math.log10(got / wanted);
    if (Math.abs(errorDb) >= 1.2)
      console.error({ mode, t, wanted, got, errorDb });
    assert.ok(
      Math.abs(errorDb) < 1.2,
      `${mode} gain mismatch at ${t}: ${errorDb} dB`,
    );
    windows.push({
      seconds: Number(t.toFixed(2)),
      errorDb: Number(errorDb.toFixed(3)),
    });
  }
  assert.ok(windows.length > 5);
  let peak = 0,
    sum = 0;
  for (let i = 0; i < samples.length; i += 4) {
    const x = samples.readFloatLE(i);
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  const stereo = run([
    "-i",
    output,
    "-vn",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  let channelPeak = 0;
  for (let i = 0; i < stereo.length; i += 4)
    channelPeak = Math.max(channelPeak, Math.abs(stereo.readFloatLE(i)));
  assert.ok(channelPeak < 1, "Encoded audio clipped");
  assert.ok(sum > 0);
  results.push({
    mode,
    duration,
    frames: Number(video.nb_frames),
    video: video.codec_name,
    audio: audio.codec_name,
    analysisDownmixPeak: peak,
    channelPeak,
    rms: Math.sqrt(sum / (samples.length / 4)),
    windows,
    alignment,
  });
}
writeFileSync(
  path.join(dir, "verification.json"),
  JSON.stringify(results, null, 2),
);
console.log(
  JSON.stringify(
    results.map(({ windows, ...r }) => ({
      ...r,
      maxGainErrorDb: Math.max(...windows.map((w) => Math.abs(w.errorDb))),
    })),
    null,
    2,
  ),
);
