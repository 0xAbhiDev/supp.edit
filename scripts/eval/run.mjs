// Run the Windows app on every locked pair of the evaluation set (first automatic edit only, one
// click), then write the score card.
// Usage: node scripts/eval/run.mjs [--split=open,seen] [--only=id,id] [--mode="Smart Adaptation"] [--exe=PATH] [--into=RUN_DIR]
// --into adds pairs to an earlier run of the same build (pairs it already ran are skipped).
// Blind pairs run only with --split=blind --release (release checks), and are scored in aggregate.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { labelsDigest, labelsSchema, listPairs, pairSchema, pairsDir, readJson, runsDir, sha256File, writeJson } from "./lib.mjs";
import { scoreRun } from "./score.mjs";

const option = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const splits = (option("split") ?? "open,seen").split(",");
if (splits.includes("blind") && !process.argv.includes("--release")) throw Error("Blind pairs run only at release checks: add --release.");
const only = option("only")?.split(",");
const mode = option("mode") ?? "Close Match";
const exe = path.resolve(option("exe") ?? process.env.SUPP_EXE ?? "bin/supp-edit.exe");
if (!fs.existsSync(exe)) throw Error(`No application at ${exe}. Build it first.`);
const build = { exe, sha256: sha256File(exe) };
const into = option("into");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
const runDir = into ? path.resolve(into) : path.join(runsDir(), `${stamp}-${build.sha256.slice(0, 8)}`);
fs.mkdirSync(runDir, { recursive: true });
const run = into ? readJson(path.join(runDir, "run.json")) : { build, startedAt: new Date().toISOString(), mode, splits, pairs: [] };
if (into && (run.build.sha256 !== build.sha256 || run.mode !== mode)) throw Error(`${runDir} ran build ${run.build.sha256.slice(0, 8)} in ${run.mode}; this is ${build.sha256.slice(0, 8)} in ${mode}.`);
if (into) run.splits = [...new Set([...run.splits, ...splits])];
const save = () => writeJson(path.join(runDir, "run.json"), run);

const done = new Set(run.pairs.filter((e) => e.status === "ran").map((e) => e.id));
run.pairs = run.pairs.filter((e) => e.status === "ran");
const chosen = listPairs().filter((p) => p.prepared && splits.includes(p.split) && (!only || only.includes(p.id)) && !done.has(p.id));
if (!chosen.length) console.log("No pairs to run: prepare and lock pairs on the labelling page first.");
for (const item of chosen) {
  const dir = path.join(pairsDir(), item.id);
  const pairFile = path.join(dir, "pair.json");
  const pair = pairSchema.parse(readJson(pairFile));
  const labels = labelsSchema.parse(readJson(path.join(dir, "labels.json")));
  const entry = { id: pair.id, split: pair.split, labelsSha256: labelsDigest(labels), log: `${pair.id}.log` };
  run.pairs.push(entry);
  if (!pair.lock) {
    Object.assign(entry, { status: "skipped", reason: "labels not locked" });
    save();
    continue;
  }
  if (pair.lock.sha256 !== entry.labelsSha256) {
    Object.assign(entry, { status: "skipped", reason: "labels changed after locking" });
    save();
    continue;
  }
  const out = path.join(runDir, pair.id);
  fs.mkdirSync(out, { recursive: true });
  const project = path.join(out, "project.supp");
  fs.copyFileSync(path.join(dir, pair.template), project);
  const args = ["scripts/run-native-verification.mjs", project, out, "0", String(pair.reference.durationMs), "--preview-only", ...(mode === "Close Match" ? ["--untouched"] : [`--mode=${mode}`])];
  console.log(`=== ${pair.id} (${pair.category}, ${pair.footage}) ${new Date().toLocaleTimeString()}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { env: { ...process.env, SUPP_EXE: exe }, encoding: "utf8", maxBuffer: 256 << 20 });
  fs.writeFileSync(path.join(runDir, entry.log), (result.stdout ?? "") + (result.stderr ?? ""));
  entry.seconds = Math.round((Date.now() - started) / 1000);
  const explained = fs.existsSync(path.join(out, "explanations.json"));
  Object.assign(entry, result.status === 0 && explained ? { status: "ran" } : { status: "failed", reason: `exit ${result.status}${explained ? "" : ", no explanation recorded"}` });
  console.log(`    ${entry.status} in ${entry.seconds} s`);
  if (entry.status === "ran" && !pair.firstRunAt) {
    pair.firstRunAt = new Date().toISOString();
    writeJson(pairFile, pairSchema.parse(pair));
  }
  save();
}
save();
const { md } = scoreRun(runDir, { showBlind: process.argv.includes("--release") });
console.log("\n" + md + `\nScore card: ${path.join(runDir, "scorecard.md")}`);
