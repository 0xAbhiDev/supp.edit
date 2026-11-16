// INVENTORY PLAN_DIR MOVIE OUTPUT_DIR [MODE]. Decode each frame on its own timeline.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [inventory, planDir, movie, out, mode = "Close Match"] =
  process.argv.slice(2);
if (!out)
  throw Error(
    "Supply the inventory, saved plan directory, movie and evidence directory",
  );
const json = (dir, name) =>
  JSON.parse(
    fs.readFileSync(path.join(dir, name), "utf8").replace(/^\uFEFF/, ""),
  );
const project = json(planDir, "Three-modes.supp"),
  dna = json(planDir, "dna.json");
const plan = json(planDir, "plan-report.json").find((p) => p.mode === mode);
const seq = project.compositions.find((c) => c.id === plan.compositionId);
const rate = seq.settings.fps.num / seq.settings.fps.den,
  w = 220,
  h = 220,
  bytes = w * h * 3;
fs.mkdirSync(out, { recursive: true });
const env = mediaEnvironment();
const ff = (args, input) =>
  execFileSync(env.SUPP_FFMPEG, ["-v", "error", ...args], {
    input,
    windowsHide: true,
    maxBuffer: 512 * 1024 * 1024,
  });
const decode = (file) =>
  ff([
    "-i",
    file,
    "-an",
    "-vf",
    `fps=${rate},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x252525`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
const ref = decode(json(inventory, "assets.json").assets[0].path),
  actual = decode(movie);
assert.equal(actual.length, seq.duration * bytes);
const frames = [],
  meaningful = new Set();
for (const m of plan.matches) {
  for (let i = 0; i < m.duration; i++) {
    const f = m.start + i,
      ms =
        m.referenceMs + (i * (m.referenceEndMs - m.referenceMs)) / m.duration;
    const text = (dna.text ?? []).filter(
      (t) => t.startMs <= ms && ms < t.endMs,
    );
    const layers = seq.layers.filter(
      (l) => l.start <= f && f < l.start + l.duration,
    );
    frames.push({
      frame: f,
      referenceMs: ms,
      referenceFrame: Math.min(
        Math.floor(ref.length / bytes) - 1,
        Math.round((ms * rate) / 1000),
      ),
      shot: m.clipId,
      observed: text.map((t) => ({
        words: t.content,
        status: t.evidence?.status ?? null,
      })),
      titles: layers
        .filter((l) => l.kind === "text")
        .map((l) => l.text.content),
      masks: layers.flatMap((l) => l.masks.map((mask) => mask.id)),
      pulse: (dna.colorPulses ?? []).some(
        (p) => p.startMs <= ms && ms < p.endMs,
      ),
    });
    if (!i || i === m.duration - 1 || i === Math.floor(m.duration / 2))
      meaningful.add(f);
  }
}
assert.equal(frames.length, seq.duration);
const signature = (row) =>
  JSON.stringify([row.shot, row.observed, row.titles, row.masks, row.pulse]);
for (let i = 1; i < frames.length; i++)
  if (signature(frames[i]) !== signature(frames[i - 1])) {
    meaningful.add(i - 1);
    meaningful.add(i);
    meaningful.add(Math.min(frames.length - 1, i + 1));
  }
// Sample even where the detector found no text: OCR misses are visible on these sheets.
for (let i = 0; i < frames.length; i += Math.max(1, Math.round(rate / 4)))
  meaningful.add(i);
const indices = Array.from(meaningful).sort((a, b) => a - b);
for (let k = 0; k < indices.length; k += 12) {
  const sheet = Buffer.alloc(2 * w * 3 * h * 4 * 3, 36),
    sw = w * 2 * 3;
  for (const [index, f] of indices.slice(k, k + 12).entries()) {
    const x = (index % 3) * w * 2,
      y = Math.floor(index / 3) * h;
    for (const [side, buf, frame] of [
      [0, ref, frames[f].referenceFrame],
      [1, actual, f],
    ]) {
      for (let row = 0; row < h; row++)
        buf.copy(
          sheet,
          ((y + row) * sw + x + side * w) * 3,
          frame * bytes + row * w * 3,
          frame * bytes + (row + 1) * w * 3,
        );
    }
    frames[f].sheet = {
      file: "events-" + k + ".jpg",
      row: Math.floor(index / 3) + 1,
      column: (index % 3) + 1,
    };
  }
  ff(
    [
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      sw + "x" + 4 * h,
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      path.join(out, "events-" + k + ".jpg"),
    ],
    sheet,
  );
}
fs.writeFileSync(
  path.join(out, "frames.json"),
  JSON.stringify(
    { movie, mode, rate, reference: "left", export: "right", frames },
    null,
    2,
  ),
);
console.log({ frames: frames.length, inspectedPairs: indices.length });
