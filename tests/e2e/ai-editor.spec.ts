import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
async function save(page: Page) {
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  return JSON.parse(await fs.readFile((await d.path())!, "utf8"));
}
test("local agent plans real edits, previews without mutation, revises, undoes, persists and rejects unsupported requests", async ({
  page,
}) => {
  await page.goto("/");
  const p = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts";
    const { newProject, newClip } = await import(sm);
    const p = newProject("Agent acceptance", 320, 180),
      c = newClip(p.tracks[0].id, 0, 60, "shape");
    c.name = "Agent card";
    c.shape = { type: "rectangle", color: "#604080", width: 240, height: 130 };
    p.clips = [c];
    return p;
  });
  const open = async (p: unknown) =>
    page
      .getByTestId("project-input")
      .setInputFiles({
        name: "agent.supp",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(p)),
      });
  await open(p);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Agent card", exact: true }).click();
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  const box = page.getByRole("region", { name: "AI edit planner" });
  await page
    .getByLabel("Describe your edit", { exact: true })
    .fill("Set contrast to 1.5");
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(
    box.getByRole("button", { name: "Create edit", exact: true }),
  ).toBeEnabled();
  expect((await save(page)).clips[0].effectStack).toHaveLength(0);
  await expect(box.getByLabel("Proposed edit preview")).toBeVisible();
  await expect
    .poll(() =>
      box
        .getByLabel("Proposed edit preview")
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(160);
  await box.getByRole("button", { name: "Create edit", exact: true }).click();
  let saved = await save(page);
  expect(saved.clips[0].effectStack[0]).toMatchObject({
    type: "contrast",
    value: 1.5,
  });
  await page
    .getByLabel("Describe your edit", { exact: true })
    .fill("Set contrast to 1.8");
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(
    box.getByRole("button", { name: "Create edit", exact: true }),
  ).toBeEnabled();
  await box.getByRole("button", { name: "Create edit", exact: true }).click();
  saved = await save(page);
  expect(saved.clips[0].effectStack).toHaveLength(1);
  expect(saved.clips[0].effectStack[0].value).toBe(1.8);
  await box
    .getByRole("button", { name: "Undo last edit", exact: true })
    .click();
  expect((await save(page)).clips[0].effectStack[0].value).toBe(1.5);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByLabel("Describe your edit", { exact: true })
    .fill("Move selected clip to frame 15");
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(
    box.getByRole("button", { name: "Create edit", exact: true }),
  ).toBeEnabled();
  await box
    .getByRole("button", { name: "Undo last edit", exact: true })
    .click();
  await expect(
    box.getByRole("button", { name: "Create edit", exact: true }),
  ).toBeDisabled();
  await open(saved);
  await page.getByRole("button", { name: "Composite", exact: true }).click();
  await page.getByRole("button", { name: "Agent card", exact: true }).click();
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  expect((await save(page)).clips).toEqual(saved.clips);
  await page
    .getByLabel("Describe your edit", { exact: true })
    .fill("Pick my best gym lifts and sync cuts to music");
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(box.getByRole("alert")).toContainText("not installed");
  expect((await save(page)).clips).toEqual(saved.clips);
  await page.screenshot({ path: "test-results/ai-agent.png" });
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
  await fs.writeFile("test-results/ai-agent-export.png", png);
});
