// Score one run of the app over the evaluation set: one score card per build.
// Usage: node scripts/eval/score.mjs RUN_DIR [--show-blind]
// Blind pairs are reported as one aggregate line only, unless --show-blind (release checks).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { calibration, gradePair, labelsDigest, labelsSchema, pairSchema, pairsDir, parsePicks, readJson, rowsFromLog, totals, writeJson } from "./lib.mjs";

const cell = (t) => (t.d ? `${t.text} (${Math.round((100 * t.n) / t.d)}%)` : "–");

export function scoreRun(runDir, { showBlind = false } = {}) {
  const run = readJson(path.join(runDir, "run.json"));
  const results = [],
    problems = [];
  for (const entry of run.pairs) {
    const dir = path.join(pairsDir(), entry.id);
    if (!fs.existsSync(path.join(dir, "pair.json"))) {
      problems.push(`${entry.id}: the pair folder is gone`);
      continue;
    }
    const pair = pairSchema.parse(readJson(path.join(dir, "pair.json")));
    const labels = labelsSchema.parse(readJson(path.join(dir, "labels.json")));
    if (entry.status !== "ran") {
      problems.push(`${entry.id}: ${entry.status}${entry.reason ? " — " + entry.reason : ""}`);
      continue;
    }
    const log = path.join(runDir, entry.log);
    const explanations = path.join(runDir, entry.id, "explanations.json");
    const rows = fs.existsSync(explanations) ? readJson(explanations) : fs.existsSync(log) ? rowsFromLog(fs.readFileSync(log, "utf8")) : undefined;
    if (!rows?.length) {
      problems.push(`${entry.id}: the run recorded no explanation of its choices`);
      continue;
    }
    if (labelsDigest(labels) !== entry.labelsSha256) problems.push(`${entry.id}: the labels changed after this run; graded against the current labels`);
    if (pair.relabelledAfterRun) problems.push(`${entry.id}: relabelled after the app first ran on it, so it no longer counts as unseen`);
    const picks = parsePicks(rows, pair.raw.map((r) => r.file));
    const graded = gradePair(labels, picks);
    results.push({ id: pair.id, name: pair.name, category: pair.category, footage: pair.footage, split: pair.split, picks: picks.length, ...graded });
  }
  const group = (name, list) => ({ group: name, pairs: list.length, ...totals(list.flatMap((r) => r.shots)) });
  const visible = results.filter((r) => r.split !== "blind" || showBlind);
  const groups = [
    group("open", results.filter((r) => r.split === "open")),
    group("seen", results.filter((r) => r.split === "seen")),
    group(showBlind ? "blind" : "blind (aggregate only)", results.filter((r) => r.split === "blind")),
    group("own footage", visible.filter((r) => r.footage === "own")),
    group("different footage", visible.filter((r) => r.footage === "different")),
    ...[...new Set(visible.map((r) => r.category))].sort().map((c) => group(c, visible.filter((r) => r.category === c))),
  ].filter((g) => g.pairs);
  // Results by what each labelled shot does in the edit (its role), over open and seen pairs.
  const shotsVisible = visible.flatMap((r) => r.shots);
  const byRole = [...new Set(shotsVisible.map((s) => s.role ?? "unlabelled"))]
    .sort()
    .map((role) => ({ group: role, pairs: new Set(visible.filter((r) => r.shots.some((s) => (s.role ?? "unlabelled") === role)).map((r) => r.id)).size, ...totals(shotsVisible.filter((s) => (s.role ?? "unlabelled") === role)) }));
  const card = {
    build: run.build,
    startedAt: run.startedAt,
    mode: run.mode,
    pairs: results.length,
    groups,
    byRole,
    calibration: calibration(shotsVisible),
    perPair: visible.map(({ shots, ...rest }) => (rest.split === "blind" && !showBlind ? undefined : { ...rest, shots })).filter(Boolean),
    problems,
  };
  writeJson(path.join(runDir, "scorecard.json"), card);
  const md = [
    `# Test-set score card`,
    ``,
    `- **Build:** \`${run.build.sha256.slice(0, 8)}\` (${run.build.exe})`,
    `- **Run:** ${run.startedAt} · ${run.mode} · ${results.length} pairs graded`,
    `- **Rules:** a pick counts when ${Math.round(0.8 * 100)}% of it lies inside a labelled range of the same clip. "Right action" counts exact-moment and same-action ranges; "fits the role" counts any range.`,
    ``,
    `| Group | Pairs | Shots | Right action | Right moment | Right clip | Fits the role | Missing shots flagged | Wrong among "close match" | Not placed |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...groups.map((g) => `| ${g.group} | ${g.pairs} | ${g.shots} | ${cell(g.rightAction)} | ${cell(g.rightMoment)} | ${cell(g.rightClip)} | ${cell(g.rightRole)} | ${cell(g.unavailableFlagged)} | ${cell(g.falseConfident)} | ${g.notPlaced} |`),
    ``,
    `## By what the shot does${showBlind ? "" : " (open and seen)"}`,
    ``,
    `| Role | Shots | Right action | Fits the role | Missing shots flagged | Wrong among "close match" |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...card.byRole.map((g) => `| ${g.group} | ${g.shots} | ${cell(g.rightAction)} | ${cell(g.rightRole)} | ${cell(g.unavailableFlagged)} | ${cell(g.falseConfident)} |`),
    ``,
    `## Confidence against results${showBlind ? "" : " (open and seen)"}`,
    ``,
    `| Confidence shown | Shots | Right action |`,
    `| --- | --- | --- |`,
    ...card.calibration.map((b) => `| ${b.from}–${b.to}% | ${b.shots} | ${b.shots ? `${b.rightAction} (${Math.round((100 * b.rightAction) / b.shots)}%)` : "–"} |`),
    ``,
    `## Per pair`,
    ``,
    `| Pair | Category | Footage | Split | Right action | Right moment | Fits the role | Missing flagged | Wrong "close match" | Not placed |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...card.perPair.map((r) => `| ${r.name} | ${r.category} | ${r.footage} | ${r.split} | ${r.totals.rightAction.text} | ${r.totals.rightMoment.text} | ${r.totals.rightRole.text} | ${r.totals.unavailableFlagged.text} | ${r.totals.falseConfident.text} | ${r.totals.notPlaced} |`),
    ...(problems.length ? [``, `## Problems`, ``, ...problems.map((p) => `- ${p}`)] : []),
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "scorecard.md"), md);
  return { card, md };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!runDir) throw Error("Usage: node scripts/eval/score.mjs RUN_DIR [--show-blind]");
  console.log(scoreRun(path.resolve(runDir), { showBlind: process.argv.includes("--show-blind") }).md);
}
