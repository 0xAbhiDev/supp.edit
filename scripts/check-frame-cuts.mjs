// Frame-accurate cut detection against known cut times, from captured per-frame measurements.
// Usage: node scripts/check-frame-cuts.mjs VISUAL.json "t1,t2,…"(seconds) [PEOPLE.json]
import fs from "node:fs";
import { createServer } from "vite";
const [file, truth = "", peopleFile] = process.argv.slice(2);
const server = await createServer({ appType: "custom", server: { middlewareMode: true, watch: null }, logLevel: "error" });
try {
  const { frameCuts } = await server.ssrLoadModule("/packages/ai/reference/cuts.ts");
  const frames = JSON.parse(fs.readFileSync(file, "utf8"));
  const people = peopleFile ? JSON.parse(fs.readFileSync(peopleFile, "utf8")) : [];
  const cuts = frameCuts(frames, people);
  const known = truth.split(",").filter(Boolean).map((s) => Math.round(Number(s) * 1000));
  const hit = known.filter((t) => cuts.some((c) => Math.abs(c.timeMs - t) <= 40));
  const extra = cuts.filter((c) => !known.some((t) => Math.abs(c.timeMs - t) <= 40));
  console.log(JSON.stringify({ frames: frames.length, detected: cuts.length, found: `${hit.length}/${known.length}`, missed: known.filter((t) => !hit.includes(t)), unexpected: extra.map((c) => [c.timeMs, c.strength, c.evidence.join("+")]) }));
} finally {
  await server.close();
}
