// Labelling aid for own-footage pairs: where in the raw clips did each reference shot come from?
// Compares small grey frames (frames.mjs) by correlation, over every raw position and a few
// speeds. Independent of the application's code. A person (or the developer) checks each match
// against the frames before it becomes an exact-moment label.
// Usage: node scripts/eval/find-exact.mjs PAIR_DIR [--shots=labels|draft] [--json=OUT]
import fs from "node:fs";
import path from "node:path";
import { greyFrames, normalise, correlation, pictureArea } from "./frames.mjs";
import { pairSchema, labelsSchema, readJson, writeJson } from "./lib.mjs";

const FPS = 10;
const SPEEDS = [1, 0.5, 0.75, 1.25, 1.5, 2];
/** Edits mostly play footage at its own speed; another speed must fit clearly better. A slowed
 * window spans less raw time and so matches a slow pan almost anywhere. */
const OFF_SPEED = 0.05;
const SAMPLES = 10;

const dir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")));
const which = process.argv.find((a) => a.startsWith("--shots="))?.slice(8) ?? "labels";
const out = process.argv.find((a) => a.startsWith("--json="))?.slice(7);
const pair = pairSchema.parse(readJson(path.join(dir, "pair.json")));
const shots = which === "draft" ? pair.draftShots.map((s, i) => ({ shot: i + 1, ...s })) : labelsSchema.parse(readJson(path.join(dir, "labels.json"))).shots;

// The reference's picture shape (without bars). An edit often crops its footage to another shape
// (16:9 b-roll in a 2.4:1 film frame, a landscape clip in a vertical reel): the raw frames are
// centre-cropped to the reference's shape before comparing.
const refFile = path.join(dir, pair.reference.file);
const refBars = pictureArea(refFile);
const refShape = refBars ? Number(refBars.split(/[=:]/)[1]) / Number(refBars.split(/[=:]/)[2]) : pair.reference.width / pair.reference.height;
const toShape = `crop=w='min(iw\,ih*${refShape.toFixed(4)})':h='min(ih\,iw/${refShape.toFixed(4)})'`;
const ref = greyFrames(refFile, FPS, refBars).frames.map(normalise);
const raws = pair.raw.map((r) => {
  const file = path.join(dir, r.file);
  const bars = pictureArea(file);
  return { file: r.file, frames: greyFrames(file, FPS, [bars, toShape].filter(Boolean).join(",")).frames.map(normalise) };
});

const results = [];
for (const s of shots) {
  // Frames well inside the shot (cuts, dissolves and flashes sit at its edges).
  const a = Math.ceil((s.startMs / 1000) * FPS) + 2,
    b = Math.floor((s.endMs / 1000) * FPS) - 2;
  const picks = [];
  for (let k = 0; k < SAMPLES && b > a; k++) {
    const i = Math.round(a + ((b - a) * k) / (SAMPLES - 1));
    if (ref[i]) picks.push(i);
  }
  const unique = [...new Set(picks)];
  if (unique.length < 3) {
    results.push({ shot: s.shot, startMs: s.startMs, endMs: s.endMs, note: "too short or flat to match" });
    continue;
  }
  const fit = (raw, v, t0) => {
    let sum = 0;
    for (const i of unique) {
      const f = raw.frames[Math.round(t0 + (i - unique[0]) * v)];
      if (!f) return null;
      sum += correlation(ref[i], f);
    }
    return sum / unique.length - (v === 1 ? 0 : OFF_SPEED);
  };
  // Coarse (every third raw frame), then the best places again frame by frame.
  const coarse = [];
  for (const raw of raws)
    for (const v of SPEEDS)
      for (let t0 = 0; t0 < raw.frames.length; t0 += 3) {
        const score = fit(raw, v, t0);
        if (score !== null) coarse.push({ raw, v, t0, score });
      }
  coarse.sort((x, y) => y.score - x.score);
  const found = [];
  for (const c of coarse.slice(0, 40))
    for (let t0 = Math.max(0, c.t0 - 3); t0 <= c.t0 + 3; t0++) {
      const score = fit(c.raw, c.v, t0);
      if (score !== null) found.push({ clip: c.raw.file, speed: c.v, atMs: Math.round((t0 / FPS) * 1000), score });
    }
  found.sort((x, y) => y.score - x.score);
  const best = found[0];
  // The best match elsewhere (more than 2 s away, or another clip): a second take or a lookalike.
  const rival = found.find((f) => f.clip !== best.clip || Math.abs(f.atMs - best.atMs) > 2000);
  // The raw range the whole shot plays: from its first frame at the matched speed.
  const lead = (unique[0] / FPS) * 1000 - s.startMs;
  const startMs = Math.max(0, Math.round(best.atMs - lead * best.speed));
  const endMs = Math.round(startMs + (s.endMs - s.startMs) * best.speed);
  results.push({ shot: s.shot, startMs: s.startMs, endMs: s.endMs, clip: best.clip, speed: best.speed, rawStartMs: startMs, rawEndMs: endMs, lead: Math.round(lead), score: Number(best.score.toFixed(3)), rival: rival && { clip: rival.clip, atMs: rival.atMs, speed: rival.speed, score: Number(rival.score.toFixed(3)) } });
}
for (const r of results)
  console.log(
    r.clip
      ? `shot ${r.shot} ${(r.startMs / 1000).toFixed(2)}–${(r.endMs / 1000).toFixed(2)} → ${r.clip} ${(r.rawStartMs / 1000).toFixed(2)}–${(r.rawEndMs / 1000).toFixed(2)} ×${r.speed} score ${r.score}${r.rival ? ` · next ${r.rival.clip} ${(r.rival.atMs / 1000).toFixed(1)} ×${r.rival.speed} ${r.rival.score}` : ""}`
      : `shot ${r.shot}: ${r.note}`,
  );
if (out) writeJson(out, results);
