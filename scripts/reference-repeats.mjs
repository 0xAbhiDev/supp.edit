// Pairwise similarity of a reference's measured shots: embedding, layout and movement, to see
// which shots truly repeat footage. Usage: node scripts/reference-repeats.mjs INVENTORY_DIR
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const [dir] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
try {
  const { extractDNA } = await host.ssrLoadModule("/packages/ai/reference/dna.ts");
  const { embeddingSimilarity, layoutSimilarity } = await host.ssrLoadModule("/packages/ai/reference/visual.ts");
  const { actionSimilarity } = await host.ssrLoadModule("/packages/ai/reference/action-signature.ts");
  const project = read("SOURCE.supp");
  const text = fs.existsSync(path.join(dir, "text.json")) ? read("text.json") : null;
  const dna = extractDNA(project.assets[0], read("0-vision.json"), undefined, undefined, read("motion.json"), Array.isArray(text) ? text : null, read("0-visual.json"));
  dna.shots.forEach((a, i) =>
    dna.shots.forEach((b, j) => {
      if (j <= i) return;
      const e = embeddingSimilarity(a.embedding, b.embedding) ?? 0;
      if (e < 0.95) return;
      console.log(`${i + 1}-${j + 1} embedding ${e.toFixed(4)} layout ${layoutSimilarity(a.layout, b.layout)?.toFixed(4)} action ${a.action && b.action ? actionSimilarity(a.action, b.action).overall : "-"}`);
    }),
  );
} finally {
  await host.close();
}
