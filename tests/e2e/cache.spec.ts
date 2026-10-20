import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
test("video frame cache retains exact seeks and GPU matches decoded CPU footage", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByTestId("media-input")
    .setInputFiles(path.resolve("test-results/fixtures/footage.mp4"));
  await expect(page.getByLabel("Preview footage.mp4")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = JSON.parse(await fs.readFile((await download.path())!, "utf8"));
  const report = await page.evaluate(async (saved) => {
    const sm = "/packages/project-schema/index.ts",
      cm = "/packages/engine/compositor.ts";
    const { newProject, newClip } = await import(sm),
      { Compositor } = await import(cm);
    const p = newProject("Cache parity", 320, 180);
    p.assets = saved.assets;
    p.clips = [newClip(p.tracks[0].id, 0, 90, "media", p.assets[0])];
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" }),
      rows = [];
    for (const f of [15, 60, 15]) {
      await gpu.render(p, f, false, 1, true);
      await cpu.render(p, f, false, 1, true);
      const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
        y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
      let error = 0;
      for (let i = 0; i < x.length; i++) error += Math.abs(x[i] - y[i]);
      rows.push({ frame: f, mae: error / x.length, png: a.toDataURL() });
    }
    const hits = gpu.pool.frames.hits,
      bytes = gpu.pool.frames.bytes,
      backend = gpu.backend;
    await gpu.dispose();
    await cpu.dispose();
    return { rows, hits, bytes, backend };
  }, saved);
  expect(report.backend).toContain("WebGL2");
  expect(report.hits).toBeGreaterThan(0);
  expect(report.bytes).toBeLessThanOrEqual(96 * 1024 * 1024);
  expect(report.rows[0].png).toBe(report.rows[2].png);
  expect(report.rows[0].png).not.toBe(report.rows[1].png);
  for (const r of report.rows) expect(r.mae).toBeLessThan(3);
});
test("relink undo restores original pixels and thumbnail, including after reopen", async ({
  page,
}) => {
  await page.goto("/");
  const pngs = await page.evaluate(() =>
    ["#ff0000", "#0000ff"].map((color) => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const x = c.getContext("2d")!;
      x.fillStyle = color;
      x.fillRect(0, 0, 320, 180);
      return c.toDataURL().split(",")[1];
    }),
  );
  const input = (i: number) => ({
    name: i ? "blue.png" : "red.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngs[i], "base64"),
  });
  await page.getByTestId("media-input").setInputFiles(input(0));
  await expect(page.getByLabel("Preview red.png")).toBeVisible();
  await page
    .locator(".asset-actions")
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  const pixel = () =>
    page
      .getByLabel("Program monitor")
      .evaluate((c: HTMLCanvasElement) =>
        Array.from(
          c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1)
            .data,
        ).slice(0, 3),
      );
  await expect.poll(pixel).toEqual([255, 0, 0]);
  const originalThumb = await page
    .getByLabel("Preview red.png")
    .locator("img")
    .getAttribute("src");
  await page
    .getByRole("button", { name: "Relink red.png", exact: true })
    .click();
  await page.getByTestId("media-input").setInputFiles(input(1));
  await expect.poll(pixel).toEqual([0, 0, 255]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(pixel).toEqual([255, 0, 0]);
  await expect(
    page.getByLabel("Preview red.png").locator("img"),
  ).toHaveAttribute("src", originalThumb!);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const p = JSON.parse(await fs.readFile((await download.path())!, "utf8"));
  await page
    .getByTestId("project-input")
    .setInputFiles({
      name: "relinked.supp",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await expect.poll(pixel).toEqual([255, 0, 0]);
});
