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
      name: "layers.supp",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
}
test("layer rows trim, drag, lock, reorder, split, duplicate, undo and reopen", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const p = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts";
    const { newProject, newClip, newTrack } = await import(sm);
    const p = newProject("Layer timing", 320, 180),
      t = newTrack("video", 2);
    p.tracks.unshift(t);
    const c = newClip(t.id, 15, 60, "shape");
    c.id = "child";
    c.name = "Card";
    c.keyframes.x = [
      { frame: 0, value: 0, easing: "linear" },
      { frame: 40, value: 25, easing: "linear" },
    ];
    const n = newClip(p.tracks[1].id, 0, 90, "null");
    n.id = "controller";
    n.name = "Controller";
    c.parentId = n.id;
    p.clips = [c, n];
    return p;
  });
  await open(page, p);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("Select layer Card", { exact: true }).click();
  await page.getByLabel("Out frame for Card", { exact: true }).fill("65");
  await page.getByLabel("Out frame for Card", { exact: true }).press("Enter");
  await page.getByLabel("In frame for Card", { exact: true }).fill("20");
  await page.getByLabel("In frame for Card", { exact: true }).press("Enter");
  let saved = await save(page);
  expect(saved.clips[0].start).toBe(20);
  expect(saved.clips[0].duration).toBe(45);
  expect(saved.clips[0].sourceIn).toBe(5);
  await page.getByLabel("Snap layer edits", { exact: true }).click();
  const box = await page
    .getByLabel("Move layer Card", { exact: true })
    .boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 20, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + 60, box!.y + 10, { steps: 5 });
  await page.mouse.up();
  saved = await save(page);
  expect(saved.clips[0].start).toBe(40);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await save(page)).clips[0].start).toBe(20);
  await page
    .getByLabel("Lock track Video 2 (1 layers)", { exact: true })
    .click();
  await expect(
    page.getByLabel("In frame for Card", { exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Unlock track Video 2 (1 layers)", { exact: true })
    .click();
  await page.getByLabel("Lower layer", { exact: true }).click();
  saved = await save(page);
  expect(saved.tracks.filter((t: any) => t.kind === "video")[1].id).toBe(
    saved.clips[0].trackId,
  );
  await page.getByLabel("Duplicate layer", { exact: true }).click();
  saved = await save(page);
  expect(saved.clips).toHaveLength(3);
  expect(saved.clips[2].parentId).toBe("controller");
  await page.getByLabel("Layer playhead", { exact: true }).fill("40");
  await page.getByLabel("Split layer at playhead", { exact: true }).click();
  saved = await save(page);
  expect(saved.clips).toHaveLength(4);
  await open(page, saved);
  expect((await save(page)).clips).toEqual(saved.clips);
  await page.screenshot({ path: "test-results/layer-timeline.png" });
  await page.getByLabel("Select layer Card", { exact: true }).click();
  await page.getByRole("button", { name: "Edit graph", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Animation editor" }),
  ).toBeVisible();
});
test("layer timeline mounts a bounded viewport from a thousand layers", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const p = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts";
    const { newProject, newClip } = await import(sm);
    const p = newProject("Many layers", 320, 180);
    for (let i = 0; i < 1000; i++) {
      const c = newClip(p.tracks[0].id, 0, 90, "null");
      c.name = `Control ${i}`;
      p.clips.push(c);
    }
    return p;
  });
  await open(page, p);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  expect(await page.locator(".layer-row").count()).toBeLessThan(25);
  await page.locator(".layer-scroll").evaluate((el) => {
    el.scrollTop = 900 * 46;
  });
  await expect(
    page.getByLabel("Select layer Control 99", { exact: true }),
  ).toBeVisible();
  expect(await page.locator(".layer-row").count()).toBeLessThan(25);
});
