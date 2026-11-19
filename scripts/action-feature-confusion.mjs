// Which measurements tell actions apart? For every reference shot and every planted action in the
// raw clips (truth.json), the best-aligned window inside the planted stretch is compared on each
// signature component; a component "ranks right" for a shot when a planted window of the same
// action scores highest. Truth is used only to grade, never to choose.
// Usage: node scripts/action-feature-confusion.mjs INVENTORY_DIR TRUTH.json
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const [dir, truthFile] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const optional = (f) => (fs.existsSync(path.join(dir, f)) ? read(path.join(dir, f)) : undefined);
const project = read(path.join(dir, "SOURCE.supp")),
  truth = read(truthFile);
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
try {
  const { extractDNA } = await host.ssrLoadModule("/packages/ai/reference/dna.ts");
  const { actionSignature, actionSimilarity } = await host.ssrLoadModule("/packages/ai/reference/action-signature.ts");
  const { averageEmbedding, embeddingSimilarity } = await host.ssrLoadModule("/packages/ai/reference/visual.ts");
  const { shapeOver, shapeFit, annotateSubjects, shapePath, pathFit } = await host.ssrLoadModule("/packages/ai/reference/subject-shape.ts");
  const ref = project.assets[0];
  const refVisual = optional("0-visual.json"),
    refPeople = optional("0-person.json") ?? [];
  const text = optional("text.json");
  const dna = extractDNA(ref, optional("0-vision.json"), undefined, undefined, optional("motion.json") ?? [], Array.isArray(text) ? text : null, refVisual);
  const aspect = ref.width / ref.height;
  annotateSubjects(dna, refPeople, aspect);
  const clips = project.assets.map((a, i) => ({ a, i })).filter(({ a, i }) => i && a.kind === "video");
  const byName = new Map(clips.map(({ a, i }) => [path.basename(a.path.replace(/^\\\\\?\\/, "")), { a, visual: optional(i + "-visual.json"), people: optional(i + "-person.json") ?? [], vision: optional(i + "-vision.json")?.vision?.frames ?? [] }]));
  let at = 0;
  const wanted = truth.shots.map((s) => {
    const w = { from: at, to: at + s.lengthS * 1000, source: s.source };
    at += s.lengthS * 1000;
    return w;
  });
  const plants = truth.planted.map((p) => ({ ...p, clip: p.clip ?? path.basename(truth.raw) }));
  const components = ["trajectory", "regions", "rhythm", "camera", "subject", "action", "look", "pose", "posePath", "level"];
  const right = Object.fromEntries(components.map((c) => [c, 0]));
  let graded = 0;
  for (const shot of dna.shots) {
    const want = wanted.find((w) => (shot.startMs + shot.endMs) / 2 >= w.from && (shot.startMs + shot.endMs) / 2 < w.to)?.source;
    if (!want) continue;
    const rs = actionSignature(refVisual, refPeople, shot.startMs, shot.endMs, aspect);
    const refPath = shapePath(refPeople, shot.startMs, shot.endMs, aspect);
    const len = shot.endMs - shot.startMs;
    const rows = plants.map((p) => {
      const c = byName.get(p.clip);
      let best = null;
      for (let s = p.startMs + 70; s + len <= p.endMs - 70; s += 100) {
        const cs = actionSignature(c.visual, c.people, s, s + len, c.a.width / c.a.height);
        if (!cs) continue;
        const m = actionSimilarity(rs, cs);
        const look = embeddingSimilarity(shot.embedding, averageEmbedding(c.vision.filter((f) => f.timeMs >= p.startMs && f.timeMs < p.endMs).map((f) => f.embedding)));
        const shape = shapeOver(c.people, s, s + len, c.a.width / c.a.height);
        const pose = shot.subjectShape && shape ? shapeFit(shot.subjectShape, shape) : null;
        const level = Math.exp(-Math.abs(Math.log((0.0015 + cs.level) / (0.0015 + rs.level))));
        const posePath = pathFit(refPath, shapePath(c.people, s, s + len, c.a.width / c.a.height)) ?? 0;
        const row = { posePath, trajectory: m.trajectory, regions: m.regions, rhythm: m.rhythm, camera: m.camera, subject: m.subject ?? 0, action: m.overall, look: look ?? 0, pose: pose ?? 0, level };
        if (!best || row.action > best.action) best = row;
      }
      return { p, row: best };
    });
    graded++;
    const line = [];
    for (const k of components) {
      const top = rows.filter((r) => r.row).sort((x, y) => y.row[k] - x.row[k])[0];
      if (top?.p.source === want) right[k]++;
      line.push(`${k}:${top?.p.source === want ? "✓" : top?.p.source}`);
    }
    console.log(`shot ${(shot.startMs / 1000).toFixed(2)} wants ${want}: ${line.join(" ")}`);
  }
  console.log("ranks right:", Object.entries(right).map(([k, v]) => `${k} ${v}/${graded}`).join(", "));
} finally {
  await host.close();
}
