// Labelling aid for own-footage pairs: where in the raw clips did each reference shot come from?
// Compares small grey frames (frames.mjs) by correlation, over every raw position, a few speeds and
// a few centred zooms (an edit may punch in). Independent of the application's code. A person (or
// the developer) checks each match against the frames before it becomes an exact-moment label.
//
// Reports, per shot: the best match, its plateau (every neighbouring position that matches as well,
// within PLATEAU: a static or slowly changing shot looks the same at all of them, so all of them are
// the exact moment), and the best match elsewhere (another take, a lookalike, or the same static shot
// later — "indistinguishable" when it scores as well).
// Usage: node scripts/eval/find-exact.mjs PAIR_DIR [--shots=labels|draft] [--json=OUT]
import path from "node:path";
import { W, H, correlation, greyFrames, greyFramesAt, normalise, pictureArea, zoomView } from "./frames.mjs";
import { labelsSchema, pairSchema, readJson, writeJson } from "./lib.mjs";

const FPS = 10;
/** Raw frames per second: the search's time resolution (0.2 s). */
const RAW_FPS = 5;
const SPEEDS = [1, 0.5, 0.75, 1.25, 1.5, 2];
/** Edits mostly play footage at its own speed and framing; another speed or zoom must fit clearly
 * better. A slowed window spans less raw time and so matches a slow pan almost anywhere. */
const OFF_SPEED = 0.05;
const ZOOMS = [1, 1.25, 1.5];
const OFF_ZOOM = 0.02;
const SAMPLES = 10;
const PLATEAU = 0.015;
/** The raw clips are decoded this much larger than the compared frames, to cut zoomed views from. */
const OVER = 1.5;

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
const toShape = `crop=w='min(iw\\,ih*${refShape.toFixed(4)})':h='min(ih\\,iw/${refShape.toFixed(4)})'`;
const ref = greyFrames(refFile, FPS, refBars).frames.map(normalise);
const bw = Math.round(W * OVER),
  bh = Math.round(H * OVER);
const raws = pair.raw.map((r) => {
  const file = path.join(dir, r.file);
  const big = greyFramesAt(file, RAW_FPS, [pictureArea(file), toShape].filter(Boolean).join(","), bw, bh);
  return { file: r.file, views: ZOOMS.map((z) => big.map((f) => normalise(zoomView(f, bw, bh, z)))) };
});

const ms = (t) => Math.round((t / RAW_FPS) * 1000);
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
  const penalty = (v, zi) => (v === 1 ? 0 : OFF_SPEED) + (zi ? OFF_ZOOM : 0);
  const fit = (frames, v, t0) => {
    let sum = 0;
    for (const i of unique) {
      const f = frames[Math.round(t0 + ((i - unique[0]) / FPS) * RAW_FPS * v)];
      if (!f) return null;
      sum += correlation(ref[i], f);
    }
    return sum / unique.length;
  };
  // Coarse (every other raw frame), then the best places again frame by frame.
  const coarse = [];
  for (const raw of raws)
    raw.views.forEach((frames, zi) => {
      for (const v of SPEEDS)
        for (let t0 = 0; t0 < frames.length; t0 += 2) {
          const score = fit(frames, v, t0);
          if (score !== null) coarse.push({ raw, zi, v, t0, score: score - penalty(v, zi) });
        }
    });
  coarse.sort((x, y) => y.score - x.score);
  const found = [];
  for (const c of coarse.slice(0, 60))
    for (let t0 = Math.max(0, c.t0 - 2); t0 <= c.t0 + 2; t0++) {
      const score = fit(c.raw.views[c.zi], c.v, t0);
      if (score !== null) found.push({ raw: c.raw, zi: c.zi, clip: c.raw.file, speed: c.v, zoom: ZOOMS[c.zi], t0, score: score - penalty(c.v, c.zi) });
    }
  found.sort((x, y) => y.score - x.score);
  const best = found[0];
  // The plateau: neighbouring positions (same clip, speed and zoom) that match about as well.
  const frames = best.raw.views[best.zi];
  const near = (t) => (fit(frames, best.speed, t) ?? -1) - penalty(best.speed, best.zi) >= best.score - PLATEAU;
  let lo = best.t0,
    hi = best.t0;
  while (lo > 0 && near(lo - 1)) lo--;
  while (hi < frames.length - 1 && near(hi + 1)) hi++;
  const rival = found.find((f) => f.clip !== best.clip || f.t0 < lo - RAW_FPS || f.t0 > hi + RAW_FPS);
  // The raw range the whole shot plays: from its first frame at the matched speed.
  const lead = (unique[0] / FPS) * 1000 - s.startMs,
    span = (s.endMs - s.startMs) * best.speed;
  const start = (t) => Math.max(0, Math.round(ms(t) - lead * best.speed));
  results.push({
    shot: s.shot,
    startMs: s.startMs,
    endMs: s.endMs,
    clip: best.clip,
    speed: best.speed,
    zoom: best.zoom,
    rawStartMs: start(best.t0),
    rawEndMs: Math.round(start(best.t0) + span),
    plateau: { startMs: start(lo), endMs: Math.round(start(hi) + span) },
    lead: Math.round(lead),
    score: Number(best.score.toFixed(3)),
    rival: rival && { clip: rival.clip, atMs: ms(rival.t0), speed: rival.speed, zoom: rival.zoom, score: Number(rival.score.toFixed(3)), indistinguishable: rival.score >= best.score - PLATEAU },
  });
}
const sec = (x) => (x / 1000).toFixed(2);
for (const r of results)
  console.log(
    r.clip
      ? `shot ${r.shot} ${sec(r.startMs)}–${sec(r.endMs)} → ${r.clip} ${sec(r.rawStartMs)}–${sec(r.rawEndMs)} ×${r.speed}${r.zoom > 1 ? ` zoom ${r.zoom}` : ""} score ${r.score}` +
          (r.plateau.endMs - r.plateau.startMs > r.rawEndMs - r.rawStartMs + 300 ? ` · plateau ${sec(r.plateau.startMs)}–${sec(r.plateau.endMs)}` : "") +
          (r.rival ? ` · next ${r.rival.clip} ${sec(r.rival.atMs)} ×${r.rival.speed}${r.rival.zoom > 1 ? ` zoom ${r.rival.zoom}` : ""} ${r.rival.score}${r.rival.indistinguishable ? " (indistinguishable)" : ""}` : "")
      : `shot ${r.shot}: ${r.note}`,
  );
if (out) writeJson(out, results);
