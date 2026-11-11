// Export a saved reference composition with the production compositor and native encoder.
// Usage: node scripts/render-reference-sequence.mjs INPUT.supp OUTPUT_DIR
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mediaEnvironment } from "./runtime.mjs";
const [input, destination] = process.argv.slice(2);
if (!input || !destination)
  throw Error("Supply a project and a dedicated output directory");
const dir = path.resolve(destination),
  env = mediaEnvironment();
await fs.mkdir(dir, { recursive: true });
const exe = (name) =>
  path.resolve(
    "target/debug/examples",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
const run = (file, args) =>
  execFileSync(file, args, { env, stdio: "inherit", windowsHide: true });
const saved = path.join(dir, "editable.supp");
run(exe("verify"), [input, saved]);
const project = JSON.parse(await fs.readFile(saved, "utf8"));
const sequence = process.argv[4]
  ? project.compositions.find((c) => c.name === process.argv[4])
  : project.compositions.at(-1);
if (!sequence) throw Error("Choose an existing composition");
const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL("favicon.ico", server.resolvedUrls.local[0]).href, {
    waitUntil: "commit",
  });
  // Only selected raw video and supplied audio are made available to the rendering harness.
  const ids = new Set(sequence.layers.map((c) => c.assetId).filter(Boolean));
  for (const asset of project.assets.filter((a) => ids.has(a.id))) {
    await page.evaluate(
      async ({ asset, bytes }) => {
        const { writeLocal } = await import("/packages/platform/storage.ts");
        await writeLocal(
          "media",
          asset.id + ":" + asset.fingerprint,
          new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
            type:
              asset.kind === "audio"
                ? "audio/wav"
                : asset.name.endsWith(".webm")
                  ? "video/webm"
                  : "video/mp4",
          }),
        );
      },
      { asset, bytes: (await fs.readFile(asset.path)).toString("base64") },
    );
  }
  const snapshot = await page.evaluate(
    async ({ project, id }) => {
      const { parseProject } =
        await import("/packages/project-schema/index.ts");
      const { sequenceExportSnapshot } =
        await import("/packages/commands/sequences.ts");
      const { Compositor } = await import("/packages/engine/compositor.ts");
      const graph = sequenceExportSnapshot(parseProject(project), id);
      const r = new Compositor(document.createElement("canvas"), true, {
        renderer: "cpu",
      });
      globalThis.renderReferenceFrame = async (frame) => {
        const err = await r.render(graph, frame, false, 1, true);
        if (err) throw Error(String(err));
        return r.canvas.toDataURL("image/png").split(",")[1];
      };
      return graph;
    },
    { project, id: sequence.id },
  );
  await fs.writeFile(path.join(dir, "project.supp"), JSON.stringify(snapshot));
  for (let frame = 0; frame < sequence.duration; frame++) {
    const image = await page.evaluate(
      (f) => globalThis.renderReferenceFrame(f),
      frame,
    );
    await fs.writeFile(
      path.join(dir, frame + ".png"),
      Buffer.from(image, "base64"),
    );
    if (frame % 60 === 0)
      console.log(sequence.name, frame + 1, "/", sequence.duration);
  }
} finally {
  await browser.close();
  await server.close();
}
run(exe("render_frames"), [dir]);
run(process.execPath, ["scripts/verify-render.mjs", dir]);
