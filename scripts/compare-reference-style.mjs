// Compare actual encoded output to independently measured reference shots.
// No aggregate style probability: report measurements, provenance and untested dimensions separately.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { mediaEnvironment } from "./runtime.mjs";
const [inventory, projectFile, movie, mode, compositionId] =
  process.argv.slice(2);
if (!mode) throw Error("Usage: INVENTORY PROJECT.supp MOVIE.mp4 MODE");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(inventory, name), "utf8"));
const p = JSON.parse(fs.readFileSync(projectFile, "utf8"));
const matches = p.compositions.filter((c) =>
  compositionId ? c.id === compositionId : c.name === "Recreation · " + mode,
);
assert.equal(
  matches.length,
  1,
  "Supply the unique exported composition ID when names repeat",
);
const [seq] = matches;
const dna = read("dna.json"),
  { assets } = read("assets.json"),
  ref = assets[0];
const env = mediaEnvironment(),
  dir = path.dirname(movie);
const run = (exe, args, maxBuffer = 64 * 1024 * 1024) =>
  execFileSync(exe, args, { env, windowsHide: true, maxBuffer });
const ff = (args) => run(env.SUPP_FFMPEG, ["-v", "error", ...args]);
const canonical = (file) => fs.realpathSync(file).toLowerCase();
const allowed = new Set(assets.slice(1).map((a) => canonical(a.path)));
const referencePath = canonical(ref.path);
function verifySources(composition, ancestors = new Set()) {
  assert(!ancestors.has(composition.id), "Cyclic composition reference");
  const pathIds = new Set([...ancestors, composition.id]);
  for (const layer of composition.layers) {
    if (layer.assetId) {
      const asset = p.assets.find((a) => a.id === layer.assetId);
      assert(asset, "Missing render source");
      const file = canonical(asset.path);
      assert(
        file !== referencePath && allowed.has(file),
        "Disallowed render source: " + asset.name,
      );
    }
    if (layer.compositionId) {
      const child = p.compositions.find((c) => c.id === layer.compositionId);
      assert(child, "Missing nested composition");
      verifySources(child, pathIds);
    }
  }
}
verifySources(seq);
const shots = seq.layers
  .filter(
    (c) =>
      c.kind === "media" &&
      !/^(Background fill|Foreground person) · /.test(c.name) &&
      p.assets.find((a) => a.id === c.assetId)?.kind === "video",
  )
  .sort((a, b) => a.start - b.start);
assert.equal(shots.length, dna.shots.length, "Shot inventory changed");
const probe = JSON.parse(
  run(env.SUPP_FFPROBE, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    movie,
  ]),
);
const video = probe.streams.find((s) => s.codec_type === "video"),
  audio = probe.streams.find((s) => s.codec_type === "audio");
