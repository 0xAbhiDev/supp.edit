// Plan all modes from captured real native measurements, retaining normal history/serialization.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
const dir = path.resolve(process.argv[2] || "test-results/reference-coastal");
const out = path.resolve(process.argv[3] || dir);
fs.mkdirSync(out, { recursive: true });
const read = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(dir, name), "utf8").replace(/^\uFEFF/, ""),
  );
const optional = (name) =>
  fs.existsSync(path.join(dir, name)) ? read(name) : undefined;
const server = await createServer({
  appType: "custom",
  server: { middlewareMode: true, watch: null, hmr: false },
});
try {
  const { extractDNA, modes } = await server.ssrLoadModule(
    "/packages/ai/reference/dna.ts",
  );
  const { buildRecreation, defaults } = await server.ssrLoadModule(
    "/packages/ai/reference/planner.ts",
  );
  const { History } = await server.ssrLoadModule("/packages/commands/index.ts");
  const { applyEditPreview } = await server.ssrLoadModule(
    "/packages/ai/editor-agent/execution.ts",
  );
  const { parseProject } = await server.ssrLoadModule(
    "/packages/project-schema/index.ts",
  );
  let p = parseProject(read("SOURCE.supp"));
  const ref = p.assets[0],
    colors = read("colors.json");
  const color = (a) => colors.find((c) => c.assetId === a.id);
  const evidencePath = process.argv
    .find((s) => s.startsWith("--text="))
    ?.slice(7);
  let text = evidencePath
    ? JSON.parse(fs.readFileSync(evidencePath, "utf8").replace(/^\uFEFF/, ""))
    : read("text.json");
  if (process.argv.includes("--measure-fonts")) {
    const host = await createServer({
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        hmr: false,
        watch: null,
      },
    });
    let browser;
    try {
      await host.listen();
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(new URL("favicon.ico", host.resolvedUrls.local[0]).href, {
        waitUntil: "commit",
      });
      text = await page.evaluate(
        async ([lines, aspect]) =>
          (
            await import("/packages/ai/reference/font-match.ts")
          ).matchReferenceFonts(lines, aspect),
        [text, ref.width / ref.height],
      );
    } finally {
      await browser?.close();
      await host.close();
    }
  }
  if (process.argv.includes("--reference-depth")) {
    const { measureTextDepth } = await server.ssrLoadModule(
      "/packages/ai/reference/text-depth.ts",
    );
    text = text.map((t) =>
      measureTextDepth(t, optional("0-person.json") ?? []),
    );
  }
  const dna = extractDNA(
    ref,
    read("0-vision.json"),
    optional("0-audio.json")?.audio?.beatMap,
    color(ref),
    read("motion.json"),
    text,
    read("0-visual.json"),
    optional("0-speech.json")?.transcript,
  );
  fs.writeFileSync(path.join(out, "dna.json"), JSON.stringify(dna, null, 2));
  const sources = p.assets
    .slice(1)
    .filter((a) => a.kind === "video")
    .map((a) => {
      const i = p.assets.indexOf(a);
      return {
        asset: a,
        analysis: read(i + "-vision.json"),
        color: color(a),
        visual: read(i + "-visual.json"),
        people: optional(i + "-person.json"),
        aperture: optional(i + "-aperture.json"),
      };
    });
  const music = p.assets.slice(1).find((a) => a.kind === "audio");
  const beatMap =
    music && read(p.assets.indexOf(music) + "-audio.json").audio?.beatMap;
  const history = new History(p),
    report = [],
    signatures = new Set();
  for (const mode of modes) {
    const result = buildRecreation(
      p,
      history.currentVersion,
      ref,
      dna,
      sources,
      {
        ...defaults,
        mode,
        wording: "original",
        format: process.argv.includes("--vertical") ? "vertical" : "reference",
        subjectLayering: process.argv.includes("--reference-depth")
          ? "reference"
          : process.argv.includes("--people")
            ? "behind-people"
            : "flat",
      },
      music,
      beatMap,
    );
    const prior = p;
    p = history.execute(
      p,
      mode,
      applyEditPreview(result.preview, p, history.currentVersion),
    );
    assert.deepEqual(history.undo(p).compositions, prior.compositions);
    assert.deepEqual(history.redo(prior).compositions, p.compositions);
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          parseProject(JSON.parse(JSON.stringify(p))).compositions,
        ),
      ),
      JSON.parse(JSON.stringify(p.compositions)),
    );
    const c = p.compositions.at(-1);
    assert(
      c.layers.every(
        (l) =>
          !l.assetId ||
          sources.some((s) => s.asset.id === l.assetId) ||
          music?.id === l.assetId,
      ),
    );
    signatures.add(
      JSON.stringify(
        result.matches.map((m) => [m.source, m.sourceIn, m.duration]),
      ),
    );
    report.push({
      mode,
      compositionId: c.id,
      name: c.name,
      duration: c.duration,
      matches: result.matches,
      warnings: result.warnings,
    });
  }
  assert.equal(
    signatures.size,
    3,
    "Editing modes should produce distinct source ranges/timing",
  );
  fs.writeFileSync(path.join(out, "Three-modes.supp"), JSON.stringify(p));
  fs.writeFileSync(
    path.join(out, "plan-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { shots: dna.shots.length, transitions: dna.transitions, report },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
