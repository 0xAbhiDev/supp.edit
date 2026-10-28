import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function save(page: Page) {
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  return JSON.parse(await fs.readFile((await d.path())!, "utf8"));
}
async function open(page: Page, p: unknown) {
  await page
    .getByTestId("project-input")
    .setInputFiles({
      name: "effects.supp",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
}
test("ordered effects change real pixels, blur masks, animate nested mattes, reopen and export", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      rm = "/packages/engine/compositor.ts",
      mm = "/packages/masks/model.ts";
    const { newProject, newClip, newTrack, parseProject } = await import(sm),
      { Compositor } = await import(rm),
      { newMask } = await import(mm);
    const p = newProject("Ordered effect validation", 320, 180),
      c = newClip(p.tracks[0].id, 0, 60, "shape");
    c.id = "card";
    c.shape = { type: "rectangle", width: 320, height: 180, color: "#808080" };
    p.clips = [c];
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" }),
      report: any[] = [];
    const check = async (label: string, frame = 0, project = p) => {
      await gpu.render(project, frame, false, 1, true, "transparent");
      await cpu.render(project, frame, false, 1, true, "transparent");
      const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
        y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
      const center = Array.from(
        x.slice((90 * 320 + 160) * 4, (90 * 320 + 160) * 4 + 4),
      );
      report.push({
        label,
        frame,
        mae:
          x.reduce(
            (s: number, v: number, i: number) => s + Math.abs(v - y[i]),
            0,
          ) / x.length,
        backend: gpu.backend,
        fallback: gpu.fallback,
        center,
      });
      return x;
    };
    c.effectStack = [
      { id: "b", type: "brightness", value: 0.6, enabled: true, keys: [] },
      { id: "c", type: "contrast", value: 2, enabled: true, keys: [] },
    ];
    await check("brightness-contrast");
    c.effectStack.reverse();
    await check("contrast-brightness");
    c.effectStack[0].enabled = false;
    await check("bypass");
    c.effectStack = [
      { id: "blur", type: "blur", value: 4, enabled: true, keys: [] },
    ];
    c.masks = [newMask("rectangle")];
    // A square coverage edge at x=80 must spread beyond the mask after the ordered blur.
    c.masks[0].vertices = c.masks[0].vertices.map((v: any, i: number) => ({
      ...v,
      x: i === 0 || i === 3 ? 0.25 : 0.75,
      y: i < 2 ? 0.25 : 0.75,
      in: { x: 0, y: 0 },
      out: { x: 0, y: 0 },
    }));
    const spill = await check("mask-before-blur");
    const outsideAlpha = spill[(90 * 320 + 77) * 4 + 3];
    c.effectStack.push({
      id: "sat",
      type: "saturation",
      value: 0.5,
      enabled: true,
      keys: [],
    });
    c.effectStack.push({
      id: "bright",
      type: "brightness",
      value: 1,
      enabled: true,
      keys: [
        { frame: 0, value: 0.5, easing: "ease-in-out" },
        { frame: 59, value: 2, easing: "linear" },
      ],
    });
    c.transform.opacity = 0.6;
    c.blendMode = "screen";
    c.shape.color = "#b06030";
    const t = newTrack("video", 3),
      m = newClip(t.id, 0, 60, "shape");
    m.id = "matte";
    m.shape = { type: "ellipse", width: 180, height: 140, color: "#ffffff" };
    m.effectStack = [
      { id: "mblur", type: "blur", value: 3, enabled: true, keys: [] },
    ];
    p.tracks.push(t);
    t.hidden = true;
    p.clips.push(m);
    c.matte = { layerId: m.id, mode: "alpha" };
    const root = newProject("Nested ordered effects", 320, 180);
    root.compositions = [
      {
        id: "inner",
        name: "Inner effects",
        duration: 60,
        settings: p.settings,
        background: "transparent",
        tracks: p.tracks,
        layers: p.clips,
      },
    ];
    const instance = newClip(root.tracks[0].id, 0, 60, "composition");
    instance.compositionId = "inner";
    root.clips = [instance];
    for (const f of [0, 30, 59]) await check("nested", f, root);
    const frames: string[] = [];
    for (let f = 0; f < 60; f++) {
      await gpu.render(root, f, false, 1, true);
      frames.push(a.toDataURL("image/png").split(",")[1]);
    }
    const reopened = parseProject(JSON.parse(JSON.stringify(root)));
    let identical = 0;
    for (let f = 0; f < 60; f++) {
      await gpu.render(reopened, f, false, 1, true);
      if (a.toDataURL("image/png").split(",")[1] === frames[f]) identical++;
    }
    await gpu.dispose();
    await cpu.dispose();
    return {
      report,
      outsideAlpha,
      frames,
      identical,
      project: root,
      released: cpu.effectSurfaceBytes,
    };
  });
  for (const row of result.report) {
    expect(row.backend, row.fallback).toContain("WebGL2");
    expect(row.mae, JSON.stringify(row)).toBeLessThan(2);
  }
  expect(result.report[0].center[0]).toBeCloseTo(27, 0);
  expect(result.report[1].center[0]).toBeCloseTo(77, 0);
  expect(result.outsideAlpha).toBeGreaterThan(5);
  expect(result.identical).toBe(60);
  expect(result.released).toBe(0);
  expect(result.frames[0]).not.toBe(result.frames[59]);
  await fs.mkdir("test-results/effects", { recursive: true });
  await fs.writeFile(
    "test-results/effects/project.supp",
    JSON.stringify(result.project, null, 2),
  );
  for (let i = 0; i < 60; i++)
    await fs.writeFile(
      `test-results/effects/${i}.png`,
      Buffer.from(result.frames[i], "base64"),
    );
  await fs.writeFile(
    "test-results/effects/parity.json",
    JSON.stringify(
      { ...result, frames: undefined, project: undefined },
      null,
      2,
    ),
  );
});
test("effect stack UI reorders, animates, bypasses, undoes and persists real PNG output", async ({
  page,
}) => {
  await page.goto("/");
  const p = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts";
    const { newProject, newClip } = await import(sm);
    const p = newProject("Effect UI", 320, 180),
      c = newClip(p.tracks[0].id, 0, 60, "shape");
    c.name = "Card";
    c.shape = { type: "rectangle", width: 240, height: 130, color: "#808080" };
    p.clips = [c];
    return p;
  });
  await open(page, p);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Card", exact: true }).click();
  await page
    .getByLabel("Effect to add", { exact: true })
    .selectOption("brightness");
  await page.getByRole("button", { name: "Add effect", exact: true }).click();
  await page.getByLabel("Brightness amount 1", { exact: true }).fill("0.6");
  await page
    .getByLabel("Effect to add", { exact: true })
    .selectOption("contrast");
  await page.getByRole("button", { name: "Add effect", exact: true }).click();
  await page.getByLabel("Contrast amount 2", { exact: true }).fill("2");
  await page.getByLabel("Move effect 2 up", { exact: true }).click();
  let saved = await save(page);
  expect(saved.clips[0].effectStack.map((e: any) => e.type)).toEqual([
    "contrast",
    "brightness",
  ]);
  await page.getByLabel("Enable Contrast 1", { exact: true }).uncheck();
  await page.getByLabel("Toggle effect 2 keyframe", { exact: true }).click();
  await page.getByLabel("Animation playhead", { exact: true }).fill("30");
  await page.getByLabel("Brightness amount 2", { exact: true }).fill("1.5");
  saved = await save(page);
  expect(saved.clips[0].effectStack[1].keys).toHaveLength(2);
  await page.getByLabel("Remove effect 1", { exact: true }).click();
  await expect(page.getByTestId("effect-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("effect-entry")).toHaveCount(2);
  await open(page, saved);
  await page.getByRole("button", { name: "Card", exact: true }).click();
  expect((await save(page)).clips).toEqual(saved.clips);
  await page.screenshot({ path: "test-results/effect-ui.png" });
  await page
    .locator(".workspace-tabs")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export current frame · PNG", exact: true })
      .click(),
  ]);
  const png = await fs.readFile((await d.path())!);
  expect(png.readUInt32BE(16)).toBe(320);
  await fs.writeFile("test-results/effect-ui-export.png", png);
});
