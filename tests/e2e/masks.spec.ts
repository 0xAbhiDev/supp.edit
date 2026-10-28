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
      name: "masks.supp",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
}
test("Bezier mask controls, tangents, pen, animation, undo, reopen and PNG", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const p = await page.evaluate(async () => {
    const path = "/packages/project-schema/index.ts";
    const { newProject, newClip } = await import(path);
    const p = newProject("Mask acceptance", 320, 180),
      c = newClip(p.tracks[0].id, 0, 60, "shape");
    c.name = "Card";
    c.shape.width = 300;
    c.shape.height = 170;
    p.clips = [c];
    return p;
  });
  await open(page, p);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Card", exact: true }).click();
  await page.getByRole("button", { name: "Ellipse mask", exact: true }).click();
  await page.getByLabel("Mask feather", { exact: true }).fill("2");
  await page
    .getByLabel("Toggle mask feather keyframe", { exact: true })
    .click();
  await page.getByLabel("Toggle mask path keyframe", { exact: true }).click();
  await page.getByLabel("Animation playhead", { exact: true }).fill("30");
  await page.getByLabel("Mask feather", { exact: true }).fill("8");
  await page.getByLabel("Vertex X", { exact: true }).fill("0.6");
  let saved = await save(page);
  expect(saved.schemaVersion).toBe(7);
  expect(saved.clips[0].masks[0].pathKeys).toHaveLength(2);
  expect(saved.clips[0].masks[0].keyframes.feather).toHaveLength(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await save(page)).clips[0].masks[0].pathKeys).toHaveLength(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const handle = page.getByRole("button", {
      name: "Mask vertex 1 out handle",
      exact: true,
    }),
    box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 22,
    box.y + box.height / 2 + 15,
    { steps: 4 },
  );
  await page.mouse.up();
  saved = await save(page);
  expect(saved.clips[0].masks[0].pathKeys[1].vertices[0].out.y).not.toBe(0);
  await page.getByRole("button", { name: "Draw mask", exact: true }).click();
  const canvas = (await page
    .getByLabel("Mask path editor", { exact: true })
    .boundingBox())!;
  for (const [x, y] of [
    [0.35, 0.35],
    [0.65, 0.35],
    [0.5, 0.7],
  ])
    await page.mouse.click(
      canvas.x + x * canvas.width,
      canvas.y + y * canvas.height,
    );
  await page
    .getByRole("button", { name: "Finish mask (3)", exact: true })
    .click();
  await page
    .getByLabel("Mask combine", { exact: true })
    .selectOption("subtract");
  saved = await save(page);
  expect(saved.clips[0].masks).toHaveLength(2);
  expect(saved.clips[0].masks[1].vertices).toHaveLength(3);
  await open(page, saved);
  await page.getByRole("button", { name: "Card", exact: true }).click();
  expect((await save(page)).clips[0].masks).toEqual(saved.clips[0].masks);
  await page.screenshot({ path: "test-results/bezier-mask-ui.png" });
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
  await fs.writeFile("test-results/bezier-mask-export.png", png);
});
test("real coverage combinations, feather/expansion and animated GPU/CPU render/export parity", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      mm = "/packages/masks/model.ts",
      rm = "/packages/engine/compositor.ts";
    const { newProject, newClip, parseProject } = await import(sm),
      { newMask } = await import(mm),
      { Compositor } = await import(rm);
    const p = newProject("Animated Bezier masks", 320, 180),
      c = newClip(p.tracks[0].id, 0, 60, "shape");
    c.shape = { type: "rectangle", color: "#ffffff", width: 320, height: 180 };
    c.name = "Masked card";
    p.clips = [c];
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" });
    const sample = (canvas: HTMLCanvasElement, x: number, y: number) =>
      canvas.getContext("2d")!.getImageData(x, y, 1, 1).data[0];
    const base = newMask();
    c.masks = [base];
    const samples: any[] = [];
    const render = async () => {
      await gpu.render(p, 0, false, 1, true);
      await cpu.render(p, 0, false, 1, true);
    };
    await render();
    samples.push({
      name: "rectangle",
      center: sample(a, 160, 90),
      outside: sample(a, 30, 90),
    });
    base.inverted = true;
    await render();
    samples.push({
      name: "inverted",
      center: sample(a, 160, 90),
      outside: sample(a, 30, 90),
    });
    base.inverted = false;
    base.feather = 5;
    await render();
    samples.push({
      name: "feather",
      edge: sample(a, 80, 90),
      inside: sample(a, 95, 90),
      outside: sample(a, 65, 90),
    });
    base.feather = 0;
    base.expansion = 10;
    await render();
    samples.push({ name: "expand", edge: sample(a, 75, 90) });
    base.expansion = -10;
    await render();
    samples.push({ name: "erode", edge: sample(a, 85, 90) });
    base.expansion = 0;
    const hole = newMask("ellipse");
    hole.vertices = hole.vertices.map((v: any) => ({
      ...v,
      x: 0.5 + (v.x - 0.5) * 0.4,
      y: 0.5 + (v.y - 0.5) * 0.4,
      in: { x: v.in.x * 0.4, y: v.in.y * 0.4 },
      out: { x: v.out.x * 0.4, y: v.out.y * 0.4 },
    }));
    c.masks = [base, hole];
    const parity: any[] = [];
    for (const mode of ["add", "subtract", "intersect", "difference"]) {
      hole.mode = mode;
      await render();
      samples.push({
        name: mode,
        center: sample(a, 160, 90),
        ring: sample(a, 105, 90),
      });
      const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
        y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
      parity.push({
        mode,
        mae:
          x.reduce(
            (n: number, v: number, i: number) => n + Math.abs(v - y[i]),
            0,
          ) / x.length,
        backend: gpu.backend,
        fallback: gpu.fallback,
      });
    }
    hole.mode = "subtract";
    hole.feather = 3;
    base.feather = 2;
    base.vertices[0].out = { x: 0.2, y: -0.15 };
    base.pathKeys = [
      { frame: 0, easing: "linear", vertices: structuredClone(base.vertices) },
      {
        frame: 59,
        easing: "linear",
        vertices: base.vertices.map((v: any) => ({
          ...v,
          x: v.x + 0.08,
          y: v.y + 0.03,
        })),
      },
    ];
    base.keyframes.expansion = [
      { frame: 0, value: -8, easing: "ease-in-out" },
      { frame: 59, value: 12, easing: "linear" },
    ];
    c.transform.rotation = 13;
    c.transform.scaleX = 0.9;
    c.transform.scaleY = 0.8;
    const frames: string[] = [],
      reopened = parseProject(JSON.parse(JSON.stringify(p)));
    for (let frame = 0; frame < 60; frame++) {
      await gpu.render(p, frame, false, 1, true);
      const png = a.toDataURL().split(",")[1];
      frames.push(png);
      await gpu.render(reopened, frame, false, 1, true);
      if (a.toDataURL().split(",")[1] !== png)
        throw new Error("Mask reopen changed pixels");
      if ([0, 30, 59].includes(frame)) {
        await cpu.render(p, frame, false, 1, true);
        const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
          y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
        parity.push({
          frame,
          mae:
            x.reduce(
              (n: number, v: number, i: number) => n + Math.abs(v - y[i]),
              0,
            ) / x.length,
          backend: gpu.backend,
          fallback: gpu.fallback,
        });
      }
    }
    const maskBytes = gpu.maskSurfaceBytes;
    await gpu.dispose();
    await cpu.dispose();
    return {
      p,
      frames,
      samples,
      parity,
      maskBytes,
      disposedBytes: gpu.maskSurfaceBytes,
    };
  });
  const byName = Object.fromEntries(
    report.samples.map((s: any) => [s.name, s]),
  );
  expect(byName.rectangle).toMatchObject({ center: 255, outside: 0 });
  expect(byName.inverted).toMatchObject({ center: 0, outside: 255 });
  expect(byName.feather.edge).toBeGreaterThan(80);
  expect(byName.feather.edge).toBeLessThan(180);
  expect(byName.feather.inside).toBeGreaterThan(245);
  expect(byName.feather.outside).toBeLessThan(10);
  expect(byName.expand.edge).toBe(255);
  expect(byName.erode.edge).toBe(0);
  expect(byName.subtract).toMatchObject({ center: 0, ring: 255 });
  expect(byName.intersect).toMatchObject({ center: 255, ring: 0 });
  expect(byName.difference).toMatchObject({ center: 0, ring: 255 });
  expect(byName.add.center).toBe(255);
  for (const row of report.parity) {
    expect(row.backend, row.fallback).toContain("WebGL2");
    expect(row.mae).toBeLessThan(2);
  }
  expect(report.maskBytes).toBeLessThan(128 * 1024 * 1024);
  expect(report.disposedBytes).toBe(0);
  const dir = "test-results/masks";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dir + "/project.supp", JSON.stringify(report.p, null, 2));
  await fs.writeFile(
    dir + "/parity.json",
    JSON.stringify(
      {
        samples: report.samples,
        parity: report.parity,
        maskBytes: report.maskBytes,
      },
      null,
      2,
    ),
  );
  await Promise.all(
    report.frames.map((s: string, i: number) =>
      fs.writeFile(dir + "/" + i + ".png", Buffer.from(s, "base64")),
    ),
  );
});
