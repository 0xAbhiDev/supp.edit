import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import capture from "../fixtures/gym-analysis.json" with { type: "json" };
async function state(page: Page) {
  return page.evaluate(async () => {
    const path = "/packages/editor-state/index.ts";
    return (await import(path)).useEditor.getState().project;
  });
}
async function seed(page: Page, negative = false) {
  const assets = capture.assets.filter(
    (a) => !negative || a.id === "non-gym-flower" || a.kind === "audio",
  );
  for (const asset of assets) {
    const bytes = (await fs.readFile(asset.path)).toString("base64");
    await page.evaluate(
      async ({ asset, bytes }) => {
        const path = "/packages/platform/storage.ts";
        const { writeLocal } = await import(path);
        await writeLocal(
          "media",
          `${asset.id}:${asset.fingerprint}`,
          new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
            type:
              asset.kind === "audio"
                ? "audio/wav"
                : asset.path.endsWith(".webm")
                  ? "video/webm"
                  : "video/mp4",
          }),
        );
      },
      { asset, bytes },
    );
  }
  return page.evaluate(
    async ({ assets, analyses }) => {
      const sm = "/packages/project-schema/index.ts",
        em = "/packages/editor-state/index.ts",
        dm = "/packages/platform/derived.ts";
      const { newProject, newClip } = await import(sm),
        { useEditor } = await import(em),
        { writeDerived } = await import(dm);
      const p = newProject("Gym acceptance", 320, 180);
      p.assets = assets;
      p.clips = [newClip(p.tracks[0].id, 0, 90, "shape")];
      for (const a of analyses)
        await writeDerived(
          `analysis-v1:${a.assetId}:${a.fingerprint}:${a.settings.task}`,
          a,
          JSON.stringify(a).length * 2,
        );
      useEditor.getState().load(p);
      return p;
    },
    { assets, analyses: capture.analyses },
  );
}
test("real gym prompt creates an editable sequence with preview, atomic undo, reopen and export frames", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  await fs.mkdir("test-results/gym", { recursive: true });
  await page.goto("/");
  const original = await seed(page);
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  await page
    .getByLabel("Describe your edit")
    .fill("Pick my best gym lifts and sync cuts to the music.");
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Gym edit plan" });
  await expect(
    review.getByRole("heading", { name: "AI Gym Edit 01", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  expect((await state(page)).compositions).toHaveLength(0);
  const cards = review.locator(".moment-card");
  expect(await cards.count()).toBeGreaterThanOrEqual(5);
  await expect(review.getByLabel("Gym sequence preview")).toBeVisible();
  await review
    .getByRole("button", { name: "Play sequence preview", exact: true })
    .click();
  await expect
    .poll(() => review.getByLabel("Gym preview frame").inputValue())
    .not.toBe("0");
  await review
    .getByRole("button", { name: "Pause preview", exact: true })
    .click();
  await review.screenshot({ path: "test-results/gym/plan.png" });
  await review
    .getByRole("button", { name: "Apply AI edit", exact: true })
    .click();
  const applied = await state(page),
    sequence = applied.compositions[0];
  expect(sequence.name).toBe("AI Gym Edit 01");
  expect(sequence.layers.length).toBeGreaterThanOrEqual(6);
  expect(applied.clips).toEqual(original.clips);
  await review
    .getByRole("button", { name: "Undo AI edit", exact: true })
    .click();
  expect(await state(page)).toEqual(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await state(page)).toEqual(applied);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Active sequence").selectOption(sequence.id);
  await expect(page.locator(".timeline-clip")).toHaveCount(
    sequence.layers.length,
  );
  await page.screenshot({ path: "test-results/gym/timeline.png" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!, "utf8");
  await fs.writeFile("test-results/gym/GYM_EDIT.supp", saved);
  // Close the editor page, reopen from disk, and verify ranges/timing before rendering.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened
    .getByTestId("project-input")
    .setInputFiles({
      name: "GYM_EDIT.supp",
      mimeType: "application/json",
      buffer: Buffer.from(saved),
    });
  expect((await state(reopened)).compositions).toEqual(applied.compositions);
  await reopened.getByLabel("Active sequence").selectOption(sequence.id);
  await expect(reopened.locator(".timeline-clip")).toHaveCount(
    sequence.layers.length,
  );
  await reopened.exposeFunction(
    "saveGymFrame",
    async (frame: number, png: string) => {
      await fs.writeFile(
        `test-results/gym/${frame}.png`,
        Buffer.from(png.split(",")[1], "base64"),
      );
    },
  );
  const snapshot = await reopened.evaluate(async () => {
    const cm = "/packages/commands/sequences.ts",
      em = "/packages/editor-state/index.ts",
      rm = "/packages/engine/compositor.ts",
      sm = "/packages/project-schema/index.ts";
    const { useEditor } = await import(em),
      { sequenceExportSnapshot } = await import(cm),
      { Compositor } = await import(rm),
      { duration } = await import(sm);
    const s = useEditor.getState(),
      p = sequenceExportSnapshot(s.project, s.activeComposition),
      canvas = document.createElement("canvas"),
      renderer = new Compositor(canvas, true, { renderer: "cpu" });
    try {
      for (let frame = 0; frame < duration(p); frame++) {
        await renderer.render(p, frame, false, 1, true);
        await (window as any).saveGymFrame(
          frame,
          canvas.toDataURL("image/png"),
        );
      }
    } finally {
      await renderer.dispose();
    }
    return p;
  });
  await fs.writeFile("test-results/gym/project.supp", JSON.stringify(snapshot));
  await reopened
    .getByRole("button", { name: "AI Studio", exact: true })
    .click();
  await reopened
    .getByLabel("Describe your edit")
    .fill(
      "Create a 30-second cinematic gym Reel using my best lifts. Start with the strongest shot and sync important cuts to the music.",
    );
  await reopened
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(
    reopened.getByRole("heading", { name: "AI Gym Edit 02", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await reopened
    .getByRole("button", { name: "Apply AI edit", exact: true })
    .click();
  expect((await state(reopened)).compositions).toHaveLength(2);
  await seed(reopened, true);
  await reopened
    .getByLabel("Describe your edit")
    .fill("Pick my best gym lifts and sync cuts to the music.");
  await reopened
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(
    reopened
      .getByRole("alert")
      .filter({ hasText: "No sufficiently relevant gym/lifting footage" }),
  ).toBeVisible({ timeout: 45000 });
  expect((await state(reopened)).compositions).toHaveLength(0);
});
