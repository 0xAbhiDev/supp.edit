import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("cold video seek waits for presentation, ignores stale seek events, and preserves cached pixels", async ({
  page,
}) => {
  await page.goto("/");
  const bytes = (
    await fs.readFile("test-results/fixtures/footage.mp4")
  ).toString("base64");
  const report = await page.evaluate(async (bytes) => {
    const module = "/packages/engine/seek-media.ts";
    const { seekMedia } = await import(module);
    const blob = new Blob(
      [Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))],
      { type: "video/mp4" },
    );
    const url = URL.createObjectURL(blob),
      video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const loaded = new Promise<void>((resolve) =>
      video.addEventListener("loadeddata", () => resolve(), { once: true }),
    );
    video.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext("2d")!,
      samples = [];
    for (const time of [1.5, 0.5, 1.5, 0.517]) {
      let settled = false;
      const ready = seekMedia(video, time, 30).then(() => {
        settled = true;
      });
      video.dispatchEvent(new Event("seeked"));
      await Promise.resolve();
      const premature = settled;
      await ready;
      ctx.drawImage(video, 0, 0, 160, 90);
      const pixels = ctx.getImageData(0, 0, 160, 90).data;
      samples.push({
        time,
        premature,
        seeking: video.seeking,
        ready: video.readyState,
        png: canvas.toDataURL(),
        lit: pixels.filter((v, i) => i % 4 !== 3 && v > 32).length,
      });
    }
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    return samples;
  }, bytes);
  for (const sample of report) {
    expect(sample.premature).toBe(false);
    expect(sample.seeking).toBe(false);
    expect(sample.ready).toBeGreaterThanOrEqual(2);
    expect(sample.lit).toBeGreaterThan(1000);
  }
  expect(report[0].png).toBe(report[2].png);
  expect(report[0].png).not.toBe(report[1].png);
});
