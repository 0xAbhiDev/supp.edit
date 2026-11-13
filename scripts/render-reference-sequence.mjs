// Export a saved reference composition with the production compositor and native encoder.
// Usage: node scripts/render-reference-sequence.mjs INPUT.supp OUTPUT_DIR
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
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
const inspectMotion = process.argv.includes("--verify-motion");
const inspectPulses = process.argv.includes("--verify-pulses");
const inspectExisting = process.argv.includes("--verify-existing");
const inspectParity = process.argv.includes("--verify-parity");
if (!inspectMotion && !inspectPulses) run(exe("verify"), [input, saved]);
const project = JSON.parse(await fs.readFile(saved, "utf8"));
const sequence = process.argv[4]
  ? project.compositions.find(
      (c) => c.name === process.argv[4] || c.id === process.argv[4],
    )
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
    async ({ project, id, gpu, parity, pulses }) => {
      const { parseProject } =
        await import("/packages/project-schema/index.ts");
      const { sequenceExportSnapshot } =
        await import("/packages/commands/sequences.ts");
      const { Compositor } = await import("/packages/engine/compositor.ts");
      const graph = sequenceExportSnapshot(parseProject(project), id);
      const r = new Compositor(document.createElement("canvas"), true, {
        renderer: gpu ? "auto" : "cpu",
      });
      const neutral = structuredClone(graph);
      if (parity) {
        const other = new Compositor(document.createElement("canvas"), true, {
          renderer: "auto",
        });
        globalThis.referenceParity = async (frame) => {
          for (const renderer of [r, other]) {
            const error = await renderer.render(graph, frame, false, 1, true);
            if (error) throw Error(String(error));
          }
          const pixels = (renderer) =>
            renderer.canvas
              .getContext("2d")
              .getImageData(0, 0, graph.settings.width, graph.settings.height)
              .data;
          const a = pixels(r),
            b = pixels(other);
          return {
            frame,
            mae: a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length,
            backend: other.backend,
            fallback: other.fallback,
          };
        };
      }
      const editable = neutral.compositions.find((c) => c.id === id);
      if (pulses)
        editable.layers = editable.layers.filter(
          (l) => !l.name?.startsWith("Negative pulse · "),
        );
      for (const layer of editable.layers) {
        if (
          !pulses &&
          layer.kind === "null" &&
          /^(Zoom|Whip pan|Motion bridge) · (departure|arrival)$/.test(
            layer.name,
          )
        )
          for (const property of ["x", "y", "scale"])
            layer.keyframes[property] = [];
      }
      globalThis.renderReferenceFrame = async (frame, omitMotion = false) => {
        const err = await r.render(
          omitMotion ? neutral : graph,
          frame,
          false,
          1,
          true,
        );
        if (err) throw Error(String(err));
        return r.canvas.toDataURL("image/png").split(",")[1];
      };
      return graph;
    },
    {
      project,
      id: sequence.id,
      gpu: process.argv.includes("--gpu"),
      parity: inspectParity,
      pulses: inspectPulses,
    },
  );
  if (inspectParity) {
    const rows = [];
    for (const frame of [
      0,
      Math.floor(sequence.duration / 2),
      sequence.duration - 1,
    ])
      rows.push(
        await page.evaluate(
          (frame) => globalThis.referenceParity(frame),
          frame,
        ),
      );
    await fs.writeFile(
      path.join(dir, "color-parity.json"),
      JSON.stringify(rows, null, 2),
    );
    console.log(rows);
    assert(
      rows.every((r) => r.backend.includes("WebGL2") && r.mae < 2),
      "CPU/GPU source color mismatch",
    );
  } else if (inspectMotion || inspectPulses) {
    const controls = sequence.layers.filter((c) =>
      inspectPulses
        ? c.name === "Negative pulse · bright ink"
        : c.kind === "null" && / · (arrival|departure)$/.test(c.name),
    );
    assert(controls.length, "No requested treatment in selected sequence");
    const results = [];
    const gray = (inputArgs, input) =>
      execFileSync(
        env.SUPP_FFMPEG,
        [
          "-v",
          "error",
          ...inputArgs,
          "-an",
          "-frames:v",
          "1",
          "-vf",
          "scale=256:100",
          "-pix_fmt",
          "gray",
          "-f",
          "rawvideo",
          "pipe:1",
        ],
        { env, input, windowsHide: true },
      );
    const mae = (a, b) => {
      assert.equal(a.length, 256 * 100);
      assert.equal(b.length, a.length);
      return a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    };
    const samples = controls.flatMap((c) =>
      inspectPulses
        ? [c.start - 1, c.start, c.start + c.duration - 1, c.start + c.duration]
            .filter((f) => f >= 0 && f < sequence.duration)
            .map((frame) => ({
              frame,
              name: c.name,
              active: controls.some(
                (p) => frame >= p.start && frame < p.start + p.duration,
              ),
            }))
        : [
            {
              frame: c.name.endsWith("arrival")
                ? c.start
                : c.start + c.duration - 1,
              name: c.name,
              active: true,
            },
          ],
    );
    for (const { frame, name, active } of samples) {
      const seconds =
        (frame * sequence.settings.fps.den) / sequence.settings.fps.num;
      const actual = gray([
        "-ss",
        seconds.toFixed(8),
        "-i",
        path.join(dir, "render.mp4"),
      ]);
      const errors = [];
      for (const omit of [false, true]) {
        const png = await page.evaluate(
          ([f, o]) => globalThis.renderReferenceFrame(f, o),
          [frame, omit],
        );
        errors.push(
          mae(actual, gray(["-i", "pipe:0"], Buffer.from(png, "base64"))),
        );
      }
      results.push({
        control: name,
        active,
        frame,
        authoredMAE: errors[0],
        disabledMAE: errors[1],
      });
    }
    await fs.writeFile(
      path.join(
        dir,
        inspectPulses ? "pulse-pixels.json" : "motion-pixels.json",
      ),
      JSON.stringify(results, null, 2),
    );
    console.log(results);
    assert(
      results.every(
        (r) =>
          r.authoredMAE < 8 &&
          (r.active
            ? r.authoredMAE + 1 < r.disabledMAE
            : Math.abs(r.authoredMAE - r.disabledMAE) < 0.1),
      ),
      "Decoded treatment or neighboring frames diverge from the editable graph",
    );
  } else {
    await fs.writeFile(
      path.join(dir, "project.supp"),
      JSON.stringify(snapshot),
    );
    for (let frame = 0; frame < sequence.duration; frame++) {
      if (
        inspectExisting &&
        ![0, Math.floor(sequence.duration / 2), sequence.duration - 1].includes(
          frame,
        )
      )
        continue;
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
  }
} finally {
  await browser.close();
  await server.close();
}
if (!inspectMotion && !inspectParity && !inspectPulses) {
  if (!inspectExisting) run(exe("render_frames"), [dir]);
  run(process.execPath, ["scripts/verify-render.mjs", dir]);
}
