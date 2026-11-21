// Grade the first automatic edit of a different-footage case against labels written by a person
// before any build ran (labels.json), from the preview's own explanation of each choice (the run
// log's "Explained each choice" step — before any take is swapped or anything edited).
//
// Per labelled reference shot (an app shot maps to the labelled shot holding its midpoint):
//  - available: correct when at least 80% of the picked source interval lies inside an acceptable
//    interval of the same clip; a wrong pick labelled "close match" is a false confident match;
//  - unavailable: appropriate when the app labels it best available / no close match; a "close
//    match" label there is a false confident match;
//  - also reported: the confidence and label the app showed.
// Usage: node scripts/grade-different-footage.mjs LABELS.json REFERENCE_SHOTS.json RUN.log [OUT.json]
import fs from "node:fs";
const [labelsFile, shotsFile, logFile, outFile] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const labels = read(labelsFile),
  reference = read(shotsFile);
const line = fs.readFileSync(logFile, "utf8").split("\n").find((l) => l.includes("Explained each choice"));
if (!line) throw Error("The run log has no explanation step (the run did not reach the preview).");
const rows = JSON.parse(line.replace(/^.*?Explained each choice /, "")).rows;
const picks = rows.map((t) => {
  const m = t.match(/^(\d+) ([\d.]+)–([\d.]+) s .*?(\S+\.(?:mp4|webm|mov|mkv|m4v|avi)) @ ([\d.]+)–([\d.]+) s/);
  if (!m) return null;
  const confidence = t.match(/confidence (\d+)%/);
  const label = /best available candidate|No close source match/.test(t) ? "best available" : /close match/.test(t) ? "close match" : "unlabelled";
  return { appShot: Number(m[1]), refStartS: Number(m[2]), refEndS: Number(m[3]), clip: m[4], inMs: Number(m[5]) * 1000, outMs: Number(m[6]) * 1000, confidence: confidence ? Number(confidence[1]) : null, label, sameFootage: /the same footage as the reference/.test(t) };
}).filter(Boolean);
const shotAt = (ms) => reference.shots.find((s) => ms >= s.startMs && ms < s.endMs) ?? reference.shots.at(-1);
const graded = picks.map((p) => {
  const ref = shotAt(((p.refStartS + p.refEndS) / 2) * 1000);
  const label = labels.shots.find((s) => s.shot === ref.shot);
  const len = Math.max(1, p.outMs - p.inMs);
  const inside = (label.acceptable ?? []).filter((a) => a.clip === p.clip).reduce((best, a) => Math.max(best, Math.max(0, Math.min(a.endMs, p.outMs) - Math.max(a.startMs, p.inMs)) / len), 0);
  const correct = label.available ? inside >= 0.8 : null;
  const verdict = label.available
    ? correct
      ? p.label === "best available" ? "correct (under-confident label)" : "correct"
      : p.label === "close match" ? "wrong, false confident match" : "wrong (flagged best available)"
    : p.label === "close match" ? "unavailable, false confident match" : "unavailable, appropriately flagged";
  return { ...p, referenceShot: ref.shot, shows: ref.shows, available: label.available, insideAcceptable: Number(inside.toFixed(2)), correct, verdict };
});
const available = graded.filter((g) => g.available),
  unavailable = graded.filter((g) => !g.available);
const summary = {
  shots: graded.length,
  availableCorrect: `${available.filter((g) => g.correct).length}/${available.length}`,
  unavailableFlagged: `${unavailable.filter((g) => g.label !== "close match").length}/${unavailable.length}`,
  falseConfidentMatches: graded.filter((g) => /false confident/.test(g.verdict)).length,
  underConfidentCorrect: graded.filter((g) => /under-confident/.test(g.verdict)).length,
};
const result = { summary, shots: graded };
if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify(summary));
for (const g of graded) console.log(`shot ${g.referenceShot} (${g.shows}) → ${g.clip} ${(g.inMs / 1000).toFixed(2)}–${(g.outMs / 1000).toFixed(2)} s · ${g.label} ${g.confidence ?? "?"}% · ${g.verdict}`);
