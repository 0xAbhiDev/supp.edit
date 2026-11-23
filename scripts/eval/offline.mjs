// Footage selection offline over the captured evaluation set (capture.mjs), graded like the app's
// score card. For developing: seconds per pair instead of minutes in the app. Confirm any change
// with an app run (run.mjs), which stays the measure that counts.
// Usage: node scripts/eval/offline.mjs [--only=id,id] [--peaks=RUN_DIR] [--mode="Close Match"] [--out=DIR] [--quiet] [--weights=JSON]
// --peaks takes each pair's action peaks from an app run's log (as the app placed them on audio
// events), so offline and app runs compare like with like.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { calibration, gradePair, labelsSchema, listPairs, pairSchema, pairsDir, readJson, totals, writeJson } from "./lib.mjs";

const option = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const only = option("only")?.split(",");
const peaksDir = option("peaks");
const mode = option("mode") ?? "Close Match";
const out = path.resolve(option("out") ?? "work/eval/offline/latest");
fs.mkdirSync(out, { recursive: true });

const results = [];
for (const item of listPairs().filter((p) => p.prepared && p.split !== "blind" && (!only || only.includes(p.id)))) {
  const dir = path.join(pairsDir(), item.id);
  const inv = path.join(dir, "inventory");
  if (!fs.existsSync(path.join(inv, "done"))) continue;
  const pair = pairSchema.parse(readJson(path.join(dir, "pair.json")));
  const labels = labelsSchema.parse(readJson(path.join(dir, "labels.json")));
  const peaks = peaksDir && fs.existsSync(path.join(peaksDir, `${item.id}.log`)) ? [`--peaks=${path.join(peaksDir, `${item.id}.log`)}`] : [];
  const json = path.join(out, `${item.id}.json`);
  const weights = option("weights") ? [`--weights=${option("weights")}`] : [];
  const run = spawnSync(process.execPath, ["scripts/check-footage-selection.mjs", inv, "", mode, "--identity", ...peaks, ...weights, `--json=${json}`], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (run.status !== 0 || !fs.existsSync(json)) {
    console.log(`${item.id}: failed ${(run.stderr || "").slice(-300)}`);
    continue;
  }
  const report = readJson(json);
  const picks = report.shots.map((r) => {
    const [a, b] = r.ref.split("–").map(Number);
    return {
      appShot: r.shot,
      refStartMs: Math.round(a * 1000),
      refEndMs: Math.round(b * 1000),
      clip: r.clip,
      inMs: Math.round(r.inS * 1000),
      outMs: Math.round(r.outS * 1000),
      confidence: Math.round((r.certainty ?? 0) * 100),
      label: r.label ?? "unlabelled",
      // The evidence behind the pick, for calibration studies (step 4).
      evidence: { role: r.role, certainty: r.certainty, margin: r.margin, rival: r.rival, semantic: r.semantic, coverage: r.coverage, identity: r.identity?.score ?? null, score: r.score, match: r.match },
    };
  });
  const graded = gradePair(labels, picks);
  results.push({ id: item.id, footage: pair.footage, category: pair.category, ...graded });
  const t = graded.totals;
  if (!process.argv.includes("--quiet")) console.log(`${item.id.padEnd(26)} action ${t.rightAction.text.padEnd(6)} moment ${t.rightMoment.text.padEnd(6)} role ${t.rightRole.text.padEnd(6)} flagged ${t.unavailableFlagged.text.padEnd(6)} wrong-close ${t.falseConfident.text}`);
}
const all = results.flatMap((r) => r.shots);
const line = (name, shots) => {
  const t = totals(shots);
  return `${name.padEnd(26)} ${String(t.shots).padStart(3)} shots · action ${t.rightAction.text} · moment ${t.rightMoment.text} · role ${t.rightRole.text} · flagged ${t.unavailableFlagged.text} · wrong close ${t.falseConfident.text}`;
};
console.log("\n" + line("ALL", all));
console.log(line("own footage", results.filter((r) => r.footage === "own").flatMap((r) => r.shots)));
console.log(line("different footage", results.filter((r) => r.footage === "different").flatMap((r) => r.shots)));
for (const role of [...new Set(all.map((s) => s.role ?? "-"))].sort()) console.log(line("role " + role, all.filter((s) => (s.role ?? "-") === role)));
console.log("confidence: " + calibration(all).map((b) => `${b.from}–${b.to}% ${b.rightAction}/${b.shots}`).join(" · "));
writeJson(path.join(out, "summary.json"), { mode, pairs: results.map(({ shots, ...r }) => r), all: totals(all), calibration: calibration(all), shots: results.flatMap((r) => r.shots.map((s) => ({ pair: r.id, ...s }))) });
