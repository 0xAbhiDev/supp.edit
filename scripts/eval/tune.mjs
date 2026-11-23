// Step 4: learn the match weights from the labelled pairs instead of choosing them by hand.
// One weight at a time is scaled down and up; each variant runs the offline selection over every
// captured open and seen pair (offline.mjs) and is graded against the labels. A variant is kept only
// if it gains at least MIN_GAIN on the objective without costing right actions on either own or
// different footage: with a handful of pairs, small gains are noise and would only fit the set.
// Confirm any result in the app on pairs the tuning did not see (run.mjs): the first result
// (peak, composition and quality lowered) gained 4 right actions offline and lost 2 in the app.
// Usage: node scripts/eval/tune.mjs [--mode="Close Match"] [--keys=action,pose] [--rounds=1]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const option = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const mode = option("mode") ?? "Close Match";
const keys = (option("keys") ?? "action,pose,look,framing,motion,peak,composition,tone,quality,scene").split(",");
const rounds = Number(option("rounds") ?? 1);
const MIN_GAIN = 2;
const root = path.resolve("work/eval/tune");
fs.mkdirSync(root, { recursive: true });
const count = (t) => Number(String(t.text).split("/")[0]);
function evaluate(weights, name) {
  const out = path.join(root, name);
  const r = spawnSync(process.execPath, ["scripts/eval/offline.mjs", "--quiet", `--mode=${mode}`, `--out=${out}`, ...(Object.keys(weights).length ? [`--weights=${JSON.stringify(weights)}`] : [])], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw Error(r.stderr.slice(-500));
  const s = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
  const footage = new Map(s.pairs.map((p) => [p.id, p.footage]));
  const group = (f) => s.shots.filter((x) => footage.get(x.pair) === f && x.rightAction === true).length;
  const all = s.all;
  const score = { action: count(all.rightAction), role: count(all.rightRole), wrongClose: count(all.falseConfident), own: group("own"), different: group("different") };
  return { ...score, objective: score.action + 0.5 * score.role - score.wrongClose };
}
const log = (...a) => { console.log(...a); fs.appendFileSync(path.join(root, "tune.log"), a.join(" ") + "\n"); };
let base = {};
let best = evaluate(base, "base");
log(new Date().toISOString(), mode, "base", JSON.stringify(best));
for (let round = 0; round < rounds; round++)
  for (const key of keys)
    for (const factor of [0.6, 1.5]) {
      const current = base[key] ?? null;
      const trial = { ...base, [key]: Number(((current ?? defaultOf(key)) * factor).toFixed(3)) };
      const got = evaluate(trial, `${key}x${factor}`);
      const keep = got.objective >= best.objective + MIN_GAIN && got.own >= best.own && got.different >= best.different;
      log(`${key} ×${factor}`, JSON.stringify(trial), JSON.stringify(got), keep ? "KEPT" : "");
      if (keep) [base, best] = [trial, got];
    }
log("result", JSON.stringify(base), JSON.stringify(best));
function defaultOf(key) {
  const d = { "Close Match": { action: 1.0, pose: 1.2, look: 0.6, framing: 0.5, motion: 0.3, peak: 0.5, composition: 0.3, tone: 0.2, quality: 0.6, scene: 1 } }[mode];
  if (!d || d[key] === undefined) throw Error(`no default weight for ${key} in ${mode}`);
  return d[key];
}
