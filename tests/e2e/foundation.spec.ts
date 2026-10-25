import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
test("1080p ten-layer composition profile and surface cleanup", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page
    .getByTestId("media-input")
    .setInputFiles(path.resolve("work/acceptance/footage.mp4"));
  await expect(page.getByLabel("Preview footage.mp4")).toBeVisible();
  const saved = await save(page);
  const report = await page.evaluate(async (saved) => {
    const sm = "/packages/project-schema/index.ts",
      rm = "/packages/engine/compositor.ts";
    const { newProject, newTrack, newClip } = await import(sm),
      { Compositor } = await import(rm);
    const p = newProject("1080p composition foundation profile");
    p.assets = saved.assets;
    p.clips = [newClip(p.tracks[0].id, 0, 90, "media", p.assets[0])];
    for (let i = 0; i < 9; i++) {
      const t = newTrack("video", i + 3);
      p.tracks.unshift(t);
      const c = newClip(t.id, 0, 90, i === 8 ? "text" : "shape");
      c.text.content = "COMPOSITION / PROFILE";
      c.text.size = 48;
      c.shape.width = 190;
      c.shape.height = 100;
      c.shape.color = i % 2 ? "#b0a9ed" : "#c3f96b";
      c.transform.x = ((i % 3) - 1) * 380;
      c.transform.y = (Math.floor(i / 3) - 1) * 210;
      c.transform.opacity = 0.65;
      c.effects.blur = i % 3 === 0 ? 2 : 0;
      c.effects.saturation = 0.7;
      c.mask =
        i % 2
          ? { type: "ellipse", x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
          : null;
      c.keyframes.rotation = [
        { frame: 0, value: -12, easing: "bezier" },
        { frame: 89, value: 12, easing: "linear" },
      ];
      p.clips.push(c);
    }
    const title = p.clips.pop(),
      track = newTrack("video", 20);
    p.compositions = [
      {
        id: "profile-comp",
        name: "Profile title",
        duration: 90,
        settings: p.settings,
        background: "transparent",
        tracks: [track],
        layers: [{ ...title, trackId: track.id }],
      },
    ];
    const instance = newClip(title.trackId, 0, 90, "composition");
    instance.compositionId = "profile-comp";
    p.clips.push(instance);
    const canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true),
      times = [];
    for (let f = 0; f < 15; f++) {
      const start = performance.now();
      await r.render(p, f, false, 1, false);
      times.push(performance.now() - start);
    }
    const surfaces = r.compositionSurfaceBytes,
      textureBytes = r.textureBytes,
      frameCacheBytes = r.pool.frames.bytes,
      device = r.device,
      backend = r.backend;
    await r.render(newProject("empty"), 0);
    const afterEmpty = r.compositionSurfaceBytes;
    await r.dispose();
    return {
      p,
      times,
      surfaces,
      textureBytes,
      frameCacheBytes,
      device,
      backend,
      afterEmpty,
    };
  }, saved);
  expect(report.afterEmpty).toBe(0);
  expect(report.surfaces).toBeLessThanOrEqual(256 * 1024 * 1024);
  expect(report.textureBytes).toBeLessThan(416 * 1024 * 1024);
  await open(page, report.p);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const playback = await page.locator(".monitor-label").innerText();
  await fs.writeFile(
    "test-results/composition-profile.json",
    JSON.stringify(
      {
        ...report,
        p: undefined,
        playback,
        meanRenderMs:
          report.times.reduce((a, b) => a + b, 0) / report.times.length,
      },
      null,
      2,
    ),
  );
});
async function save(page: Page) {
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  return JSON.parse(await fs.readFile((await d.path())!, "utf8"));
}
async function open(page: Page, p: unknown) {
  await page.getByTestId("project-input").setInputFiles({
    name: "foundation.supp",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
}

test("AI caption preview applies actual text, undoes, rejects stale results and reopens", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  await page
    .getByLabel("SRT transcript", { exact: true })
    .fill(
      "1\n00:00:00,000 --> 00:00:01,000\nHello from SRT\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond caption",
    );
  await page
    .getByRole("button", { name: "Preview captions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply captions", exact: true }),
  ).toBeEnabled();
  expect((await save(page)).clips).toHaveLength(0);
  await page
    .getByRole("button", { name: "Apply captions", exact: true })
    .click();
  let p = await save(page);
  expect(p.clips.map((c: { kind: string }) => c.kind)).toEqual([
    "text",
    "text",
  ]);
  expect(p.transcripts[0].segments[0].text).toBe("Hello from SRT");
  await page
    .getByRole("button", { name: "Undo last project edit", exact: true })
    .click();
  expect((await save(page)).clips).toHaveLength(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  p = await save(page);
  await page.screenshot({ path: "test-results/ai-studio.png" });
  await page
    .getByRole("button", { name: "Preview captions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply captions", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Undo last project edit", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply captions", exact: true }),
  ).toBeDisabled();
  await open(page, p);
  expect((await save(page)).transcripts).toEqual(p.transcripts);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect
    .poll(() =>
      page.getByLabel("Program monitor").evaluate((c: HTMLCanvasElement) => {
        const bytes = c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height).data;
        return bytes.some((v, i) => i % 4 !== 3 && v > 0);
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  await page.getByLabel("AI command").fill("remove background");
  await page
    .getByLabel("SRT transcript", { exact: true })
    .fill("1\n00:00:00,000 --> 00:00:01,000\nCaption");
  await page
    .getByRole("button", { name: "Preview captions", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("no installed backend");
  expect(errors).toEqual([]);
});

test("precompose UI edits child animation, returns to main, undoes and saves", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByLabel("New composition name").fill("Nested title");
  await page
    .getByRole("button", { name: "Precompose selection", exact: true })
    .click();
  let p = await save(page);
  expect(p.compositions).toHaveLength(1);
  expect(p.clips[0].kind).toBe("composition");
  await page
    .getByRole("button", { name: "Open composition", exact: true })
    .click();
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByLabel("Position X", { exact: true }).fill("65");
  await page
    .getByRole("button", { name: "Enable animation", exact: true })
    .click();
  await page.getByLabel("Animation playhead").fill("30");
  await page.getByLabel("Position X", { exact: true }).fill("180");
  p = await save(page);
  expect(p.compositions[0].layers[0].keyframes.x).toHaveLength(2);
  await page.getByLabel("Active composition").selectOption("");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  let undone = await save(page);
  expect(undone.compositions[0].layers[0].keyframes.x).toHaveLength(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await open(page, p);
  expect((await save(page)).compositions).toEqual(p.compositions);
  await page.screenshot({ path: "test-results/compositions.png" });
});

test("nested real footage and transparency render on GPU/CPU and repeat after reopen", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  const video = path.resolve("work/acceptance/footage.mp4");
  await page.getByTestId("media-input").setInputFiles(video);
  await expect(page.getByLabel("Preview footage.mp4")).toBeVisible();
  const saved = await save(page);
  const result = await page.evaluate(async (saved) => {
    const sm = "/packages/project-schema/index.ts",
      cm = "/packages/commands/compositions.ts",
      hm = "/packages/commands/index.ts",
      rm = "/packages/engine/compositor.ts";
    const { newProject, newClip, newTrack, parseProject } = await import(sm),
      { precompose, inComposition } = await import(cm),
      { History } = await import(hm),
      { Compositor } = await import(rm);
    let p = newProject("Composition foundation", 320, 180);
    p.assets = saved.assets;
    const video = newClip(p.tracks[0].id, 0, 60, "media", p.assets[0]);
    p.clips = [video];
    const t = newTrack("video", 3);
    p.tracks.unshift(t);
    const shape = newClip(t.id, 0, 60, "shape");
    shape.shape = { type: "ellipse", width: 80, height: 48, color: "#c3f96b" };
    shape.transform.y = 40;
    shape.transform.opacity = 0.65;
    shape.keyframes.x = [
      { frame: 0, value: -45, easing: "bezier", outHandle: { x: 0.6, y: 0 } },
      { frame: 59, value: 45, easing: "linear", inHandle: { x: 0.2, y: 0 } },
    ];
    p.clips.push(shape);
    const h = new History(p);
    p = h.execute(
      p,
      "Precompose",
      inComposition(null, precompose([shape.id], "Nested title", "title-comp")),
    );
    p = h.execute(
      p,
      "Deeper precomp",
      inComposition(
        "title-comp",
        precompose([shape.id], "Animated shape", "shape-comp"),
      ),
    );
    p = structuredClone(p);
    const captionTrack = newTrack("video", 5);
    p.tracks.unshift(captionTrack);
    const text = newClip(captionTrack.id, 0, 60, "text");
    text.text.content = "NESTED / 01";
    text.text.size = 18;
    text.transform.y = -55;
    p.clips.push(text);
    p = parseProject(p);
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" }),
      frames: string[] = [],
      reports = [];
    for (let frame = 0; frame < 60; frame++) {
      await gpu.render(p, frame, false, 1, true);
      frames.push(a.toDataURL().split(",")[1]);
      if ([0, 30, 59].includes(frame)) {
        await cpu.render(p, frame, false, 1, true);
        const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
          y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
        let error = 0;
        for (let i = 0; i < x.length; i++) error += Math.abs(x[i] - y[i]);
        reports.push({
          frame,
          mae: error / x.length,
          backend: gpu.backend,
          reason: gpu.fallback,
        });
      }
    }
    const bytes = gpu.textureBytes;
    await gpu.dispose();
    await cpu.dispose();
    return { p, frames, reports, bytes };
  }, saved);
  for (const row of result.reports) {
    expect(row.backend, row.reason).toContain("WebGL2");
    expect(row.mae).toBeLessThan(4);
  }
  expect(result.frames[0]).not.toBe(result.frames[59]);
  await open(page, result.p);
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
      frames.push(canvas.toDataURL().split(",")[1]);
    }
    await r.dispose();
    return frames;
  }, reopened);
  expect(again).toEqual(result.frames);
  const dir = path.resolve("test-results/compositions");
  await fs.mkdir(dir, { recursive: true });
  const native = structuredClone(reopened);
  native.assets[0].path = video;
  await fs.writeFile(
    path.join(dir, "project.supp"),
    JSON.stringify(native, null, 2),
  );
  await fs.writeFile(
    path.join(dir, "parity.json"),
    JSON.stringify(result.reports, null, 2),
  );
  await Promise.all(
    result.frames.map((frame, i) =>
      fs.writeFile(path.join(dir, `${i}.png`), Buffer.from(frame, "base64")),
    ),
  );
});
