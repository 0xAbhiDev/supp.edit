// Repeated cold decoder seeks through the production resource pool on real media.
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mediaEnvironment, launchBrowser } from "./runtime.mjs";
const [input, out, seconds = "5.2"] = process.argv.slice(2);
if (!input || !out) throw Error("Supply a video and report path");
const env = mediaEnvironment(),
  time = Number(seconds);
const probe = JSON.parse(
  execFileSync(
    env.SUPP_FFPROBE,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", input],
    { env, windowsHide: true },
  ),
);
const video = probe.streams.find((s) => s.codec_type === "video"),
  duration = Number(probe.format.duration);
if (!video || !Number.isFinite(time) || time < 0 || time >= duration)
  throw Error("Choose a time within the supplied video");
const [num, den] = video.avg_frame_rate.split("/").map(Number);
const metadata = {
  width: video.width,
  height: video.height,
  duration,
  fps: num / den || 30,
  size: Number(probe.format.size),
};
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
const browser = await launchBrowser(chromium);
try {
  const page = await browser.newPage();
  // A blank same-origin page; installed Chrome rejects the 404 the pinned shell tolerated.
  const origin = new URL("seek-harness.html", server.resolvedUrls.local[0]).href;
  await page.route(origin, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Seek harness</title>" }));
  await page.goto(origin);
  const report = await page.evaluate(
    async ({ bytes, name, metadata, seconds }) => {
      const { newProject, newClip } =
        await import("/packages/project-schema/index.ts");
      const { ResourcePool } = await import("/packages/engine/resources.ts");
      const { writeLocal } = await import("/packages/platform/storage.ts");
      const asset = {
        id: "seek-evidence",
        name,
        kind: "video",
        fingerprint: "seek-evidence",
        path: "",
        ...metadata,
        hasAudio: false,
      };
      await writeLocal(
        "media",
        asset.id + ":" + asset.fingerprint,
        new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
          type: name.endsWith(".webm") ? "video/webm" : "video/mp4",
        }),
      );
      const p = newProject("Cold decoder seek", 320, 180);
      p.assets = [asset];
      const rows = [];
      const sample = (source) => {
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 72;
        const x = c.getContext("2d");
        x.drawImage(source, 0, 0, 128, 72);
        const d = x.getImageData(0, 0, 128, 72).data;
        let sum = 0,
          alpha = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum += d[i] + d[i + 1] + d[i + 2];
          alpha += d[i + 3];
        }
        return { mean: sum / (128 * 72 * 3), alpha: alpha / (128 * 72) };
      };
      for (let trial = 0; trial < 32; trial++) {
        const pool = new ResourcePool(true),
          clip = newClip(p.tracks[0].id, 0, 30, "media", asset);
        clip.sourceIn = Math.round(seconds * 30);
        pool.setActive(new Set([clip.id]));
        const clone = structuredClone(clip);
        clone.id += "-background";
        pool.setActive(new Set([clip.id, clone.id]));
        const [r] = await Promise.all([
          pool.prepare(clip, asset, p, 0, false, 1),
          pool.prepare(clone, asset, p, 0, false, 1).then(async (r) => {
            await pool.visual(r, clone, asset, p, 0, false);
            return r;
          }),
        ]);
        const video = r.element,
          ready = video.readyState,
          time = video.currentTime;
        const bitmap = await pool.visual(r, clip, asset, p, 0, false);
        const first = sample(bitmap),
          direct = sample(video);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const later = sample(video);
        rows.push({ trial, ready, time, first, direct, later });
        pool.releaseFrames();
        await pool.dispose();
      }
      return rows;
    },
    {
      bytes: (await fs.readFile(input)).toString("base64"),
      name: path.basename(input),
      metadata,
      seconds: time,
    },
  );
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.log({
    trials: report.length,
    min: Math.min(...report.map((r) => r.first.mean)),
    failures: report.filter((r) => r.first.mean < 8),
  });
} finally {
  await browser.close();
  await server.close();
}
