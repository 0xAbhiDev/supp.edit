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
const inspectOcclusion = process.argv.includes("--verify-occlusion");
const inspectTitles = process.argv.includes("--verify-titles");
const selectedFrames = process.argv
  .find((a) => a.startsWith("--frames="))
  ?.slice(9)
  .split(",")
  .map(Number);
if (selectedFrames?.some((f) => !Number.isInteger(f) || f < 0))
  throw Error("Invalid inspection frame");
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
    async ({ project, id, gpu, parity, pulses, occlusion, titles }) => {
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
      if (titles) {
        const seq = graph.compositions.find((c) => c.id === id);
        globalThis.titlePixels = async (frame, clipId) => {
          const off = structuredClone(graph);
          off.compositions.find((c) => c.id === id).layers = seq.layers.filter(
            (l) => l.id !== clipId,
          );
          const images = [];
          for (const model of [graph, off]) {
            const err = await r.render(model, frame, false, 1, true);
            if (err) throw Error(String(err));
            images.push(r.canvas.toDataURL("image/png").split(",")[1]);
          }
          return images;
        };
      }
      if (occlusion) {
        const comp = graph.compositions.find((c) => c.id === id);
        const noSubject = structuredClone(graph),
          noType = structuredClone(graph);
        const without = (model, predicate) => {
          const edit = model.compositions.find((c) => c.id === id);
          edit.layers = edit.layers.filter((l) => !predicate(l));
        };
        without(noSubject, (l) => l.name.startsWith("Foreground person · "));
        without(noType, (l) => l.kind === "text");
        globalThis.inspectOcclusion = async (frame) => {
          const pixels = [];
          const pngs = [];
          for (const preview of [graph, noSubject, noType]) {
            const error = await r.render(preview, frame, false, 1, true);
            if (error) throw Error(String(error));
            pixels.push(
              r.canvas
                .getContext("2d")
                .getImageData(0, 0, comp.settings.width, comp.settings.height)
                .data,
            );
            pngs.push(r.canvas.toDataURL("image/png").split(",")[1]);
          }
          const [layered, flat, background] = pixels;
          let hidden = 0,
            visible = 0,
            total = 0;
          for (let i = 0; i < flat.length; i += 4) {
            const difference = (a, b) =>
              Math.max(...[0, 1, 2].map((k) => Math.abs(a[i + k] - b[i + k])));
            if (difference(flat, background) < 32) continue;
            total++;
            if (difference(layered, background) <= 3) hidden++;
            if (difference(layered, flat) <= 3) visible++;
          }
          return { frame, hidden, visible, total, pngs };
        };
      }
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
      occlusion: inspectOcclusion,
      titles: inspectTitles,
    },
  );
  if (inspectTitles) {
    const { width, height } = sequence.settings,
      movie = path.join(dir, "render.mp4");
    const rgb = (args, input) =>
      execFileSync(
        env.SUPP_FFMPEG,
        [
          "-v",
          "error",
          ...args,
          "-an",
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { env, input, maxBuffer: width * height * 4, windowsHide: true },
      );
    const rows = [];
    for (const l of sequence.layers.filter((c) => c.kind === "text")) {
      const frame = l.start + Math.floor(l.duration / 2);
      const pngs = await page.evaluate(
        ([f, id]) => globalThis.titlePixels(f, id),
        [frame, l.id],
      );
      const [on, off] = pngs.map((b64) =>
        rgb(["-i", "pipe:0"], Buffer.from(b64, "base64")),
      );
      const actual = rgb(["-i", movie, "-vf", "select=eq(n\\," + frame + ")"]);
      let count = 0,
        authoredError = 0,
        absentError = 0,
        x0 = width,
        y0 = height,
        x1 = -1,
        y1 = -1;
      for (let i = 0; i < actual.length; i += 3) {
        if (
          Math.max(...[0, 1, 2].map((k) => Math.abs(on[i + k] - off[i + k]))) <
          48
        )
          continue;
        const x = (i / 3) % width,
          y = Math.floor(i / 3 / width);
        count++;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        for (let k = 0; k < 3; k++) {
          authoredError += Math.abs(actual[i + k] - on[i + k]);
          absentError += Math.abs(actual[i + k] - off[i + k]);
        }
      }
      rows.push({
        title: l.text.content,
        id: l.id,
        frame,
        pixels: count,
        box: count ? [x0, y0, x1 + 1, y1 + 1] : null,
        authoredMAE: count ? authoredError / (3 * count) : null,
        withoutTitleMAE: count ? absentError / (3 * count) : null,
      });
    }
    await fs.writeFile(
      path.join(dir, "title-pixels.json"),
      JSON.stringify(rows, null, 2),
    );
    console.log(rows);
    assert(
      rows.length &&
        rows.every(
          (v) => v.pixels > 25 && v.authoredMAE + 10 < v.withoutTitleMAE,
        ),
      "Some authored titles do not appear in the decoded export at their sampled time",
    );
  } else if (inspectOcclusion) {
    assert(
      selectedFrames?.length >= 2,
      "Select multiple frames where a title crosses the moving subject",
    );
    const rows = [];
    for (const frame of selectedFrames) {
      const { pngs, ...row } = await page.evaluate(
        (f) => globalThis.inspectOcclusion(f),
        frame,
      );
      for (const [i, label] of ["layered", "flat", "no-title"].entries())
        await fs.writeFile(
          path.join(dir, frame + "-" + label + ".png"),
          Buffer.from(pngs[i], "base64"),
        );
      rows.push(row);
    }
    await fs.writeFile(
      path.join(dir, "occlusion.json"),
      JSON.stringify(rows, null, 2),
    );
    console.log(rows);
    assert(
      rows.every((r) => r.hidden > 100 && r.visible > 100),
      "Expected both occluded and visible lettering on every selected frame",
    );
  } else if (inspectParity) {
    const rows = [];
    for (const frame of selectedFrames ?? [
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
      if (selectedFrames && !selectedFrames.includes(frame)) continue;
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
if (
  !selectedFrames &&
  !inspectMotion &&
  !inspectParity &&
  !inspectPulses &&
  !inspectTitles
) {
  if (!inspectExisting) run(exe("render_frames"), [dir]);
  run(process.execPath, ["scripts/verify-render.mjs", dir]);
}
