// Reference transitions against ground truth (scripts/make-transition-generalization.mjs): which
// boundaries become shot boundaries, how each is classified and timed, and whether in-shot effects
// (a continuous zoom, a negative pulse, a freeze) are kept out of the shot list.
// Usage: node scripts/evaluate-transitions.mjs DIR   (DIR holds truth.json and inventory/)
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const dir = process.argv[2] ?? "test-results/transitions-ue";
const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : undefined);
const truth = read("truth.json");
const inv = (f) => read(path.join("inventory", f));
const server = await createServer({ appType: "custom", server: { middlewareMode: true, watch: null }, logLevel: "error" });
try {
  const { extractDNA } = await server.ssrLoadModule("/packages/ai/reference/dna.ts");
  const { frameCuts } = await server.ssrLoadModule("/packages/ai/reference/cuts.ts");
  const ref = inv("SOURCE.supp").assets[0];
  const text = inv("text.json");
  const visual = inv("0-visual.json") ?? [];
  const dna = extractDNA(ref, inv("0-vision.json"), undefined, undefined, inv("motion.json") ?? [], Array.isArray(text) ? text : null, visual);
  const starts = dna.shots.slice(1).map((s) => s.startMs);
  const tolerance = (b) => Math.max(120, ((b.endMs ?? b.atMs) - (b.startMs ?? b.atMs)) / 2 + 80);
  const rows = truth.boundaries.map((b) => {
    const found = starts.find((t) => Math.abs(t - b.atMs) <= tolerance(b));
    const tr = found !== undefined ? (dna.transitions ?? []).find((x) => Math.abs(x.cutMs - found) < 150) : undefined;
    return {
      truth: b.kind,
      atMs: b.atMs,
      detected: found !== undefined,
      boundaryMs: found ?? null,
      timingErrorMs: found !== undefined ? found - b.atMs : null,
      classifiedAs: tr ? tr.kind : found !== undefined ? "cut (no transition measured)" : null,
      span: tr ? [tr.startMs, tr.endMs] : null,
      confidence: tr ? tr.confidence : null,
      evidence: tr ? tr.evidence.slice(0, 3) : null,
    };
  });
  const extra = starts.filter((t) => !truth.boundaries.some((b) => Math.abs(t - b.atMs) <= tolerance(b)));
  const inShot = truth.inShot.map((e) => ({
    truth: e.kind,
    span: [e.startMs, e.endMs],
    splitInside: starts.filter((t) => t > e.startMs + 60 && t < e.endMs - 60),
    asColorPulse: (dna.colorPulses ?? []).some((p) => p.startMs < e.endMs && p.endMs > e.startMs),
  }));
  const strictOnly = frameCuts(visual, inv("0-person.json") ?? [], Array.isArray(text) ? text : [], true).map((c) => c.timeMs);
  const result = {
    shots: dna.shots.length,
    expectedShots: truth.boundaries.length + 1,
    boundaries: rows,
    detected: `${rows.filter((r) => r.detected).length}/${rows.length}`,
    classifiedCorrectly: rows.filter((r) => r.detected && (r.classifiedAs === r.truth || (r.truth.includes("cut") && r.classifiedAs.startsWith("cut")))).length,
    falseBoundaries: extra,
    inShot,
    strictFrameCuts: strictOnly,
  };
  fs.writeFileSync(path.join(dir, "evaluation.json"), JSON.stringify(result, null, 1));
  console.log(`shots ${result.shots} (expected ${result.expectedShots}); boundaries detected ${result.detected}; classified as their kind ${result.classifiedCorrectly}; false boundaries ${JSON.stringify(extra)}`);
  for (const r of rows) console.log(`  ${r.truth.padEnd(20)} @${r.atMs}: ${r.detected ? `found @${r.boundaryMs} (${r.timingErrorMs >= 0 ? "+" : ""}${r.timingErrorMs} ms) as ${r.classifiedAs}${r.span ? ` span ${r.span.join("–")}` : ""}${r.confidence !== null ? ` conf ${r.confidence}` : ""}` : "NOT FOUND"}`);
  for (const e of inShot) console.log(`  in-shot ${e.truth.padEnd(20)} ${e.span.join("–")}: split inside ${JSON.stringify(e.splitInside)}${e.asColorPulse ? ", recorded as a colour pulse" : ""}`);
} finally {
  await server.close();
}
