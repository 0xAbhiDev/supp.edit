// Capture each pair's native analysis once (pairs/<id>/inventory), so footage selection can be run
// offline in seconds (offline.mjs) while developing. Same native analysers as the app:
// capture-reference-analysis.mjs (probe, per-frame visual, vision, audio, reference motion and
// text, colour), person outlines (person_mask) and body pose (pose-inventory.mjs).
// Usage: node scripts/eval/capture.mjs [--only=id,id] [--force]
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { mediaEnvironment } from "../runtime.mjs";
import { listPairs, pairSchema, pairsDir, readJson } from "./lib.mjs";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const force = process.argv.includes("--force");
const env = { ...process.env, ...mediaEnvironment() };
const models = env.SUPP_AI_MODELS || path.resolve("work/ai-models");
const example = (name) => path.resolve("target/debug/examples", name + (process.platform === "win32" ? ".exe" : ""));

for (const item of listPairs().filter((p) => p.prepared && (!only || only.includes(p.id)))) {
  const dir = path.join(pairsDir(), item.id);
  const inv = path.join(dir, "inventory");
  if (fs.existsSync(path.join(inv, "done")) && !force) {
    console.log(`${item.id}: captured`);
    continue;
  }
  const pair = pairSchema.parse(readJson(path.join(dir, "pair.json")));
  const files = [pair.reference.file, ...pair.raw.map((r) => r.file)].map((f) => path.join(dir, f));
  const started = Date.now();
  console.log(`${item.id}: capturing ${files.length} videos`);
  const run = spawnSync(process.execPath, ["scripts/capture-reference-analysis.mjs", inv, ...files], { env, encoding: "utf8", maxBuffer: 64 << 20 });
  if (run.status !== 0) {
    console.log(`  failed: ${(run.stderr || run.stdout).slice(-400)}`);
    continue;
  }
  files.forEach((f, i) => {
    const out = execFileSync(example("person_mask"), [models, f], { env, maxBuffer: 512 << 20, windowsHide: true });
    fs.writeFileSync(path.join(inv, `${i}-person.json`), out);
  });
  const pose = spawnSync(process.execPath, ["test-results/footage/pose-inventory.mjs", inv], { env, encoding: "utf8" });
  if (pose.status !== 0) console.log(`  body pose failed: ${pose.stderr.slice(-300)}`);
  fs.writeFileSync(path.join(inv, "done"), new Date().toISOString());
  console.log(`  done in ${Math.round((Date.now() - started) / 1000)} s`);
}