assert.equal(Number(video.nb_frames), seq.duration);
assert.equal(video.width, seq.settings.width);
assert.equal(video.height, seq.settings.height);
ff(["-i", movie, "-f", "null", "-"]);
const measured = JSON.parse(
  run(path.resolve("target/debug/examples/reference_visual.exe"), [
    path.resolve(movie),
  ]),
);
const server = await createServer({
  appType: "custom",
  server: { middlewareMode: true, watch: null, hmr: false },
});
try {
  const {
    measuredColor,
    measuredLayout,
    layoutSimilarity,
    characterizeTransitions,
  } = await server.ssrLoadModule("/packages/ai/reference/visual.ts");
  const rate = seq.settings.fps.num / seq.settings.fps.den;
  const comparison = shots.map((c, i) => {
    const original = dna.shots[i],
      startMs = (c.start * 1000) / rate,
      endMs = ((c.start + c.duration) * 1000) / rate;
    const color = measuredColor(measured, startMs + 100, endMs - 100);
    return {
      shot: i + 1,
      referenceStartMs: original.startMs,
      generatedStartMs: startMs,
      startDifferenceMs: startMs - original.startMs,
      referenceDurationMs: original.endMs - original.startMs,
      generatedDurationMs: endMs - startMs,
      rawSource: p.assets.find((a) => a.id === c.assetId).name,
      sourceIn: c.sourceIn,
      lumaError:
        color && original.color
          ? Math.abs(color.luma - original.color.luma)
          : null,
      contrastError:
        color && original.color
          ? Math.abs(color.contrast - original.color.contrast)
          : null,
      saturationError:
        color && original.color
          ? Math.abs(color.saturation - original.color.saturation)
          : null,
      spatialLuminanceSimilarity: layoutSimilarity(
        original.layout,
        measuredLayout(measured, startMs + 100, endMs - 100),
      ),
      sourceFrames: c.timeRemap ?? null,
    };
  });
  const originalTransition = dna.transitions.map((t, i) => ({
    ...t,
    generated: characterizeTransitions(
      shots.map((c, j) => ({
        ...dna.shots[j],
        startMs: (c.start * 1000) / rate,
        endMs: ((c.start + c.duration) * 1000) / rate,
      })),
      measured,
      [],
    )[i],
  }));
  const width = 128,
    height = 48,
    stride = width * height;
  const gray = ff([
    "-i",
    movie,
    "-an",
    "-vf",
    "scale=128:48",
    "-pix_fmt",
    "gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  assert.equal(gray.length, seq.duration * stride, "Incomplete frame scan");
  const blackFrames = [],
    darkSideBars = [];
  for (let frame = 0; frame < seq.duration; frame++) {
    const plane = gray.subarray(frame * stride, (frame + 1) * stride);
    if (plane.every((v) => v < 8)) blackFrames.push(frame);
    let rows = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      if ([1, 2, width - 3, width - 2].every((x) => plane[row + x] < 8)) rows++;
    }
    if (rows >= height * 0.95) darkSideBars.push(frame);
  }
  const audioPCM = audio
    ? ff([
        "-i",
        movie,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
      ])
    : null;
  let energy = 0;
  if (audioPCM)
    for (let i = 0; i < audioPCM.length; i += 4)
      energy += audioPCM.readFloatLE(i) ** 2;
  const audioRms = audioPCM ? Math.sqrt(energy / (audioPCM.length / 4)) : null;
  const samples = shots.map((c, i) => ({
    output: c.start + Math.floor(c.duration / 2),
    reference: Math.round(
      (((dna.shots[i].startMs + dna.shots[i].endMs) / 2) * rate) / 1000,
    ),
  }));
  const strip = (frames) =>
    "fps=" +
    rate +
    ",select='" +
    frames.map((f) => "eq(n," + f + ")").join("+") +
    "',scale=240:-2,tile=" +
    frames.length +
    "x1";
  const contact = path.join(dir, "comparison.png");
  ff([
    "-y",
    "-i",
    ref.path,
    "-i",
    movie,
    "-filter_complex",
    "[0:v]" +
      strip(samples.map((s) => s.reference)) +
      "[ref];[1:v]" +
      strip(samples.map((s) => s.output)) +
      "[out];[ref][out]vstack[v]",
    "-map",
    "[v]",
    "-frames:v",
    "1",
    contact,
  ]);
  const report = {
    mode,
    compositionId: seq.id,
    frames: seq.duration,
    durationSeconds: seq.duration / rate,
    codec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    audioRms,
    decoded: true,
    referenceExcluded: true,
    permittedSourceOnly: true,
    blackFrames,
    darkSideBars,
    measurements: comparison,
    transitions: originalTransition,
    interpretation:
      "Spatial luminance similarity is exposure-normalized layout correlation, not semantic identity or an overall style score. Transition confidence is rule evidence strength, not calibrated probability.",
    notTested: [
      "Arbitrary font identification",
      "Original optical speed curves",
      "Learned transition classification",
      "Exact beat synchronization without supplied music",
    ],
    limitations: seq.ai?.warnings ?? [],
  };
  fs.writeFileSync(
    path.join(dir, "comparison.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      mode,
      frames: seq.duration,
      decoded: true,
      audioRms,
      blackFrames: blackFrames.length,
      referenceExcluded: true,
      contact,
    }),
  );
  // Preserve the actual failing frame numbers and comparison before exiting.
  assert.equal(blackFrames.length, 0, "Unexpected fully black frames");
} finally {
  await server.close();
}
