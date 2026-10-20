import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("WebGL textures match CPU transforms, opacity, masks, color and blur; context loss falls back", async ({
  page,
}) => {
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const schema = "/packages/project-schema/index.ts",
      render = "/packages/engine/compositor.ts";
    const { newProject, newClip } = await import(schema),
      { Compositor } = await import(render);
    const p = newProject("GPU parity", 320, 180),
      c = newClip(p.tracks[0].id, 0, 30, "shape");
    p.clips.push(c);
    c.shape = { type: "rectangle", color: "#83b452", width: 180, height: 100 };
    c.transform = { x: 15, y: 9, scale: 0.8, rotation: 19, opacity: 0.7 };
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" });
    const reports = [];
    for (const kind of ["transform", "color", "ellipse", "rectangle", "blur"]) {
      if (kind === "color")
        c.effects = {
          blur: 0,
          brightness: 1.2,
          contrast: 0.85,
          saturation: 0.4,
        };
      if (kind === "ellipse")
        c.mask = { type: "ellipse", x: 0.25, y: 0.2, width: 0.5, height: 0.6 };
      if (kind === "rectangle") c.mask.type = "rectangle";
      if (kind === "blur") {
        c.mask = null;
        c.effects.blur = 4;
      }
      await gpu.render(p, 0, false, 1, true);
      await cpu.render(p, 0, false, 1, true);
      const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
        y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
      let error = 0,
        lit = 0;
      for (let i = 0; i < x.length; i += 4) {
        for (let j = 0; j < 3; j++) error += Math.abs(x[i + j] - y[i + j]);
        if (x[i] + x[i + 1] + x[i + 2] > 20) lit++;
      }
      reports.push({
        kind,
        mae: error / (320 * 180 * 3),
        lit,
        backend: gpu.backend,
        fallback: gpu.fallback,
      });
    }
    const device = gpu.device;
    gpu.gpu.gl.getExtension("WEBGL_lose_context").loseContext();
    await new Promise((r) => setTimeout(r, 50));
    await gpu.render(p, 1, false, 1, true);
    const fallback = gpu.backend,
      reason = gpu.fallback;
    await gpu.dispose();
    await cpu.dispose();
    return { reports, device, fallback, reason };
  });
  await fs.writeFile(
    "test-results/gpu-parity.json",
    JSON.stringify(report, null, 2),
  );
  for (const row of report.reports) {
    expect(row.backend, row.fallback).toContain("WebGL2");
    expect(row.lit).toBeGreaterThan(1000);
    expect(row.mae, JSON.stringify(row)).toBeLessThan(3);
  }
  expect(report.fallback).toContain("Canvas2D");
  expect(report.reason).toContain("context lost");
});
test("playback resolution persists and never reduces PNG export resolution", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByLabel("Playback resolution").selectOption("0.25");
  await expect
    .poll(() =>
      page
        .getByLabel("Program monitor")
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(480);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Renderer mode").selectOption("cpu");
  await expect(page.locator(".monitor-label")).toContainText("Canvas2D");
  await page
    .getByRole("button", {
      name: "Close Preferences & diagnostics",
      exact: true,
    })
    .click();
  await page
    .locator(".workspace-tabs")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export current frame · PNG", exact: true })
      .click(),
  ]);
  const png = await fs.readFile((await download.path())!);
  expect(png.readUInt32BE(16)).toBe(1920);
  expect(png.readUInt32BE(20)).toBe(1080);
  await page.reload();
  await expect(page.getByLabel("Playback resolution")).toHaveValue("0.25");
});
