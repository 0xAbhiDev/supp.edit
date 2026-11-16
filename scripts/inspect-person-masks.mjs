// Visual evidence from decoded footage and actual local model output, never synthetic masks.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { mediaEnvironment } from "./runtime.mjs";
const dir = path.resolve(process.argv[2]);
const read = async (name) =>
  JSON.parse(
    (await fs.readFile(path.join(dir, name), "utf8")).replace(/^\uFEFF/, ""),
  );
const p = await read("SOURCE.supp"),
  env = mediaEnvironment(),
  tiles = [];
for (const i of [0, 1, 3, 4]) {
  const masks = await read(`${i}-person.json`),
    a = p.assets[i];
  for (const fraction of [0.2, 0.5, 0.8]) {
    const m = masks[Math.floor((masks.length - 1) * fraction)];
    const image = execFileSync(
      env.SUPP_FFMPEG,
      [
        "-v",
        "error",
        "-ss",
        String(m.timeMs / 1000),
        "-i",
        a.path,
        "-frames:v",
        "1",
        "-vf",
        "scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2",
        "-f",
        "image2pipe",
        "-c:v",
        "png",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    tiles.push({
      title: `${a.name} · ${m.timeMs} ms`,
      image: image.toString("base64"),
      points: m.points,
      width: a.width,
      height: a.height,
    });
  }
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const png = await page.evaluate(async (tiles) => {
    const c = document.createElement("canvas");
    c.width = 1152;
    c.height = 4 * 242;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#15171a";
    ctx.fillRect(0, 0, c.width, c.height);
    for (const [i, t] of tiles.entries()) {
      const image = new Image();
      image.src = "data:image/png;base64," + t.image;
      await image.decode();
      const x = (i % 3) * 384,
        y = Math.floor(i / 3) * 242;
      ctx.drawImage(image, x, y + 26);
      ctx.fillStyle = "white";
      ctx.font = "12px Arial";
      ctx.fillText(t.title.slice(0, 54), x + 8, y + 17);
      const fit = Math.min(384 / t.width, 216 / t.height),
        w = t.width * fit,
        h = t.height * fit;
      ctx.beginPath();
      t.points.forEach(([px, py], j) =>
        ctx[j ? "lineTo" : "moveTo"](
          x + (384 - w) / 2 + px * w,
          y + 26 + (216 - h) / 2 + py * h,
        ),
      );
      ctx.closePath();
      ctx.fillStyle = "rgba(0,255,170,.18)";
      ctx.fill();
      ctx.strokeStyle = "#00ffaa";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    return c.toDataURL("image/png").split(",")[1];
  }, tiles);
  await fs.writeFile(
    path.join(dir, "person-masks.png"),
    Buffer.from(png, "base64"),
  );
} finally {
  await browser.close();
}
console.log(path.join(dir, "person-masks.png"));
