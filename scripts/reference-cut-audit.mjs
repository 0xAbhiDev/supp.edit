// Audit reference cut detection against ground truth: for every reference inventory with known
// cut times, list each true cut's strict verdict (the reference mode) and its non-strict evidence,
// and every strict cut that is not a true cut. References without ground truth list their strict
// cuts only (a regression baseline). Prints JSON; --out=FILE also writes it.
// Usage: node scripts/reference-cut-audit.mjs [--out=FILE]
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const outFile = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : undefined);
const shotCuts = (truth) => {
  let at = 0;
  const cuts = [];
  for (const s of truth.shots.slice(0, -1)) {
    at += Math.round(s.lengthS * 1000);
    cuts.push(at);
  }
  return cuts;
};
const corpusCuts = (name) => read(`test-results/audio31/corpus/${name}/truth.json`)?.cuts.map((c) => c.ms);
const cases = [
  ["gym 90 s", "test-results/footage/long90/inventory-dense", shotCuts(read("test-results/footage/long90/truth.json"))],
  ["gym 15 s (multi)", "test-results/footage/multi/inventory", shotCuts(read("test-results/footage/multi/truth.json"))],
  ["gym 15 s (11 min copy)", "test-results/footage/long11/inventory", shotCuts(read("test-results/footage/long11/truth.json"))],
  ["travel", "test-results/footage/travel/inventory", shotCuts(read("test-results/footage/travel/truth.json"))],
  ["cooking", "test-results/footage/cooking/inventory", shotCuts(read("test-results/footage/cooking/truth.json"))],
  ["workshop holdout", "test-results/footage/holdout-workshop/inventory", shotCuts(read("test-results/footage/holdout-workshop/truth.json"))],
  ["street holdout", "test-results/footage/holdout-street/inventory", shotCuts(read("test-results/footage/holdout-street/truth.json"))],
  ["corpus S1 letterbox", "test-results/audio3/s1-inventory", corpusCuts("s1-letterbox-lyrics")],
  ["corpus S3 dialogue", "test-results/audio31/s3-dialogue-music-inventory", corpusCuts("s3-dialogue-music")],
  ["corpus S4 beat montage", "test-results/audio31/s4-beat-montage-inventory", corpusCuts("s4-beat-montage")],
  ["reel 54", "test-results/fidelity2/54", null],
  ["reel 55", "test-results/fidelity2/55", null],
  ["coastal", "test-results/reference-coastal", null],
];
const server = await createServer({ appType: "custom", server: { middlewareMode: true, watch: null }, logLevel: "error" });
const report = [];
try {
  const { frameCuts } = await server.ssrLoadModule("/packages/ai/reference/cuts.ts");
  for (const [name, dir, truth] of cases) {
    const frames = read(path.join(dir, "0-visual.json"));
    if (!frames) {
      report.push({ name, missing: true });
      continue;
    }
    const text = read(path.join(dir, "text.json"));
    const lines = Array.isArray(text) ? text : (text?.lines ?? []);
    const people = read(path.join(dir, "0-person.json")) ?? [];
    const strict = frameCuts(frames, people, lines, true);
    const loose = frameCuts(frames, [], [], false);
    const near = (list, t) => list.find((c) => Math.abs(c.timeMs - t) <= 40);
    const entry = { name, frames: frames.length, strict: strict.map((c) => c.timeMs) };
    if (truth) {
      entry.truth = truth;
      entry.cuts = truth.map((t) => {
        const s = near(strict, t),
          l = near(loose, t);
        return { atMs: t, strict: !!s, looseEvidence: l ? l.evidence : null, strictEvidence: s ? s.evidence : null };
      });
      const tp = entry.cuts.filter((c) => c.strict).length;
      entry.truePositives = tp;
      entry.falseNegatives = truth.length - tp;
      entry.falsePositives = strict.filter((c) => !truth.some((t) => Math.abs(c.timeMs - t) <= 40)).map((c) => [c.timeMs, c.evidence.join("+")]);
    }
    report.push(entry);
  }
} finally {
  await server.close();
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
for (const r of report) {
  if (r.missing) {
    console.log(r.name, "— no inventory");
    continue;
  }
  if (!r.truth) {
    console.log(`${r.name}: strict cuts ${r.strict.join(", ")}`);
    continue;
  }
  console.log(`${r.name}: TP ${r.truePositives}/${r.truth.length}, FN ${r.falseNegatives}, FP ${r.falsePositives.length}${r.falsePositives.length ? " " + JSON.stringify(r.falsePositives) : ""}`);
  for (const c of r.cuts.filter((c) => !c.strict)) console.log(`   missed ${c.atMs}: non-strict ${c.looseEvidence ? c.looseEvidence.join("+") : "not found"}`);
}
