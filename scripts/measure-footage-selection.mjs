// Which raw moments did a recreation choose, against where the right answers were planted?
// Works for one long clip (make-long-footage-case.mjs) or several (make-multi-clip-case.mjs).
// Usage: node scripts/measure-footage-selection.mjs PROJECT.supp TRUTH.json [OUT.json]
import fs from "node:fs";
const [projectFile, truthFile, outFile] = process.argv.slice(2);
if (!truthFile) throw Error("Supply the saved project and truth.json.");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const p = read(projectFile),
  truth = read(truthFile);
const c = p.compositions.at(-1),
  fpsOf = c.settings.fps ?? p.settings.fps,
  rate = fpsOf.num / fpsOf.den;
const fileOf = (asset) => asset?.path.replace(/^\\\\\?\\/, "").split(/[\\/]/).pop();
// Planted moments name their clip; the single-clip case has one long raw clip.
const planted = truth.planted.map((w) => ({ ...w, clip: w.clip ?? "long-raw-90s.mp4" }));
const track = [...new Set(c.layers.filter((l) => l.kind === "media" && p.assets.find((a) => a.id === l.assetId)?.kind === "video").map((l) => l.trackId))]
  .map((t) => ({ t, n: c.layers.filter((l) => l.trackId === t).length }))
  .sort((a, b) => b.n - a.n)[0]?.t;
const shots = c.layers.filter((l) => l.trackId === track && l.kind === "media").sort((a, b) => a.start - b.start);
const rows = shots.map((l, i) => {
  const file = fileOf(p.assets.find((a) => a.id === l.assetId));
  const inMs = Math.round((l.sourceIn * 1000) / rate),
    outMs = Math.round(((l.sourceIn + l.duration) * 1000) / rate);
  const hit = planted.find((w) => w.clip === file && inMs >= w.startMs - 150 && outMs <= w.endMs + 150);
  // The reference shot playing at this moment of the edit (Close Match keeps reference timing);
  // shot counts can differ when the reference analysis merges two shots.
  const mid = (l.start + l.duration / 2) / rate;
  let at = 0;
  const playing = truth.shots.find((sh) => {
    const hit = mid >= at && mid < at + (sh.lengthS ?? 0);
    at += sh.lengthS ?? 0;
    return hit;
  });
  const wanted = playing?.source;
  return {
    shot: i + 1,
    clip: file,
    inS: +(inMs / 1000).toFixed(2),
    outS: +(outMs / 1000).toFixed(2),
    editStartS: +(l.start / rate).toFixed(2),
    inPlantedMoment: hit ? `${hit.source} ${hit.startMs / 1000}–${hit.endMs / 1000} s` : null,
    referenceExercise: wanted ?? null,
    sameExercise: !!hit && hit.source === wanted,
  };
});
const overlaps = rows.filter((r, i) => rows.some((o, j) => j < i && o.clip === r.clip && o.inS < r.outS && r.inS < o.outS)).length;
const report = {
  shots: rows,
  inPlantedMoments: `${rows.filter((r) => r.inPlantedMoment).length}/${rows.length}`,
  sameExerciseAsReference: `${rows.filter((r) => r.sameExercise).length}/${rows.length}`,
  fromFirstTenSecondsOfAClip: rows.filter((r) => r.inS < 10).length,
  clipsUsed: [...new Set(rows.map((r) => r.clip))],
  reusedIntervals: overlaps,
};
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
