// One row per run of a Windows matrix directory (each run: OUT.log, OUT/, OUT.grade.txt):
// driver exit, preview time, graded selection, export validity, effect levels, close-match labels
// and the warnings that matter for 4.1 (source text, transitions, confidence).
// Usage: node scripts/summarize-matrix.mjs MATRIX_DIR [OUT.json]
import fs from "node:fs";
import path from "node:path";
const [dir, outFile] = process.argv.slice(2);
const json = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return undefined;
  }
};
const rows = [];
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".log")).map((f) => f.slice(0, -4))) {
  const log = fs.readFileSync(path.join(dir, name + ".log"), "utf8");
  const run = path.join(dir, name);
  const stepJson = (label) => {
    const line = log.split("\n").find((l) => l.includes(" " + label + " "));
    if (!line) return undefined;
    try {
      return JSON.parse(line.slice(line.indexOf(label) + label.length).trim());
    } catch {
      return undefined;
    }
  };
  const preview = stepJson("Preview ready");
  const explained = stepJson("Explained each choice");
  const grade = (() => {
    try {
      const t = fs.readFileSync(path.join(dir, name + ".grade.txt"), "utf8");
      return JSON.parse(t.slice(t.indexOf("{")));
    } catch {
      return undefined;
    }
  })();
  const validation = json(path.join(run, "validation.json"));
  const sfx = json(path.join(run, "sfx-levels.json"));
  const summary = preview?.summary ?? [];
  const pick = (re) => summary.filter((s) => re.test(s));
  rows.push({
    run: name,
    completed: /Native verification complete/.test(log),
    error: (log.match(/(AssertionError|Error): [^\n]*/) ?? [null])[0],
    previewSeconds: preview?.seconds ?? null,
    graded: grade ? { inPlanted: grade.inPlantedMoments, sameAction: grade.sameExerciseAsReference, cutCrossings: grade.cutCrossings, reused: grade.reusedIntervals } : null,
    export: validation ? { ok: validation.ok, frames: validation.video?.frames, seconds: validation.video?.seconds, black: validation.blackFrames?.length, failures: validation.failures } : null,
    effects: sfx ? { meanAbsErrorDb: sfx.meanAbsErrorDb, clipped: sfx.clipped, each: sfx.effects.map((e) => `${e.kind} ${e.errorDb >= 0 ? "+" : ""}${e.errorDb} dB`) } : null,
    labels: explained ? { closeMatch: explained.rows.filter((r) => /close match/.test(r)).length, bestAvailable: explained.rows.filter((r) => /best available/i.test(r)).length, shots: explained.rows.length } : null,
    confidence: explained ? explained.rows.map((r) => (r.match(/confidence (\d+)%/) ?? [])[1]).map(Number) : null,
    sourceText: pick(/Source text|baked-in|burned into/),
    transitions: pick(/Reference grammar/).map((s) => (s.match(/\d+ transitions \([^)]*\)/) ?? [s.slice(0, 160)])[0]),
    transitionWarnings: pick(/retained a cut|whip|dissolve measured/i),
    analysis: pick(/^Analysis time|^Reference analysis/),
    sameFootage: pick(/^Same footage/),
  });
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
for (const r of rows)
  console.log(
    [
      r.run.padEnd(18),
      r.completed ? "done" : "FAILED",
      `preview ${r.previewSeconds ?? "-"}s`,
      r.graded ? `planted ${r.graded.inPlanted} action ${r.graded.sameAction} cuts ${r.graded.cutCrossings}` : "",
      r.export ? `export ${r.export.ok ? "ok" : "FAIL"} ${r.export.frames}f black ${r.export.black}` : "no export",
      r.effects ? `fx |err| ${r.effects.meanAbsErrorDb} dB${r.effects.clipped ? " CLIPPED" : ""}` : "",
      r.labels ? `close ${r.labels.closeMatch}/${r.labels.shots}` : "",
      r.error ?? "",
    ]
      .filter(Boolean)
      .join(" · "),
  );
