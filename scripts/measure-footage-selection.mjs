// Which raw moments did a recreation choose, against where the right answers were planted?
// Usage: node scripts/measure-footage-selection.mjs PROJECT.supp TRUTH.json [OUT.json]
import fs from "node:fs";
const [projectFile, truthFile, outFile] = process.argv.slice(2);
if (!truthFile) throw Error("Supply the saved project and truth.json.");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const p = read(projectFile),
  truth = read(truthFile);
const c = p.compositions.at(-1),
  rate = (c.settings.fps ?? p.settings.fps).num / (c.settings.fps ?? p.settings.fps).den;
const raw = p.assets.find((a) => a.path.replace(/^\\\\\?\\/, "").endsWith("long-raw-90s.mp4") || a.name === "long-raw-90s.mp4");
const track = [...new Set(c.layers.filter((l) => l.kind === "media" && p.assets.find((a) => a.id === l.assetId)?.kind === "video").map((l) => l.trackId))]
  .map((t) => ({ t, n: c.layers.filter((l) => l.trackId === t).length }))
  .sort((a, b) => b.n - a.n)[0]?.t;
const shots = c.layers.filter((l) => l.trackId === track && l.kind === "media").sort((a, b) => a.start - b.start);
const rows = shots.map((l, i) => {
  const inMs = Math.round((l.sourceIn * 1000) / rate),
    outMs = Math.round(((l.sourceIn + l.duration) * 1000) / rate);
  const expected = truth.shots[i]?.expectedWindowsMs ?? [];
  const planted = truth.planted.find((w) => inMs >= w.startMs - 200 && outMs <= w.endMs + 200);
  return {
    shot: i + 1,
    source: p.assets.find((a) => a.id === l.assetId)?.name,
    inS: +(inMs / 1000).toFixed(2),
    outS: +(outMs / 1000).toFixed(2),
    editStartS: +(l.start / rate).toFixed(2),
    inPlantedMoment: planted ? `${planted.source} ${planted.startMs / 1000}–${planted.endMs / 1000} s` : null,
    sameExercise: expected.some(([a, b]) => inMs >= a - 200 && outMs <= b + 200),
  };
});
const overlaps = rows.filter((r, i) => rows.some((o, j) => j < i && o.source === r.source && o.inS < r.outS && r.inS < o.outS)).length;
const report = {
  rawDurationS: raw ? raw.duration : null,
  shots: rows,
  inPlantedMoments: `${rows.filter((r) => r.inPlantedMoment).length}/${rows.length}`,
  sameExerciseAsReference: `${rows.filter((r) => r.sameExercise).length}/${rows.length}`,
  fromFirstTenSeconds: rows.filter((r) => r.inS < 10).length,
  reusedIntervals: overlaps,
  spreadS: rows.length ? +(Math.max(...rows.map((r) => r.inS)) - Math.min(...rows.map((r) => r.inS))).toFixed(1) : 0,
};
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
