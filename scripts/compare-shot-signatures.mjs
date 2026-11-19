// Movement and scene signatures of a reference stretch and a raw stretch, side by side.
// Usage: node scripts/compare-shot-signatures.mjs INVENTORY_DIR REF_START_S REF_END_S CLIP_INDEX START_S END_S
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const [dir, rs, re, ci, cs, ce] = process.argv.slice(2);
const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : undefined);
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
try {
  const { actionSignature, actionSimilarity } = await host.ssrLoadModule("/packages/ai/reference/action-signature.ts");
  const { sceneSignature, sceneSimilarity } = await host.ssrLoadModule("/packages/ai/reference/scene-signature.ts");
  const side = (i, a, b) => {
    const v = read(`${i}-visual.json`),
      p = read(`${i}-person.json`);
    const sig = actionSignature(v, p, a * 1000, b * 1000, 16 / 9);
    return { sig, scene: sceneSignature(v, a * 1000, b * 1000, sig, null) };
  };
  const r = side(0, +rs, +re),
    c = side(+ci, +cs, +ce);
  const fmt = (s) => ({ level: s.sig.level.toFixed(4), regions: s.sig.regions.map((x) => x.toFixed(2)).join(" "), camera: s.sig.camera, role: s.scene.role, rows: s.scene.rows, localized: s.scene.localized });
  console.log("reference", JSON.stringify(fmt(r)));
  console.log("candidate", JSON.stringify(fmt(c)));
  console.log("action", JSON.stringify(actionSimilarity(r.sig, c.sig)), "scene", JSON.stringify(sceneSimilarity(r.scene, c.scene)));
} finally {
  await host.close();
}
