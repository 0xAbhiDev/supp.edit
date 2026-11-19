// Second-stage frame cuts against the first-stage scene boundaries of a captured inventory:
// lists the cuts the dense detector adds over the scene boundaries.
// Usage: node scripts/compare-frame-cuts.mjs INVENTORY_DIR [INDEX] [--strict] [--text=FILE]
// --strict is the reference mode: titles and the subject's own box (0-person.json) are masked.
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const args = process.argv.slice(2);
const [dir, index = "0"] = args.filter((a) => !a.startsWith("--"));
const strict = args.includes("--strict"),
  textName = args.find((a) => a.startsWith("--text="))?.slice(7) ?? "text.json";
const server = await createServer({ appType: "custom", server: { middlewareMode: true, watch: null }, logLevel: "error" });
try {
  const { frameCuts } = await server.ssrLoadModule("/packages/ai/reference/cuts.ts");
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : undefined);
  const frames = read(`${index}-visual.json`);
  const analysis = read(`${index}-vision.json`);
  const text = index === "0" ? read(textName) : undefined;
  const lines = Array.isArray(text) ? text : (text?.lines ?? []);
  const people = strict ? (read(`${index}-person.json`) ?? []) : [];
  const scenes = (analysis?.video?.scenes ?? []).slice(1).map((s) => s.startMs);
  const cuts = frameCuts(frames, people, lines, strict);
  const added = cuts.filter((c) => !scenes.some((t) => Math.abs(t - c.timeMs) < 250));
  console.log(JSON.stringify({ dir, strict, people: people.length, titles: lines.length, scenes: scenes.length + 1, frameCuts: cuts.length, added: added.map((c) => [c.timeMs, c.strength, c.evidence.join("+")]) }));
} finally {
  await server.close();
}
