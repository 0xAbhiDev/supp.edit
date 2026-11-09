import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment(),
  dir = "test-results/typography-treatments",
  project = JSON.parse(fs.readFileSync(path.join(dir, "project.supp")));
// Compare decoded output to renderer frames inside each treatment's changing pixels.
function decode(input) {
  return execFileSync(
    env.SUPP_FFMPEG,
    [
      "-v",
      "error",
      "-i",
      input,
      "-vf",
      "scale=180:320",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-an",
      "pipe:1",
    ],
    { maxBuffer: 130_000_000, windowsHide: true },
  );
}
const movie = decode(path.join(dir, "render.mp4")),
  reference = decode(path.join(dir, "%d.png")),
  stride = 180 * 320 * 3;
assert.equal(movie.length, reference.length);
const rows = [];
for (const c of project.clips.filter((c) => c.kind === "text")) {
  const first = c.start * stride,
    last = (c.start + c.duration - 1) * stride;
  let samples = 0,
    error = 0,
    contrast = 0,
    exitError = 0;
  for (let offset = first + stride; offset < last; offset += stride) {
    for (let i = 0; i < stride; i++) {
      const change = Math.abs(reference[offset + i] - reference[first + i]);
      if (change < 15) continue;
      samples++;
      contrast += change;
      error += Math.abs(movie[offset + i] - reference[offset + i]);
    }
  }
  for (let i = 0; i < stride; i++)
    exitError += Math.abs(movie[last + i] - movie[first + i]);
  assert(
    samples > 500 &&
      error / samples < (contrast / samples) * 0.4 &&
      exitError / stride < 2,
    c.name + " decoded animation differs",
  );
  rows.push({
    treatment: c.name,
    activeSamples: samples,
    meanSignal: contrast / samples,
    meanError: error / samples,
  });
}
assert.equal(rows.length, 20);
fs.writeFileSync(
  path.join(dir, "decoded-verification.json"),
  JSON.stringify(rows, null, 2),
);
console.log(
  rows.length +
    " treatments verified in " +
    movie.length / stride +
    " decoded frames",
);
