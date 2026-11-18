// Does seeking a paused video to the time it already shows complete? Reproduces the export
// timeout "Timed out waiting for decoded media frame" without the application.
// Usage: node scripts/inspect-same-time-seek.mjs VIDEO
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { launchBrowser } from "./runtime.mjs";
const [video] = process.argv.slice(2);
if (!video) throw Error("Supply a local video file.");
const host = await createServer({ server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
let browser;
try {
  await host.listen();
  browser = await launchBrowser(chromium);
  const page = await browser.newPage();
  const site = host.resolvedUrls.local[0],
    url = new URL("same-time.webm", site).href,
    origin = new URL("same-time.html", site).href;
  await page.route(url, (r) => r.fulfill({ path: video, contentType: video.endsWith(".webm") ? "video/webm" : "video/mp4" }));
  await page.route(origin, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Seek</title>" }));
  await page.goto(origin);
  const result = await page.evaluate(async (url) => {
    const { seekMedia } = await import("/packages/engine/seek-media.ts");
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = URL.createObjectURL(await (await fetch(url)).blob());
    await new Promise((r) => (v.onloadeddata = r));
    const timed = async (t) => {
      const start = performance.now();
      try {
        await Promise.race([seekMedia(v, t, 30), new Promise((_, no) => setTimeout(() => no(new Error("still waiting after 3 s")), 3000))]);
        return { time: t, ms: Math.round(performance.now() - start) };
      } catch (e) {
        return { time: t, error: String(e) };
      }
    };
    const rows = [await timed(1.5), await timed(1.5)];
    // As after preview playback: play, pause, then ask for the frame already shown.
    await v.play();
    await new Promise((r) => setTimeout(r, 400));
    v.pause();
    await new Promise((r) => setTimeout(r, 200));
    rows.push({ ...(await timed(v.currentTime)), afterPlayback: true });
    return rows;
  }, url);
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await host.close();
}
