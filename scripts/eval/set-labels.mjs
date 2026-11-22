// Write a pair's labels from a JSON file (the same checks as the labelling page), optionally lock.
// Usage: node scripts/eval/set-labels.mjs PAIR_DIR LABELS.json [--lock] [--by="who labelled it"]
// LABELS.json: { "shots": [{ "startMs", "endMs", "shows", "role", "energy", "action"?, "note"?,
//   "acceptable": [{ "clip", "startMs", "endMs", "level" }] }] }  (shot numbers and "done" are added)
import fs from "node:fs";
import path from "node:path";
import { labelsDigest, labelsSchema, pairSchema, readJson, shotProblems, writeJson } from "./lib.mjs";

const [dirArg, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!file) throw Error("Usage: node scripts/eval/set-labels.mjs PAIR_DIR LABELS.json [--lock]");
const dir = path.resolve(dirArg);
const by = process.argv.find((a) => a.startsWith("--by="))?.slice(5);
const pair = pairSchema.parse(readJson(path.join(dir, "pair.json")));
if (pair.lock) throw Error(`${pair.id}: labels are locked.`);
const input = readJson(file);
const labels = labelsSchema.parse({
  version: 1,
  ...(by ? { labelledBy: by } : {}),
  updatedAt: new Date().toISOString(),
  shots: input.shots.map((s, i) => ({ shot: i + 1, action: "", note: "", done: true, ...s })),
});
const clips = new Map(pair.raw.map((r) => [r.file, r.durationMs]));
const problems = [];
labels.shots.forEach((s, i) => {
  const next = labels.shots[i + 1];
  if (i === 0 && s.startMs !== 0) problems.push("shot 1 must start at 0");
  if (next && next.startMs !== s.endMs) problems.push(`shot ${s.shot} ends at ${s.endMs} but shot ${next.shot} starts at ${next.startMs}`);
  if (!next && Math.abs(s.endMs - pair.reference.durationMs) > 100) problems.push(`the last shot ends at ${s.endMs}, the reference at ${pair.reference.durationMs}`);
  for (const a of s.acceptable) {
    if (!clips.has(a.clip)) problems.push(`shot ${s.shot}: ${a.clip} is not a raw clip`);
    else if (a.endMs > clips.get(a.clip) + 100) problems.push(`shot ${s.shot}: ${a.clip} ends at ${clips.get(a.clip)}, the range at ${a.endMs}`);
    if (a.level === "exact" && pair.footage === "different") problems.push(`shot ${s.shot}: no exact moment in different footage`);
  }
  const p = shotProblems(s);
  if (p.length) problems.push(`shot ${s.shot}: ${p.join(", ")}`);
});
if (problems.length) throw Error(`${pair.id}:\n  ` + problems.join("\n  "));
writeJson(path.join(dir, "labels.json"), labels);
if (process.argv.includes("--lock")) {
  pair.lock = { sha256: labelsDigest(labels), lockedAt: new Date().toISOString() };
  writeJson(path.join(dir, "pair.json"), pairSchema.parse(pair));
}
const ranges = labels.shots.reduce((n, s) => n + s.acceptable.length, 0);
console.log(`${pair.id}: ${labels.shots.length} shots, ${ranges} ranges${pair.lock ? ", locked" : ""}`);
