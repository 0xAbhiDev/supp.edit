import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
async function setup(page: Page) {
  await page.goto("/");
  await page
    .getByTestId("media-input")
    .setInputFiles(path.resolve("test-results/fixtures/footage.mp4"));
  await expect(page.getByLabel("Preview footage.mp4")).toBeVisible();
  const saved = await graph(page);
  const p = await page.evaluate(async (saved) => {
    const sm = "/packages/project-schema/index.ts";
    const { newProject, newClip } = await import(sm);
    const p = newProject("NLE validation", 320, 180);
    p.assets = saved.assets;
    p.clips = [0, 1, 2].map((i) => {
      const c = newClip(p.tracks[0].id, i * 30, 30, "media", p.assets[0]);
      c.id = `clip-${i}`;
      c.sourceIn = i * 30;
      return c;
    });
    return p;
  }, saved);
  await page
    .getByTestId("project-input")
    .setInputFiles({
      name: "setup.supp",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await expect(
    page.getByRole("button", { name: "Clip footage.mp4" }),
  ).toHaveCount(3);
  return p;
}
async function graph(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  return JSON.parse(await fs.readFile((await download.path())!, "utf8"));
}
async function exportFrames(page: Page, name: string) {
  const saved = await graph(page);
  const result = await page.evaluate(async (saved) => {
    const sm = "/packages/project-schema/index.ts",
      cm = "/packages/engine/compositor.ts";
    const { parseProject, duration } = await import(sm),
      { Compositor } = await import(cm);
    const p = parseProject(saved),
      canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true),
      frames = [];
    for (let f = 0; f < duration(p); f++) {
      await r.render(p, f, false, 1, true);
      frames.push(canvas.toDataURL("image/png").split(",")[1]);
    }
    await r.dispose();
    return { p, frames };
  }, saved);
  result.p.assets[0].path = path.resolve("test-results/fixtures/footage.mp4");
  const dir = path.resolve("test-results", `nle-${name}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "project.supp"), JSON.stringify(result.p));
  await Promise.all(
    result.frames.map((png: string, i: number) =>
      fs.writeFile(path.join(dir, `${i}.png`), Buffer.from(png, "base64")),
    ),
  );
  expect(result.frames[0]).not.toBe(result.frames.at(-1));
}
for (const tool of ["ripple", "roll", "slip", "slide"])
  test(`${tool} direct manipulation survives undo, save/reopen and frame export`, async ({
    page,
  }) => {
    const initial = await setup(page);
    await page.getByLabel("Timeline zoom").focus();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Snapping", exact: true }).click();
    await page.getByLabel("Timeline edit tool").selectOption(tool);
    const clip = page
      .getByRole("button", { name: "Clip footage.mp4" })
      .nth(tool === "slip" || tool === "slide" ? 1 : 0);
    const target =
      tool === "ripple" || tool === "roll" ? clip.getByLabel("Trim end") : clip;
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    const changed = await graph(page);
    expect(changed.clips).not.toEqual(initial.clips);
    if (tool === "ripple") {
      expect(changed.clips[0].duration).toBe(40);
      expect(changed.clips[1].start).toBe(40);
    }
    if (tool === "roll") {
      expect(changed.clips[0].duration).toBe(40);
      expect(changed.clips[1].sourceIn).toBe(40);
    }
    if (tool === "slip") expect(changed.clips[1].sourceIn).toBe(40);
    if (tool === "slide") {
      expect(changed.clips[1].start).toBe(40);
      expect(changed.clips[1].sourceIn).toBe(30);
    }
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await graph(page)).clips).toEqual(initial.clips);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await graph(page)).clips).toEqual(changed.clips);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Save project", exact: true }).click(),
    ]);
    const saved = await fs.readFile((await download.path())!);
    await page
      .getByTestId("project-input")
      .setInputFiles({
        name: "edited.supp",
        mimeType: "application/json",
        buffer: saved,
      });
    expect((await graph(page)).clips).toEqual(changed.clips);
    await exportFrames(page, tool);
  });
test("source In/Out, target, insert, overwrite and edit navigation alter real footage", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Preview footage.mp4").click();
  await page.getByLabel("Source In frame").fill("6");
  await page.getByLabel("Source Out frame").fill("18");
  await page.getByRole("button", { name: "Insert range", exact: true }).click();
  let p = await graph(page);
  expect(p.clips.at(-1)).toMatchObject({ start: 0, duration: 12, sourceIn: 6 });
  expect(p.clips[0].start).toBe(12);
  await page.getByRole("button", { name: "Next edit", exact: true }).click();
  await page.getByLabel("Preview footage.mp4").click();
  await page.getByLabel("Source In frame").fill("30");
  await page.getByLabel("Source Out frame").fill("42");
  await page
    .getByRole("button", { name: "Overwrite range", exact: true })
    .click();
  p = await graph(page);
  expect(p.clips.at(-1)).toMatchObject({
    start: 12,
    duration: 12,
    sourceIn: 30,
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await graph(page)).clips.at(-1).sourceIn).toBe(6);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByRole("button", { name: "Previous edit", exact: true })
    .click();
  await expect(page.locator(".transport .timecode").first()).toHaveText(
    "00:00:00:00",
  );
  await exportFrames(page, "source");
});
