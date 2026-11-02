import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const project = JSON.parse(
  readFileSync("test-results/reframe/NATIVE_MANUAL_REOPENED.supp", "utf8"),
);
const baseline = JSON.parse(
  readFileSync("test-results/reframe/NATIVE_BEFORE_MANUAL.supp", "utf8"),
);
const server = await createServer({
  server: {
    port: 1421,
    strictPort: true,
    hmr: false,
    watch: { ignored: ["**/*"] },
  },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:1421");
  for (const asset of project.assets) {
    const bytes = readFileSync(asset.path).toString("base64");
    await page.evaluate(
      async ({ asset, bytes }) => {
        const m = "/packages/platform/storage.ts";
        const { writeLocal } = await import(m);
        await writeLocal(
          "media",
          `${asset.id}:${asset.fingerprint}`,
          new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
            type:
              asset.kind === "audio"
                ? "audio/wav"
                : asset.path.endsWith(".webm")
                  ? "video/webm"
                  : "video/mp4",
          }),
        );
      },
      { asset, bytes },
    );
  }
  for (const [name, p, frames] of [
    ["manual", project, [0, 10, 21, 300, 599]],
    ["original", baseline, [0, 10, 21]],
  ]) {
    const results = await page.evaluate(
      async ({ p, frames }) => {
        const sm = "/packages/project-schema/index.ts",
          cm = "/packages/commands/sequences.ts",
          rm = "/packages/engine/compositor.ts";
        const snapshot = (await import(cm)).sequenceExportSnapshot(
            (await import(sm)).parseProject(p),
            p.compositions.at(-1).id,
          ),
          renderer = new (await import(rm)).Compositor(
            document.createElement("canvas"),
            true,
            { renderer: "cpu" },
          ),
          out = [];
        try {
          for (const frame of frames) {
            await renderer.render(snapshot, frame, false, 1, true);
            out.push({ frame, png: renderer.canvas.toDataURL("image/png") });
          }
        } finally {
          renderer.dispose();
        }
        return out;
      },
      { p, frames },
    );
    for (const r of results)
      writeFileSync(
        `test-results/reframe/${name}-${r.frame}.png`,
        Buffer.from(r.png.split(",")[1], "base64"),
      );
  }
  console.log("Rendered independent before/after manual keyframe references");
} finally {
  await browser.close();
  await server.close();
}
