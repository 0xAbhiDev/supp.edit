import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mediaEnvironment } from "./runtime.mjs";
const dir = path.resolve(process.argv[2] ?? "test-results/typography-reviewed"),
  env = mediaEnvironment(),
  movie = path.join(dir, "render.mp4"),
  project = JSON.parse(await fs.readFile(path.join(dir, "NATIVE.supp"))),
  before = JSON.parse(await fs.readFile(path.join(dir, "before-close.supp")));
assert.deepEqual(project.compositions, before.compositions);
const reel = project.compositions[0],
  titles = reel.layers.filter((c) => c.kind === "text");
assert.equal(titles.length, 4);
assert.equal(titles[0].text.size, 68.5);
assert.equal(titles[0].keyframes.scale[0].value, 0.845);
const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL("favicon.ico", server.resolvedUrls.local[0]).href, {
    waitUntil: "commit",
    timeout: 90000,
  });
  for (const asset of project.assets)
    await page.evaluate(
      async ({ asset, data }) => {
        const { writeLocal } = await import("/packages/platform/storage.ts");
        await writeLocal(
          "media",
          asset.id + ":" + asset.fingerprint,
          new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
            type: asset.kind === "audio" ? "audio/wav" : "video/webm",
          }),
        );
      },
      { asset, data: (await fs.readFile(asset.path)).toString("base64") },
    );
  const report = [];
  for (const title of titles) {
    for (const frame of [
      title.start + 3,
      title.start + 8,
      title.start + Math.min(title.duration - 3, 17),
    ]) {
      const filename = path.join(dir, "decoded-" + frame + ".png");
      execFileSync(
        env.SUPP_FFMPEG,
        [
          "-v",
          "error",
          "-y",
          "-i",
          movie,
          "-vf",
          "select=eq(n\\," + frame + ")",
          "-frames:v",
          "1",
          filename,
        ],
        { windowsHide: true },
      );
      const stat = await page.evaluate(
        async ({ project, frame, encoded }) => {
          const { sequenceExportSnapshot } =
              await import("/packages/commands/sequences.ts"),
            { Compositor } = await import("/packages/engine/compositor.ts"),
            { parseProject } =
              await import("/packages/project-schema/index.ts");
          const p = sequenceExportSnapshot(
            parseProject(project),
            project.compositions[0].id,
          );
          const off = structuredClone(p);
          off.compositions[0].layers = off.compositions[0].layers.filter(
            (c) => c.kind !== "text",
          );
          const canvas = document.createElement("canvas"),
            r = new Compositor(canvas, true, { renderer: "cpu" });
          let textReference;
          const pixels = () =>
            canvas
              .getContext("2d")
              .getImageData(0, 0, canvas.width, canvas.height).data;
          try {
            for (const model of [p, off]) {
              const err = await r.render(model, frame, false, 1, true);
              if (err) throw err;
              if (model === p) textReference = pixels();
            }
            const without = pixels(),
              reference = textReference,
              img = new Image();
            img.src = "data:image/png;base64," + encoded;
            await img.decode();
            canvas.getContext("2d").drawImage(img, 0, 0);
            const actual = pixels();
            let samples = 0,
              error = 0,
              missing = 0,
              left = canvas.width,
              right = 0,
              top = canvas.height,
              bottom = 0;
            for (let i = 0; i < actual.length; i += 4) {
              if (
                Math.max(
                  ...[0, 1, 2].map((k) =>
                    Math.abs(reference[i + k] - without[i + k]),
                  ),
                ) < 45
              )
                continue;
              const x = (i / 4) % canvas.width,
                y = Math.floor(i / 4 / canvas.width);
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
              for (let k = 0; k < 3; k++) {
                error += Math.abs(reference[i + k] - actual[i + k]);
                missing += Math.abs(without[i + k] - actual[i + k]);
              }
              samples++;
            }
            return {
              frame,
              samples,
              withText: error / (samples * 3),
              withoutText: missing / (samples * 3),
              bounds: [left, top, right, bottom],
            };
          } finally {
            await r.dispose();
          }
        },
        {
          project,
          frame,
          encoded: (await fs.readFile(filename)).toString("base64"),
        },
      );
      console.log(title.name, stat);
      assert(
        stat.samples > 100 && stat.withText < stat.withoutText * 0.5,
        "Text missing or differs at frame " + frame,
      );
      report.push(stat);
    }
  }
  const probe = JSON.parse(
    execFileSync(env.SUPP_FFPROBE, [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-of",
      "json",
      movie,
    ]),
  );
  assert(
    probe.streams.some(
      (s) =>
        s.codec_name === "h264" &&
        s.width === 1080 &&
        s.height === 1920 &&
        s.nb_read_frames === "360",
    ),
  );
  assert(probe.streams.some((s) => s.codec_name === "aac"));
  const pcm = execFileSync(
    env.SUPP_FFMPEG,
    [
      "-v",
      "error",
      "-i",
      movie,
      "-map",
      "0:a:0",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { windowsHide: true, maxBuffer: 8_000_000 },
  );
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2;
  const rms = Math.sqrt(sum / (pcm.length / 4));
  assert(rms > 0.001);
  await fs.writeFile(
    path.join(dir, "native-verification.json"),
    JSON.stringify({ frames: 360, rms, comparisons: report }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
