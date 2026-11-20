// The ReferenceGrammar of a captured reference, built offline with the engine's own code: shots,
// beat map, text, person contours, movement signatures and scene signatures from the inventory.
// (The app adds title tracing, tone and the audio-visual event graph on top.)
// Usage: node scripts/print-reference-grammar.mjs INVENTORY_DIR OUT.json
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const [dir, out] = process.argv.slice(2);
const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : undefined);
const server = await createServer({ appType: "custom", server: { middlewareMode: true, watch: null }, logLevel: "error" });
try {
  const { extractDNA } = await server.ssrLoadModule("/packages/ai/reference/dna.ts");
  const { actionSignature, shotSpan } = await server.ssrLoadModule("/packages/ai/reference/action-signature.ts");
  const { sceneSignature, medianSharpness } = await server.ssrLoadModule("/packages/ai/reference/scene-signature.ts");
  const { annotateSubjects } = await server.ssrLoadModule("/packages/ai/reference/subject-shape.ts");
  const { referenceGrammar } = await server.ssrLoadModule("/packages/ai/reference/grammar.ts");
  const ref = read("SOURCE.supp").assets[0];
  const visual = read("0-visual.json") ?? [];
  const people = read("0-person.json");
  const text = read("text.json");
  const beatMap = read("0-audio.json")?.audio?.beatMap;
  const dna = extractDNA(ref, read("0-vision.json"), beatMap, undefined, read("motion.json") ?? [], Array.isArray(text) ? text : null, visual);
  const aspect = ref.width / Math.max(1, ref.height);
  if (people) annotateSubjects(dna, people, aspect);
  for (const shot of dna.shots) {
    const [from, to] = shotSpan(shot);
    shot.action = actionSignature(visual, people ?? [], from, to, aspect) ?? shot.action;
    const scene = sceneSignature(visual, from, to, shot.action, shot.subjectShape?.height ?? null, [], medianSharpness(visual));
    if (scene) shot.scene = scene;
  }
  const grammar = referenceGrammar(dna);
  fs.writeFileSync(out, JSON.stringify(grammar, null, 1));
  console.log(JSON.stringify({ shots: grammar.shots.length, roles: grammar.shots.map((s) => s.role.interpretation), transitions: grammar.transitions.map((t) => t.interpretation), text: grammar.text.length, depth: grammar.depth.length, pulses: grammar.effects.colorPulses.length, bpm: grammar.audio.bpm }));
} finally {
  await server.close();
}
