import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
async function save(page: Page) {
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  return JSON.parse(await fs.readFile((await d.path())!, "utf8"));
}
async function open(page: Page, p: unknown) {
  await page.getByTestId("project-input").setInputFiles({
    name: "animation.supp",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
}
test("graph controls change motion, tangents, multiple keys, history and reopened data", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page
    .locator(".workspace-tabs")
    .getByRole("button", { name: "Composite", exact: true })
    .click();
  const graph = page.getByLabel("Animation editor");
  await graph
    .getByRole("button", { name: "Enable animation", exact: true })
    .click();
  await graph.getByLabel("Animation playhead").fill("60");
  await page.getByLabel("Position X", { exact: true }).fill("120");
  await graph.getByRole("button", { name: "Fit all", exact: true }).click();
  await page.getByLabel("Position X key 0", { exact: true }).click();
  await graph.getByLabel("Selected key interpolation").selectOption("bezier");
  const beforeCurve = await page.getByTestId("curve-x").getAttribute("d");
  const handle = await page
    .getByLabel("x 0 outHandle", { exact: true })
    .boundingBox();
  expect(handle).toBeTruthy();
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle!.x + 70, handle!.y - 25, { steps: 5 });
  await page.mouse.up();
  expect(await page.getByTestId("curve-x").getAttribute("d")).not.toBe(
    beforeCurve,
  );
  let p = await save(page);
  expect(p.clips[0].keyframes.x[0].outHandle).toBeTruthy();
  await page
    .getByLabel("Position X key 60", { exact: true })
    .click({ modifiers: ["Shift"] });
  await graph.getByRole("button", { name: "Copy", exact: true }).click();
  await graph.getByLabel("Animation playhead").fill("80");
  await graph.getByRole("button", { name: "Paste", exact: true }).click();
  p = await save(page);
  expect(p.clips[0].keyframes.x.map((k: { frame: number }) => k.frame)).toEqual(
    [0, 60, 80, 140],
  );
  await page.getByRole("button", { name: /^Undo/ }).click();
  p = await save(page);
  expect(p.clips[0].keyframes.x).toHaveLength(2);
  await page.getByRole("button", { name: /^Redo/ }).click();
  p = await save(page);
  expect(p.clips[0].keyframes.x).toHaveLength(4);
  await graph.getByLabel("Graph type").selectOption("speed");
  expect(await page.getByTestId("curve-x").getAttribute("d")).not.toBe(
    beforeCurve,
  );
  await graph.getByLabel("Graph type").selectOption("value");
  await graph.getByRole("button", { name: "Fit all", exact: true }).click();
  await page.getByLabel("Position X key 80", { exact: true }).click();
  await graph.getByLabel("Key frame", { exact: true }).fill("90");
  await graph.getByLabel("Key value", { exact: true }).fill("45");
  await graph.getByRole("button", { name: "Duplicate", exact: true }).click();
  await graph.getByRole("button", { name: "Delete keys", exact: true }).click();
  p = await save(page);
  expect(
    p.clips[0].keyframes.x.find((k: { frame: number }) => k.frame === 90).value,
  ).toBe(45);
  await page.getByLabel("Position X key 90", { exact: true }).click();
  const ka = await page
      .getByLabel("Position X key 90", { exact: true })
      .boundingBox(),
    kb = await page
      .getByLabel("Position X key 140", { exact: true })
      .boundingBox();
  await page.mouse.move(ka!.x + ka!.width / 2, ka!.y + ka!.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(
    ka!.x + ka!.width / 2 + (kb!.x - ka!.x) / 5,
    ka!.y + ka!.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(
    Number(await graph.getByLabel("Key frame", { exact: true }).inputValue()),
  ).toBe(100);
  await page.getByLabel("Keyframe graph", { exact: true }).press("Control+z");
  p = await save(page);
  expect(
    p.clips[0].keyframes.x.some((k: { frame: number }) => k.frame === 90),
  ).toBe(true);
  await open(page, p);
  await graph.getByLabel("Animated layer").selectOption(p.clips[0].id);
  await graph.getByRole("button", { name: "Fit all", exact: true }).click();
  await graph.getByLabel("Animation playhead").fill("30");
  await graph.getByLabel("Show Rotation curve").check();
  await page.screenshot({
    path: "test-results/animation-graph.png",
    fullPage: true,
  });
  const reopened = await save(page);
  expect(reopened.clips[0].keyframes).toEqual(p.clips[0].keyframes);
});

test("animated transforms crop and effects match GPU/CPU and real MP4 export frames repeat after reopening", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const videoPath = path.resolve(
    process.env.SUPP_TEST_VIDEO ||
      (existsSync("work/acceptance/footage.mp4")
        ? "work/acceptance/footage.mp4"
        : "test-results/fixtures/footage.mp4"),
  );
  await page.getByTestId("media-input").setInputFiles(videoPath);
  await expect(page.getByLabel("Preview footage.mp4")).toBeVisible();
  const saved = await save(page);
  const result = await page.evaluate(async (saved) => {
    const sm = "/packages/project-schema/index.ts",
      rm = "/packages/engine/compositor.ts";
    const { newProject, newClip, newTrack, parseProject } = await import(sm),
      { Compositor } = await import(rm);
    const p = newProject("Animation — flower study", 320, 180);
    p.assets = saved.assets;
    const v = newClip(p.tracks[0].id, 0, 60, "media", p.assets[0]);
    v.keyframes.scaleX = [
      {
        frame: 0,
        value: 0.85,
        easing: "bezier",
        outHandle: { x: 0.6, y: 0.02 },
      },
      {
        frame: 59,
        value: 1.1,
        easing: "linear",
        inHandle: { x: 0.2, y: -0.1 },
      },
    ];
    v.keyframes.scaleY = [
      { frame: 0, value: 0.9, easing: "ease-out" },
      { frame: 59, value: 1, easing: "linear" },
    ];
    v.keyframes.rotation = [
      { frame: 0, value: -4, easing: "auto-bezier" },
      { frame: 59, value: 4, easing: "linear" },
    ];
    v.keyframes.anchorX = [
      { frame: 0, value: -8, easing: "ease-in" },
      { frame: 59, value: 8, easing: "linear" },
    ];
    v.keyframes.cropLeft = [
      { frame: 0, value: 0, easing: "linear" },
      { frame: 59, value: 0.1, easing: "linear" },
    ];
    v.keyframes.blur = [
      { frame: 0, value: 0, easing: "linear" },
      { frame: 59, value: 2, easing: "linear" },
    ];
    v.keyframes.saturation = [
      { frame: 0, value: 0.5, easing: "ease-out" },
      { frame: 59, value: 1.3, easing: "linear" },
    ];
    v.keyframes.brightness = [
      { frame: 0, value: 0.8, easing: "ease-in" },
      { frame: 59, value: 1.1, easing: "linear" },
    ];
    v.mask = { type: "ellipse", x: 0.02, y: 0.02, width: 0.96, height: 0.96 };
    const track = newTrack("video", 2);
    p.tracks.unshift(track);
    const title = newClip(track.id, 0, 60, "text");
    title.name = "Flower study";
    title.text.content = "FLOWER / 01";
    title.text.size = 20;
    title.transform.y = 55;
    title.keyframes.x = [
      { frame: 0, value: -45, easing: "bezier", outHandle: { x: 0.6, y: 0 } },
      { frame: 59, value: 35, easing: "linear", inHandle: { x: 0.1, y: 0 } },
    ];
    title.keyframes.scale = [
      { frame: 0, value: 0.8, easing: "continuous-bezier" },
      { frame: 59, value: 1, easing: "linear" },
    ];
    p.clips = [v, title];
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" });
    const frames: string[] = [],
      reports: unknown[] = [];
    for (let f = 0; f < 60; f++) {
      await gpu.render(p, f, false, 1, true);
      frames.push(a.toDataURL("image/png").split(",")[1]);
      if ([0, 30, 59].includes(f)) {
        await cpu.render(p, f, false, 1, true);
        const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
          y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
        let error = 0;
        for (let i = 0; i < x.length; i += 4)
          for (let j = 0; j < 3; j++) error += Math.abs(x[i + j] - y[i + j]);
        reports.push({
          frame: f,
          mae: error / (320 * 180 * 3),
          backend: gpu.backend,
          reason: gpu.fallback,
        });
      }
    }
    await gpu.dispose();
    await cpu.dispose();
    return {
      p,
      frames,
      reports,
      reopened: parseProject(JSON.parse(JSON.stringify(p))),
    };
  }, saved);
  for (const report of result.reports as {
    frame: number;
    mae: number;
    backend: string;
    reason: string;
  }[]) {
    expect(report.backend, report.reason).toContain("WebGL2");
    expect(report.mae, JSON.stringify(report)).toBeLessThan(8);
  }
  await open(page, result.reopened);
  const reopened = await save(page);
  const again = await page.evaluate(async (p) => {
    const sm = "/packages/project-schema/index.ts",
      rm = "/packages/engine/compositor.ts";
    const { parseProject } = await import(sm),
      { Compositor } = await import(rm);
    const canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true),
      frames = [];
    for (let f = 0; f < 60; f++) {
      await r.render(parseProject(p), f, false, 1, true);
      frames.push(canvas.toDataURL("image/png").split(",")[1]);
    }
    await r.dispose();
    return frames;
  }, reopened);
  expect(again).toEqual(result.frames);
  expect(result.frames[0]).not.toBe(result.frames[59]);
  for (const [name, frames] of [
    ["animation", result.frames],
    ["animation-reopened", again],
  ] as const) {
    const dir = path.resolve("test-results", name);
    await fs.mkdir(dir, { recursive: true });
    const p = structuredClone(result.reopened);
    p.assets[0].path = videoPath;
    await fs.writeFile(
      path.join(dir, "project.supp"),
      JSON.stringify(p, null, 2),
    );
    await Promise.all(
      frames.map((f, i) =>
        fs.writeFile(path.join(dir, `${i}.png`), Buffer.from(f, "base64")),
      ),
    );
    await fs.writeFile(
      path.join(dir, "parity.json"),
      JSON.stringify(result.reports, null, 2),
    );
  }
});
