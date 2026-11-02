import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("real detector evidence becomes editable portrait keys, reopens with an editable manual framing change", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const capture = JSON.parse(
    await fs.readFile("tests/fixtures/gym-subjects.json", "utf8"),
  );
  const original = capture.project.compositions.find(
    (c: any) => c.id === capture.sequenceId,
  );
  original.settings = { ...original.settings, width: 1920, height: 1080 };
  await fs.mkdir("test-results/reframe-ui", { recursive: true });
  await page.goto("/");
  for (const asset of capture.project.assets) {
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
                : asset.path.endsWith("webm")
                  ? "video/webm"
                  : "video/mp4",
          }),
        );
      },
      { asset, bytes },
    );
  }
  await page.evaluate(async (capture) => {
    const em = "/packages/editor-state/index.ts",
      sm = "/packages/project-schema/index.ts",
      dm = "/packages/platform/derived.ts",
      rm = "/packages/ai/reframe/service.ts";
    const { useEditor } = await import(em),
      { parseProject } = await import(sm),
      { writeDerived } = await import(dm),
      { subjectCacheKey } = await import(rm);
    for (const { data } of capture.results) {
      const asset = capture.project.assets.find(
        (a: any) => a.id === data.assetId,
      );
      await writeDerived(
        subjectCacheKey(asset, data.sampling),
        data,
        JSON.stringify(data).length * 2,
      );
    }
    useEditor.getState().load(parseProject(capture.project));
    useEditor.getState().setComposition(capture.sequenceId);
  }, capture);
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  await page
    .getByLabel("Describe your edit")
    .fill("Make this vertical and keep me centered.");
  await expect(page.getByLabel("Reframe camera motion")).toHaveValue("smooth");
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  const review = page.getByRole("region", { name: "AI reframe plan" });
  await expect(review).toBeVisible({ timeout: 30000 });
  await review
    .getByRole("button", { name: "Preview revision", exact: true })
    .click();
  await expect
    .poll(() => review.getByLabel("Revision preview frame").inputValue())
    .not.toBe("0");
  await review
    .getByRole("button", { name: "Pause revision preview", exact: true })
    .click();
  await review
    .getByRole("button", { name: "Apply framing", exact: true })
    .click();
  const get = () =>
    page.evaluate(async () => {
      const path = "/packages/editor-state/index.ts";
      return (await import(path)).useEditor.getState().project;
    });
  const applied = await get(),
    sequence = applied.compositions.at(-1)!;
  expect(sequence.settings).toMatchObject({ width: 1080, height: 1920 });
  expect(sequence.duration).toBe(600);
  expect(
    applied.compositions.find((c: any) => c.id === capture.sequenceId),
  ).toEqual(original);
  expect(
    sequence.layers.filter((c: any) => c.keyframes.scale.length),
  ).toHaveLength(7);
  await review
    .getByRole("button", { name: "Undo framing", exact: true })
    .click();
  expect((await get()).compositions).toHaveLength(2);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await get()).toEqual(applied);
  await page.getByLabel("Active sequence").selectOption(sequence.id);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("button", { name: "Clip deadlift.webm", exact: true })
    .first()
    .click();
  const x = page.getByLabel("Position X", { exact: true });
  const changedX = sequence.layers[0].keyframes.x[0].value + 60;
  await x.fill(String(changedX));
  await x.press("Tab");
  const edited = await get();
  expect(edited.compositions.at(-1)!.layers[0].keyframes.x[0].value).toBe(
    changedX,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await get()).compositions).toEqual(applied.compositions);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await get()).compositions).toEqual(edited.compositions);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!, "utf8");
  await fs.writeFile("test-results/reframe-ui/REFRAMED.supp", saved);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened.getByTestId("project-input").setInputFiles({
    name: "REFRAMED.supp",
    mimeType: "application/json",
    buffer: Buffer.from(saved),
  });
  await reopened.getByLabel("Active sequence").selectOption(sequence.id);
  expect(
    await reopened.evaluate(async () => {
      const path = "/packages/editor-state/index.ts";
      return (await import(path)).useEditor.getState().project.compositions;
    }),
  ).toEqual(edited.compositions);
  await reopened.screenshot({ path: "test-results/reframe-ui/reopened.png" });
});
