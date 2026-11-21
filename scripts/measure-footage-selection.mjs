// Which raw moments did a recreation choose, against where the right answers were planted?
// Works for one long clip (make-long-footage-case.mjs) or several (make-multi-clip-case.mjs).
// Usage: node scripts/measure-footage-selection.mjs PROJECT.supp TRUTH.json [OUT.json] [--log=native.log]
// --log grades the app's own choices as the preview explained them (before any take was edited),
// from the driver's "Explained each choice" step; otherwise the saved sequence is graded.
import fs from "node:fs";
const [projectFile, truthFile, outFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const logFile = process.argv.find((a) => a.startsWith("--log="))?.slice(6);
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
// True cuts in the raw clips: planted boundaries, unless the case films one continuous camera.
const cutsIn = (clip) => (truth.rawCuts === false ? [] : planted.filter((w) => w.clip === clip).flatMap((w) => [w.startMs, w.endMs]));
const track = [...new Set(c.layers.filter((l) => l.kind === "media" && p.assets.find((a) => a.id === l.assetId)?.kind === "video").map((l) => l.trackId))]
  .map((t) => ({ t, n: c.layers.filter((l) => l.trackId === t).length }))
  .sort((a, b) => b.n - a.n)[0]?.t;
const shots = c.layers.filter((l) => l.trackId === track && l.kind === "media").sort((a, b) => a.start - b.start);
const explained = logFile
  ? JSON.parse(fs.readFileSync(logFile, "utf8").split("\n").find((line) => line.includes("Explained each choice")).replace(/^.*?Explained each choice /, "")).rows.map((t) => {
      // Any media file name (.mp4, .webm, .mov …) followed by its source range.
      const [, a, b, file, inS, outS] = t.match(/^\d+ ([\d.]+)–([\d.]+) s .*? (\S+\.(?:mp4|webm|mov|mkv|m4v|avi)) @ ([\d.]+)–([\d.]+) s/);
      // Builds before the panel showed retimed source ranges reported in + timeline length.
      const slowed = t.match(/slowed to (\d+)%/);
      const span = +outS - +inS;
      return { refStartS: +a, refEndS: +b, file, inS: +inS, outS: slowed && !process.argv.includes("--source-ranges") ? +(+inS + span * (+slowed[1] / 100)).toFixed(2) : +outS };
    })
  : undefined;
const rows = (explained ?? shots).map((l, i) => {
  if (explained) {
    const hit = planted.find((w) => w.clip === l.file && l.inS * 1000 >= w.startMs - 150 && l.outS * 1000 <= w.endMs + 150);
    const mid = ((l.refStartS + l.refEndS) / 2) * 1000;
    let at = 0;
    const playing = truth.shots.find((sh) => {
      const h = mid >= at && mid < at + (sh.lengthS ?? 0) * 1000;
      at += (sh.lengthS ?? 0) * 1000;
      return h;
    });
    return {
      shot: i + 1,
      clip: l.file,
      inS: l.inS,
      outS: l.outS,
      inPlantedMoment: hit ? `${hit.source} ${hit.startMs / 1000}–${hit.endMs / 1000} s` : null,
      referenceExercise: playing?.source ?? null,
      sameExercise: !!hit && hit.source === playing?.source,
      speed: 1,
      crossesCut: cutsIn(l.file).some((t) => t > l.inS * 1000 + 20 && t < l.outS * 1000 - 20),
    };
  }
  const file = fileOf(p.assets.find((a) => a.id === l.assetId));
  // A clip's speed curve consumes source at its key speeds (constant retime: one speed).
  const speed = l.timeRemap?.keys?.length ? l.timeRemap.keys.reduce((a, k) => a + k.speed, 0) / l.timeRemap.keys.length : 1;
  const inMs = Math.round((l.sourceIn * 1000) / rate),
    outMs = Math.round(((l.sourceIn + l.duration * speed) * 1000) / rate);
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
    speed: Number(speed.toFixed(3)),
    crossesCut: cutsIn(file).some((t) => t > inMs + 20 && t < outMs - 20),
  };
});
const overlaps = rows.filter((r, i) => rows.some((o, j) => j < i && o.clip === r.clip && o.inS < r.outS && r.inS < o.outS)).length;
const report = {
  shots: rows,
  inPlantedMoments: `${rows.filter((r) => r.inPlantedMoment).length}/${rows.length}`,
  sameExerciseAsReference: `${rows.filter((r) => r.sameExercise).length}/${rows.length}`,
  fromFirstTenSecondsOfAClip: rows.filter((r) => r.inS < 10).length,
  cutCrossings: rows.filter((r) => r.crossesCut).length,
  retimed: rows.filter((r) => r.speed < 0.999).map((r) => `shot ${r.shot} ×${r.speed}`),
  clipsUsed: [...new Set(rows.map((r) => r.clip))],
  reusedIntervals: overlaps,
};
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
