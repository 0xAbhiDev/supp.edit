// Measure how closely exported titles and plate tone follow the reference.
// Usage: node scripts/measure-title-fidelity.mjs REFERENCE.mp4 OUTPUT.mp4 DNA.json OUT_DIR [--offset-ms=N]
//
// For every measured title the same ink classifier isolates the lettering in the decoded
// reference frame and in the decoded export frame. Their overlap scores position, size and
// letter shape together; a missing, misplaced or wrongly sized word scores near zero. Plate
// tone compares per-channel percentiles outside the title band. These are measurements of the
// compared attributes only, not an overall perceptual similarity score.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { mediaEnvironment } from "./runtime.mjs";
const [reference, output, dnaPath, destination, ...flags] = process.argv.slice(2);
if (!destination) throw Error("Supply the reference, the export, its DNA JSON and an output directory.");
const offset = Number(flags.find((f) => f.startsWith("--offset-ms="))?.slice(12) ?? 0);
const env = mediaEnvironment();
const dna = JSON.parse(fs.readFileSync(dnaPath, "utf8").replace(/^﻿/, ""));
const probe = (file) =>
  JSON.parse(
    execFileSync(env.SUPP_FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file], { encoding: "utf8", windowsHide: true }),
  ).streams[0];
const size = probe(output),
  w = size.width,
  h = size.height;
const frame = (file, ms) => {
  const data = execFileSync(
    env.SUPP_FFMPEG,
    ["-v", "error", "-nostdin", "-i", file, "-vf", `fps=30,select='eq(n,${Math.round((ms * 30) / 1000)})',scale=${w}:${h}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { env, windowsHide: true, maxBuffer: w * h * 3 + 4096 },
  );
  if (data.length !== w * h * 3) throw Error("Missing frame at " + ms + " ms in " + file);
  return data;
};
fs.mkdirSync(destination, { recursive: true });
const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const { negativeInk, titleStrokes, inkBounds } = await vite.ssrLoadModule("/packages/ai/reference/title-ink.ts");
  const { frameTone } = await vite.ssrLoadModule("/packages/ai/reference/tone.ts");
  const titles = (dna.text ?? []).filter((t) => t.content && t.role !== "persistent-overlay" && t.evidence?.status !== "uncertain");
  const rows = [],
    tiles = [];
  for (const t of titles) {
    const ms = Math.round((t.startMs + t.endMs) / 2);
    const cx = t.x + t.width / 2,
      cy = t.y + t.height / 2;
    const band = {
      x: Math.max(0, Math.floor((cx - t.width * 0.75) * w)),
      y: Math.max(0, Math.floor((cy - t.height * 1.1) * h)),
    };
    band.width = Math.min(w, Math.ceil((cx + t.width * 0.75) * w)) - band.x;
    band.height = Math.min(h, Math.ceil((cy + t.height * 1.1) * h)) - band.y;
    const masks = [frame(reference, ms), frame(output, ms - offset)].map((data) => {
      const ink = negativeInk(data, w, h, 3, band);
      return titleStrokes(ink, band.width, band.height, cy * h - band.y, t.height * h * 0.5, Math.max(6, band.width * band.height * 0.0002));
    });
    let both = 0,
      any = 0;
    for (let i = 0; i < masks[0].length; i++) {
      both += masks[0][i] & masks[1][i];
      any += masks[0][i] | masks[1][i];
    }
    const boxes = masks.map((m) => inkBounds(m, band.width, band.height));
    rows.push({
      title: t.content,
      referenceMs: ms,
      overlap: Number((both / Math.max(1, any)).toFixed(3)),
      referenceInk: boxes[0] && { x: band.x + boxes[0].x, y: band.y + boxes[0].y, width: boxes[0].width, height: boxes[0].height },
      exportInk: boxes[1] && { x: band.x + boxes[1].x, y: band.y + boxes[1].y, width: boxes[1].width, height: boxes[1].height },
    });
    // Reference ink in red, export ink in green, agreement in white.
    const tile = Buffer.alloc(band.width * band.height * 3);
    for (let i = 0; i < masks[0].length; i++) {
      tile[i * 3] = masks[0][i] ? 255 : 0;
      tile[i * 3 + 1] = masks[1][i] ? 255 : 0;
      tile[i * 3 + 2] = masks[0][i] && masks[1][i] ? 255 : 0;
    }
    tiles.push({ tile, band });
  }
  // Plate tone at each shot center, outside the union of title bands.
  const tone = dna.shots.map((shot) => {
    const ms = Math.round((shot.startMs + shot.endMs) / 2);
    const skip = titles.length
      ? (() => {
          const top = Math.min(...titles.map((t) => t.y - t.height * 0.3)),
            bottom = Math.max(...titles.map((t) => t.y + t.height * 1.3));
          return { x: 0, y: Math.max(0, Math.floor(top * h)), width: w, height: Math.ceil((bottom - top) * h) };
        })()
      : undefined;
    const [a, b] = [frameTone(frame(reference, ms), w, h, 3, skip), frameTone(frame(output, ms - offset), w, h, 3, skip)];
    return {
      referenceMs: ms,
      reference: a,
      export: b,
      meanAbsoluteLevels: Number((a.flat().reduce((s, v, i) => s + Math.abs(v - b.flat()[i]), 0) / 15).toFixed(2)),
    };
  });
  const report = {
    reference,
    output,
    titles: rows,
    meanTitleOverlap: Number((rows.reduce((s, r) => s + r.overlap, 0) / Math.max(1, rows.length)).toFixed(3)),
    tone,
    note: "Overlap is intersection over union of isolated lettering in the reference and export frames. Tone is the mean absolute difference of five per-channel percentiles on a 0-255 scale.",
  };
  fs.writeFileSync(path.join(destination, "title-fidelity.json"), JSON.stringify(report, null, 2));
  if (tiles.length) {
    const tw = Math.max(...tiles.map((t) => t.band.width)),
      th = tiles.reduce((s, t) => s + t.band.height, 0);
    const sheet = Buffer.alloc(tw * th * 3);
    let y = 0;
    for (const { tile, band } of tiles) {
      for (let row = 0; row < band.height; row++) tile.copy(sheet, ((y + row) * tw) * 3, row * band.width * 3, (row + 1) * band.width * 3);
      y += band.height;
    }
    execFileSync(env.SUPP_FFMPEG, ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", tw + "x" + th, "-i", "pipe:0", "-frames:v", "1", path.join(destination, "title-fidelity.png")], { input: sheet, env, windowsHide: true });
  }
  console.log(JSON.stringify({ meanTitleOverlap: report.meanTitleOverlap, titles: rows.map((r) => [r.title, r.overlap]), tone: tone.map((t) => t.meanAbsoluteLevels) }));
} finally {
  await vite.close();
}
