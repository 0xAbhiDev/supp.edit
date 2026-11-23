// Take choices people made in the app (corrections.rs: take-corrections.jsonl in the app's data
// folder), summarised as evidence for tuning (step 7 of the any-footage plan): which shot roles
// get corrected, and how often the rejected pick had been labelled "close match" (a confident
// label someone overruled). Matches evaluation pairs by the reference's fingerprint.
// Usage: node scripts/eval/corrections.mjs [--file=PATH] [--json=OUT]
import fs from "node:fs";
import path from "node:path";
import { listPairs, pairsDir, readJson, writeJson } from "./lib.mjs";

const file = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? path.join(process.env.APPDATA ?? "", "studio.supp.edit", "take-corrections.jsonl");
const out = process.argv.find((a) => a.startsWith("--json="))?.slice(7);
if (!fs.existsSync(file)) {
  console.log(`No take choices recorded yet (${file}). They are written when you choose another take for a recreated shot.`);
  process.exit(0);
}
const choices = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
// Evaluation pairs by their reference's fingerprint (the app's project template holds it).
const pairOf = new Map();
for (const p of listPairs().filter((x) => x.prepared)) {
  const template = path.join(pairsDir(), p.id, "project.template.supp");
  if (fs.existsSync(template)) pairOf.set(readJson(template).assets[0]?.fingerprint, p.id);
}
const byRole = {};
let overruledClose = 0;
for (const c of choices) {
  const role = c.shot?.role ?? "unknown";
  byRole[role] = (byRole[role] ?? 0) + 1;
  if (c.rejected?.label === "close match") overruledClose++;
}
console.log(`${choices.length} take choices in ${file}`);
console.log(`by the shot's role: ${Object.entries(byRole).map(([r, n]) => `${r} ${n}`).join(" · ")}`);
console.log(`the rejected pick was labelled "close match" ${overruledClose} times (certainty: ${choices.filter((c) => c.rejected?.label === "close match").map((c) => Math.round((c.rejected.certainty ?? 0) * 100) + "%").join(", ") || "—"})`);
const onPairs = choices.filter((c) => pairOf.has(c.reference?.fingerprint));
if (onPairs.length) console.log(`${onPairs.length} were made on evaluation pairs: ${[...new Set(onPairs.map((c) => pairOf.get(c.reference.fingerprint)))].join(", ")}`);
if (out) writeJson(out, { file, choices: choices.map((c) => ({ ...c, pair: pairOf.get(c.reference?.fingerprint) ?? null })) });
