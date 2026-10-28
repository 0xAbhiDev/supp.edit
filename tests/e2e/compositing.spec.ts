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
  await page.getByTestId("project-input").setInputFiles({
    name: "matte.supp",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
}
test("all seventeen blend modes render on GPU with Canvas parity including partial alpha", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      cm = "/packages/compositing/model.ts",
      rm = "/packages/engine/compositor.ts";
    const { newProject, newClip, newTrack } = await import(sm),
      { blendModes } = await import(cm),
      { Compositor } = await import(rm);
    const p = newProject("Blend matrix", 160, 120),
      top = newTrack("video", 2),
      bottom = newClip(p.tracks[0].id, 0, 60, "shape"),
      front = newClip(top.id, 0, 60, "shape");
    bottom.shape = {
      type: "rectangle",
      color: "#4080c0",
      width: 160,
      height: 120,
    };
    front.shape = {
      type: "rectangle",
      color: "#d06030",
      width: 120,
      height: 80,
    };
    p.tracks.unshift(top);
    p.clips = [bottom, front];
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" }),
      results: any[] = [];
    for (const opacity of [1, 0.6])
      for (const mode of blendModes) {
        front.blendMode = mode;
        front.transform.opacity = opacity;
        bottom.transform.opacity = opacity;
        await gpu.render(p, 0, false, 1, true, "transparent");
        await cpu.render(p, 0, false, 1, true, "transparent");
        const x = a.getContext("2d")!.getImageData(0, 0, 160, 120).data,
          y = b.getContext("2d")!.getImageData(0, 0, 160, 120).data;
        results.push({
          mode,
          opacity,
          mae:
            x.reduce(
              (s: number, v: number, i: number) => s + Math.abs(v - y[i]),
              0,
            ) / x.length,
          center: Array.from(
            x.slice((60 * 160 + 80) * 4, (60 * 160 + 80) * 4 + 4),
          ),
          expected: Array.from(
            y.slice((60 * 160 + 80) * 4, (60 * 160 + 80) * 4 + 4),
          ),
          backend: gpu.backend,
          fallback: gpu.fallback,
        });
      }
    await gpu.dispose();
    await cpu.dispose();
    return results;
  });
  for (const row of report) {
    expect(row.backend, row.fallback).toContain("WebGL2");
    expect(row.mae, JSON.stringify(row)).toBeLessThan(1.5);
  }
  const dir = "test-results/compositing";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dir + "/blends.json", JSON.stringify(report, null, 2));
  expect(
    report
      .find((r: any) => r.mode === "multiply" && r.opacity === 1)!
      .center.slice(0, 3),
  ).toEqual([52, 48, 36]);
});
test("alpha/luma, inverted/inactive mattes, nested masks and animation persist and encode", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      mm = "/packages/masks/model.ts",
      rm = "/packages/engine/compositor.ts";
    const { newProject, newClip, newTrack, parseProject } = await import(sm),
      { newMask } = await import(mm),
      { Compositor } = await import(rm);
    const p = newProject("Matte and blend study", 320, 180),
      track = newTrack("video", 2),
      target = newClip(p.tracks[0].id, 0, 60, "shape"),
      source = newClip(track.id, 0, 60, "shape");
    target.id = "target";
    target.name = "Color card";
    target.shape = {
      type: "rectangle",
      color: "#c89664",
      width: 320,
      height: 180,
    };
    source.id = "source";
    source.name = "Matte ellipse";
    source.shape = {
      type: "ellipse",
      color: "#808080",
      width: 160,
      height: 90,
    };
    source.transform.opacity = 0.5;
    target.matte = { layerId: source.id, mode: "alpha" };
    track.hidden = true;
    p.tracks.push(track);
    p.clips = [target, source];
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" });
    const sample = (x: number, y: number) =>
      Array.from(a.getContext("2d")!.getImageData(x, y, 1, 1).data);
    const parity: any[] = [],
      samples: any[] = [];
    async function compare(frame: number, project = p) {
      await gpu.render(project, frame, false, 1, true);
      await cpu.render(project, frame, false, 1, true);
      const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
        y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
      parity.push({
        frame,
        mode: project.clips[0].matte.mode,
        mae:
          x.reduce(
            (n: number, v: number, i: number) => n + Math.abs(v - y[i]),
            0,
          ) / x.length,
        backend: gpu.backend,
        fallback: gpu.fallback,
      });
    }
    for (const mode of ["alpha", "alpha-inverted", "luma", "luma-inverted"]) {
      target.matte.mode = mode;
      await compare(0);
      samples.push({ mode, center: sample(160, 90), outside: sample(15, 15) });
    }
    const inactive = structuredClone(p);
    inactive.clips[1].duration = 1;
    for (const mode of ["alpha", "alpha-inverted"]) {
      inactive.clips[0].matte.mode = mode;
      await compare(10, inactive);
      samples.push({ mode: "inactive-" + mode, center: sample(160, 90) });
    }
    const chain = structuredClone(p),
      cut = newClip(track.id, 0, 60, "shape");
    cut.id = "chain-cut";
    cut.shape = {
      type: "rectangle",
      color: "#ffffff",
      width: 160,
      height: 180,
    };
    cut.transform.x = -80;
    chain.clips.push(cut);
    chain.clips[0].matte.mode = "alpha";
    chain.clips[1].matte = { layerId: cut.id, mode: "alpha" };
    await compare(0, chain);
    samples.push({
      mode: "chain",
      left: sample(130, 90),
      right: sample(190, 90),
    });
    target.matte.mode = "alpha";
    source.transform.opacity = 1;
    source.masks = [newMask("ellipse")];
    source.masks[0].feather = 3;
    source.keyframes.x = [
      { frame: 0, value: -45, easing: "ease-in-out" },
      { frame: 59, value: 45, easing: "linear" },
    ];
    const nested = newProject("Nested matte", 320, 180),
      n = newClip(nested.tracks[0].id, 0, 60, "composition");
    n.compositionId = "matte-comp";
    n.masks = [newMask("rectangle")];
    n.masks[0].feather = 2;
    n.transform.rotation = 12;
    n.blendMode = "screen";
    nested.compositions = [
      {
        id: "matte-comp",
        name: p.name,
        settings: p.settings,
        duration: 60,
        background: "transparent",
        tracks: p.tracks,
        layers: p.clips,
      },
    ];
    const background = newClip(nested.tracks[0].id, 0, 60, "shape");
    background.shape = {
      type: "rectangle",
      color: "#1d3050",
      width: 320,
      height: 180,
    };
    nested.clips = [background, n];
    const frames: string[] = [],
      reopened = parseProject(JSON.parse(JSON.stringify(nested)));
    for (let frame = 0; frame < 60; frame++) {
      await gpu.render(nested, frame, false, 1, true);
      const png = a.toDataURL().split(",")[1];
      frames.push(png);
      await gpu.render(reopened, frame, false, 1, true);
      if (a.toDataURL().split(",")[1] !== png)
        throw new Error("Matte reopen changed pixels");
      if ([0, 30, 59].includes(frame)) {
        await cpu.render(nested, frame, false, 1, true);
        const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
          y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
        parity.push({
          frame,
          mode: "nested",
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
    const bytes = gpu.matteSurfaceBytes;
    await gpu.dispose();
    await cpu.dispose();
    return {
      p: nested,
      frames,
      parity,
      samples,
      bytes,
      disposedBytes: gpu.matteSurfaceBytes,
    };
  });
  const cases = Object.fromEntries(report.samples.map((s: any) => [s.mode, s]));
  expect(cases.alpha.center[0]).toBeCloseTo(100, 0);
  expect(cases.alpha.outside[0]).toBe(0);
  expect(cases["alpha-inverted"].outside[0]).toBe(200);
  expect(Math.abs(cases.luma.center[0] - 50)).toBeLessThanOrEqual(1);
  expect(Math.abs(cases["luma-inverted"].center[0] - 150)).toBeLessThanOrEqual(
    1,
  );
  expect(cases["inactive-alpha"].center[0]).toBe(0);
  expect(cases["inactive-alpha-inverted"].center[0]).toBe(200);
  expect(cases.chain.left[0]).toBe(100);
  expect(cases.chain.right[0]).toBe(0);
  for (const row of report.parity) {
    expect(row.backend, row.fallback).toContain("WebGL2");
    expect(row.mae, JSON.stringify(row)).toBeLessThan(2);
  }
  expect(report.disposedBytes).toBe(0);
  const dir = "test-results/compositing";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(dir + "/project.supp", JSON.stringify(report.p, null, 2));
  await fs.writeFile(
    dir + "/mattes.json",
    JSON.stringify(
      { samples: report.samples, parity: report.parity, bytes: report.bytes },
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
test("matte and blend UI commands undo, persist and export", async ({
  page,
}) => {
  await page.goto("/");
  const p = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts";
    const { newProject, newClip, newTrack } = await import(sm);
    const p = newProject("Matte UI", 320, 180),
      t = newTrack("video", 2),
      c = newClip(p.tracks[0].id, 0, 60, "shape"),
      m = newClip(t.id, 0, 60, "shape");
    c.id = "card";
    c.name = "Card";
    c.shape.width = 300;
    c.shape.height = 160;
    m.id = "matte";
    m.name = "Matte";
    m.shape = { type: "ellipse", color: "#ffffff", width: 150, height: 100 };
    p.tracks.push(t);
    p.clips = [c, m];
    return p;
  });
  await open(page, p);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Card", exact: true }).click();
  await page.getByLabel("Matte source", { exact: true }).selectOption("matte");
  await page
    .getByLabel("Matte mode", { exact: true })
    .selectOption("luma-inverted");
  await page
    .getByLabel("Layer blend mode", { exact: true })
    .selectOption("screen");
  let saved = await save(page);
  expect(saved.schemaVersion).toBe(6);
  expect(saved.clips[0].matte).toEqual({
    layerId: "matte",
    mode: "luma-inverted",
  });
  expect(saved.clips[0].blendMode).toBe("screen");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await save(page)).clips[0].blendMode).toBe("normal");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await open(page, saved);
  await page.getByRole("button", { name: "Card", exact: true }).click();
  expect((await save(page)).clips).toEqual(saved.clips);
  await page
    .getByRole("button", { name: "Select matte source", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Used as a matte by Card" }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Matte source", { exact: true })
      .locator('option[value="card"]'),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/matte-ui.png" });
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
  await fs.writeFile("test-results/matte-ui-export.png", png);
});
