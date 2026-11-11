// Inspect the encoded edit against its measured reference at corresponding shot and title times.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [directory, inventory = "test-results/reference-gym"] =
  process.argv.slice(2);
if (!directory) throw Error("Supply a render directory");
const json = (dir, name) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const { assets } = json(inventory, "assets.json"),
  dna = json(inventory, "dna.json"),
  project = json(directory, "editable.supp"),
  seq = fs.existsSync(path.join(directory, "project.supp"))
    ? project.compositions.find(
        (c) => c.id === json(directory, "project.supp").clips[0].compositionId,
      )
    : project.compositions.length === 1
      ? project.compositions[0]
      : undefined;
assert(seq, "Exported sequence missing");
const rate = seq.settings.fps.num / seq.settings.fps.den;
const movie = path.join(directory, "render.mp4"),
  env = mediaEnvironment();
const ff = (args, extra = {}) =>
  execFileSync(
    env.SUPP_FFMPEG,
    ["-hide_banner", "-loglevel", "error", ...args],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...extra },
  );
const shots = seq.layers.filter(
  (c) =>
    c.kind === "media" &&
    project.assets.find((a) => a.id === c.assetId)?.kind === "video",
);
assert(
  shots.length === dna.shots.length &&
    shots.every((c) =>
      assets
        .slice(1)
        .some(
          (a) =>
            path.resolve(a.path) ===
            path.resolve(
              project.assets.find((source) => source.id === c.assetId)?.path ??
                "",
            ),
        ),
    ),
);
const titles = seq.layers.filter((c) => c.kind === "text");
const samples = shots.map((c, i) => {
  const title = titles.find(
    (t) => t.start >= c.start && t.start < c.start + c.duration,
  );
  const frame = title
    ? title.start + Math.floor(title.duration / 2)
    : c.start + Math.floor(c.duration / 2);
  const reference = dna.shots[i];
  return {
    frame,
    referenceFrame: Math.round(
      ((reference.startMs +
        ((frame - c.start) / c.duration) *
          (reference.endMs - reference.startMs)) *
        rate) /
        1000,
    ),
    cut: c.start,
    referenceCutMs: reference.startMs,
    sourceIn: c.sourceIn,
    source: c.assetId,
    keys: c.timeRemap?.keys ?? [],
    effects:
      c.effectStack?.map((e) => ({ type: e.type, value: e.value })) ?? [],
  };
});
const contact = path.join(directory, "comparison.png");
const strip = (frames) =>
  "select='" +
  frames.map((frame) => "eq(n," + frame + ")").join("+") +
  "',scale=180:320,tile=" +
  frames.length +
  "x1";
ff([
  "-y",
  "-i",
  assets[0].path,
  "-i",
  movie,
  "-filter_complex",
  "[0:v]" +
    strip(samples.map((s) => s.referenceFrame)) +
    "[ref];[1:v]" +
    strip(samples.map((s) => s.frame)) +
    "[out];[ref][out]vstack[v]",
  "-map",
  "[v]",
  "-frames:v",
  "1",
  contact,
]);
const decoded = ff([
  "-i",
  movie,
  "-vf",
  "scale=32:48",
  "-pix_fmt",
  "gray",
  "-f",
  "rawvideo",
  "pipe:1",
]);
assert.equal(decoded.length, seq.duration * 32 * 48);
let black = 0;
for (let offset = 0; offset < decoded.length; offset += 32 * 48) {
  if (decoded.subarray(offset, offset + 32 * 48).every((v) => v <= 10)) black++;
}
assert.equal(black, 0);
const map = json(inventory, "2-audio.json").audio.beatMap;
const beats = [...map.onsets, ...map.beats].map((e) => e.timeMs);
const offsets = samples
  .slice(1)
  .map((s) =>
    Math.round(
      Math.min(...beats.map((ms) => Math.abs(ms - (s.cut * 1000) / rate))),
    ),
  );
const audioRate = 8000;
const pcm = (file) => {
  const bytes = ff([
    "-i",
    file,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(audioRate),
    "-f",
    "f32le",
    "pipe:1",
  ]);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
};
const suppliedMusic = project.assets.find(
  (a) => a.kind === "audio" && seq.layers.some((c) => c.assetId === a.id),
);
const audioChecks = [];
if (suppliedMusic) {
  const actual = pcm(movie),
    source = pcm(suppliedMusic.path),
    count = Math.min(source.length, actual.length);
  const window = Math.min(8000, Math.floor(count / 5));
  for (const fraction of [0.08, 0.43, 0.8]) {
    const start = Math.min(
      count - window - 641,
      Math.max(641, Math.round(count * fraction)),
    );
    if (start < 641 || window < 256) continue;
    let best = { lagSamples: 0, correlation: 0 };
    for (let lag = -640; lag <= 640; lag++) {
      let xx = 0,
        yy = 0,
        xy = 0;
      for (let i = start; i < start + window; i += 2) {
        const x = source[i],
          y = actual[i + lag];
        xx += x * x;
        yy += y * y;
        xy += x * y;
      }
      const correlation = xy / Math.max(1e-12, Math.sqrt(xx * yy));
      if (correlation > best.correlation)
        best = { lagSamples: lag, correlation };
    }
    audioChecks.push({
      atSeconds: start / audioRate,
      lagMs: (best.lagSamples * 1000) / audioRate,
      correlation: best.correlation,
    });
  }
}
assert.equal(
  audioChecks.length,
  3,
  "Expected supplied music at three timeline positions",
);
assert(
  audioChecks.every(
    (c) => Math.abs(c.lagMs) < 1000 / audioRate && c.correlation > 0.98,
  ),
  "Supplied music drift or mismatch",
);
const report = {
  audioChecks,
  sequence: seq.name,
  frames: seq.duration,
  blackFrames: black,
  nearestSuppliedMusicEventMs: offsets,
  samples,
};
fs.writeFileSync(
  path.join(directory, "comparison.json"),
  JSON.stringify(report, null, 2),
);
console.log(seq.name, offsets, contact);
