import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
test("manual speed key survives reopen and rendered frames use the mapped source time", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const file = path.resolve("test-results/fixtures/footage.mp4");
  await page.getByTestId("media-input").setInputFiles(file);
  await expect(page.getByLabel("Preview footage.mp4")).toBeVisible();
  const id = await page.evaluate(async () => {
    const em = "/packages/editor-state/index.ts",
      sm = "/packages/project-schema/index.ts",
      cm = "/packages/commands/time-remap.ts";
    const { useEditor } = await import(em),
      { newClip } = await import(sm),
      { setTimeRemap } = await import(cm),
      s = useEditor.getState();
    let id = "";
    s.execute("Fixture clip", (p: any) => {
      p.settings.width = 320;
      p.settings.height = 180;
      const clip = newClip(p.tracks[0].id, 0, 60, "media", p.assets[0]);
      id = clip.id;
      p.clips = [clip];
    });
    s.execute(
      "Initial speed ramp",
      setTimeRemap(id, {
        sourceOffset: 0,
        keys: [
          { frame: 0, speed: 1.2, easing: "smooth" },
          { frame: 30, speed: 0.8, easing: "smooth" },
          { frame: 60, speed: 1.2, easing: "smooth" },
        ],
      }),
    );
    s.select(id);
    return id;
  });
  await page.getByLabel("Speed key 2", { exact: true }).fill("0.65");
  await page.getByLabel("Speed key 2", { exact: true }).press("Tab");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!, "utf8");
  expect(JSON.parse(saved).clips[0].timeRemap.keys[1].speed).toBe(0.65);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened
    .getByTestId("project-input")
    .setInputFiles({
      name: "SPEED.supp",
      mimeType: "application/json",
      buffer: Buffer.from(saved),
    });
  const result = await reopened.evaluate(
    async ({ id, file }) => {
      const em = "/packages/editor-state/index.ts",
        tm = "/packages/time-remap/model.ts",
        cm = "/packages/engine/compositor.ts";
      const { useEditor } = await import(em),
        { sourceFrameAt } = await import(tm),
        { Compositor } = await import(cm),
        p = useEditor.getState().project;
      const c = p.clips.find((c: any) => c.id === id);
      const canvas = document.createElement("canvas"),
        renderer = new Compositor(canvas, true, { renderer: "cpu" });
      const frames: string[] = [],
        checks: { frame: number; source: number; error: number }[] = [];
      const ordinary = structuredClone(p);
      delete ordinary.clips[0].timeRemap;
      ordinary.clips[0].duration = 90;
      for (let frame = 0; frame < 60; frame++) {
        const failure = await renderer.render(p, frame, false, 1, true);
        if (failure) throw failure;
        frames.push(canvas.toDataURL("image/png").split(",")[1]);
        if ([0, 15, 30, 45, 59].includes(frame)) {
          const before = canvas
            .getContext("2d")!
            .getImageData(0, 0, 320, 180).data;
          const source = sourceFrameAt(c, frame);
          await renderer.render(ordinary, source, false, 1, true);
          const after = canvas
            .getContext("2d")!
            .getImageData(0, 0, 320, 180).data;
          const error =
            before.reduce(
              (n: number, v: number, i: number) => n + Math.abs(v - after[i]),
              0,
            ) / before.length;
          checks.push({ frame, source, error });
        }
      }
      await renderer.dispose();
      const native = structuredClone(p);
      native.assets[0].path = file;
      return { project: native, frames, checks };
    },
    { id, file },
  );
  expect(result.project.clips[0].timeRemap.keys[1].speed).toBe(0.65);
  expect(result.checks.every((c) => c.error < 0.01)).toBe(true);
  expect(result.checks[1].source).not.toBe(15);
  const directory = path.resolve("test-results/speed-remap");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "project.supp"),
    JSON.stringify(result.project),
  );
  await fs.writeFile(
    path.join(directory, "source-checks.json"),
    JSON.stringify(result.checks, null, 2),
  );
  for (const [i, frame] of result.frames.entries())
    await fs.writeFile(
      path.join(directory, `${i}.png`),
      Buffer.from(frame, "base64"),
    );
});
