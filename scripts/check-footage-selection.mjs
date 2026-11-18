// Run long-footage selection offline on a captured inventory (SOURCE.supp + i-vision.json /
// i-visual.json from capture-reference-analysis.mjs), using the reference's measured shots.
// Usage: node scripts/check-footage-selection.mjs INVENTORY_DIR [TRUTH.json] [MODE]
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const [dir, truthFile, mode = "Close Match"] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const optional = (f) => (fs.existsSync(path.join(dir, f)) ? read(path.join(dir, f)) : undefined);
const project = read(path.join(dir, "SOURCE.supp"));
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
try {
  const { describeShots } = await host.ssrLoadModule("/packages/ai/reference/dna.ts");
  const { buildFootageIndex, selectShots } = await host.ssrLoadModule("/packages/ai/reference/footage-index.ts");
  const { averageEmbedding, measuredColor, measuredLayout } = await host.ssrLoadModule("/packages/ai/reference/visual.ts");
  const refVisual = optional("0-visual.json");
  const ref = project.assets[0];
  const refAnalysis = optional("0-vision.json");
  // As the DNA does: each shot carries the average look of the reference frames inside it.
  const refShots = describeShots(ref, refAnalysis).map((s) => ({
    ...s,
    embedding: averageEmbedding((refAnalysis.vision?.frames ?? []).filter((f) => f.timeMs >= s.startMs && f.timeMs < s.endMs).map((f) => f.embedding)),
    ...(refVisual ? { color: measuredColor(refVisual, s.startMs, s.endMs), layout: measuredLayout(refVisual, s.startMs + 100, s.endMs - 100) } : {}),
  }));
  const sources = project.assets.flatMap((asset, i) => (i && asset.kind === "video" ? [{ asset, analysis: optional(i + "-vision.json"), visual: optional(i + "-visual.json") }] : []));
  const index = buildFootageIndex(sources);
  const reqs = refShots.map((shot) => ({ shot, durationMs: shot.endMs - shot.startMs, peakFraction: 0.4, peakSource: "none" }));
  const choices = selectShots(index, sources, reqs, mode);
  const truth = truthFile ? read(truthFile) : undefined;
  console.log("coverage", JSON.stringify(index.coverage));
  choices.forEach((c, i) => {
    const planted = truth?.planted.find((w) => c.inMs >= w.startMs - 200 && c.outMs <= w.endMs + 200);
    console.log(`shot ${i + 1} (${(refShots[i].startMs / 1000).toFixed(2)}–${(refShots[i].endMs / 1000).toFixed(2)}) → ${(c.inMs / 1000).toFixed(2)}–${(c.outMs / 1000).toFixed(2)} ${planted ? "in " + planted.source : "OUTSIDE"} score ${c.score} ${JSON.stringify(c.match)}`);
  });
} finally {
  await host.close();
}
