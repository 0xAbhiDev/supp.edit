import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function save(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  return JSON.parse(await fs.readFile((await download.path())!, "utf8"));
}
async function open(page: Page, p: unknown) {
  await page
    .getByTestId("project-input")
    .setInputFiles({
      name: "parenting.supp",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
}
test("parent controller UI preserves placement, animates children, undo/reopen and real PNG", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const initial = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts";
    const { newProject, newClip, newTrack } = await import(sm);
    const p = newProject("Parenting acceptance", 320, 180),
      parent = newClip(p.tracks[0].id, 0, 60, "null"),
      track = newTrack("video", 2),
      child = newClip(track.id, 0, 60, "shape");
    parent.id = "controller";
    parent.name = "Controller";
    parent.transform.rotation = 30;
    parent.transform.scaleX = 1.5;
    parent.transform.scaleY = 0.7;
    child.id = "child";
    child.name = "Child";
    child.shape.width = 100;
    child.shape.height = 60;
    child.transform.x = -15;
    child.transform.rotation = -20;
    p.tracks.unshift(track);
    p.clips = [parent, child];
    return p;
  });
  await open(page, initial);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Child", exact: true }).click();
  await page
    .getByLabel("Parent layer", { exact: true })
    .selectOption("controller");
  const parented = await save(page);
  expect(parented.clips[1].parentId).toBe("controller");
  const world = async (p: any) =>
    page.evaluate(async (p) => {
      const a = "/packages/animation/affine.ts";
      return (await import(a)).layerTransforms(p, 0).world("child");
    }, p);
  const before = await world(initial),
    after = await world(parented);
  after.forEach((v: number, i: number) => expect(v).toBeCloseTo(before[i], 6));
  await page.getByRole("button", { name: "Controller", exact: true }).click();
  await expect(page.getByLabel("Layer controller overlay")).toBeVisible();
  await expect(
    page
      .getByLabel("Parent layer", { exact: true })
      .locator('option[value="child"]'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Enable animation", exact: true })
    .click();
  await page.getByLabel("Animation playhead").fill("30");
  await page.getByLabel("Position X", { exact: true }).fill("70");
  const animated = await save(page);
  expect(animated.clips[0].keyframes.x).toHaveLength(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await save(page)).clips[0].keyframes.x).toHaveLength(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await open(page, animated);
  expect((await save(page)).clips).toEqual(animated.clips);
  await page.getByRole("button", { name: "Controller", exact: true }).click();
  await page.screenshot({ path: "test-results/parent-controller.png" });
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
  await fs.writeFile("test-results/parent-controller-export.png", png);
});
test("animated affine hierarchy renders on GPU/Canvas, persists and exports every frame", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      rm = "/packages/engine/compositor.ts";
    const { newProject, newClip, newTrack, parseProject } = await import(sm),
      { Compositor } = await import(rm);
    const p = newProject("Parenting render study", 320, 180),
      root = newClip(p.tracks[0].id, 0, 60, "null"),
      middle = newClip(p.tracks[0].id, 0, 60, "null"),
      track = newTrack("video", 2),
      child = newClip(track.id, 0, 60, "shape");
    root.id = "root-controller";
    root.name = "Root controller";
    root.transform.rotation = 25;
    root.transform.scaleX = 1.4;
    root.transform.scaleY = 0.7;
    root.transform.anchorX = 5;
    root.keyframes.x = [
      { frame: 0, value: -30, easing: "bezier", outHandle: { x: 0.3, y: 10 } },
      { frame: 59, value: 30, easing: "linear" },
    ];
    middle.id = "nested-controller";
    middle.parentId = root.id;
    middle.transform.rotation = -45;
    middle.transform.scaleX = 0.8;
    middle.transform.scaleY = 1.1;
    middle.transform.y = 5;
    child.id = "child";
    child.name = "Parented card";
    child.parentId = middle.id;
    child.shape = { type: "ellipse", color: "#c3f96b", width: 135, height: 70 };
    child.transform.x = 10;
    child.transform.opacity = 0.85;
    child.mask = {
      type: "ellipse",
      x: 0.3,
      y: 0.15,
      width: 0.45,
      height: 0.65,
    };
    child.effects.saturation = 0.6;
    child.crop.cropLeft = 0.15;
    p.tracks.unshift(track);
    p.clips = [root, middle, child];
    const reopened = parseProject(JSON.parse(JSON.stringify(p)));
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" }),
      frames: string[] = [],
      parity: any[] = [];
    for (let f = 0; f < 60; f++) {
      await gpu.render(p, f, false, 1, true);
      const png = a.toDataURL().split(",")[1];
      frames.push(png);
      if ([0, 30, 59].includes(f)) {
        await cpu.render(p, f, false, 1, true);
        const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
          y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
        let error = 0,
          lit = 0;
        for (let i = 0; i < x.length; i++) {
          error += Math.abs(x[i] - y[i]);
          if (i % 4 !== 3 && x[i] > 20) lit++;
        }
        parity.push({
          frame: f,
          mae: error / x.length,
          lit,
          backend: gpu.backend,
          fallback: gpu.fallback,
        });
      }
      await gpu.render(reopened, f, false, 1, true);
      if (a.toDataURL().split(",")[1] !== png)
        throw new Error("Reopen changed pixels");
    }
    await gpu.dispose();
    await cpu.dispose();
    return { p, frames, parity };
  });
  for (const row of report.parity) {
    expect(row.backend, row.fallback).toContain("WebGL2");
    expect(row.lit).toBeGreaterThan(1000);
    expect(row.mae).toBeLessThan(2);
  }
  const dir = "test-results/parenting";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/project.supp`, JSON.stringify(report.p, null, 2));
  await fs.writeFile(
    `${dir}/parity.json`,
    JSON.stringify(report.parity, null, 2),
  );
  await Promise.all(
    report.frames.map((s: string, i: number) =>
      fs.writeFile(`${dir}/${i}.png`, Buffer.from(s, "base64")),
    ),
  );
});
