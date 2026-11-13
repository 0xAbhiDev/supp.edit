import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const dir = path.resolve("test-results/reference-gym");
const json = async (name: string) =>
  JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
async function model(page: Page) {
  return page.evaluate(async () => {
    const module = "/packages/editor-state/index.ts";
    return (await import(module)).useEditor.getState().project;
  });
}
test("three editable recreations from independent footage with local captured analysis", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(90000);
  const input = await json("SOURCE.supp"),
    [reference, raw, music] = input.assets;
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 90000 });
  for (const a of input.assets) {
    await page.evaluate(
      async ({ a, data }) => {
        const module = "/packages/platform/storage.ts";
        await (
          await import(module)
        ).writeLocal(
          "media",
          a.id + ":" + a.fingerprint,
          new Blob([Uint8Array.from(atob(data), (x) => x.charCodeAt(0))], {
            type:
              a.kind === "audio"
                ? "audio/wav"
                : a.name.endsWith(".webm")
                  ? "video/webm"
                  : "video/mp4",
          }),
        );
      },
      { a, data: (await fs.readFile(a.path)).toString("base64") },
    );
  }
  const entries: [string, unknown][] = [];
  for (const file of [
    "0-vision",
    "0-audio",
    "1-vision",
    "1-audio",
    "2-audio",
  ]) {
    const r = await json(file + ".json");
    entries.push([
      ["analysis-v1", r.assetId, r.fingerprint, r.settings.task].join(":"),
      r,
    ]);
  }
  for (const c of await json("colors.json"))
    entries.push([
      [
        "color-samples-1",
        c.assetId,
        c.fingerprint,
        c.range.startMs,
        c.range.endMs,
      ].join(":"),
      c,
    ]);
  for (const [prefix, file] of [
    ["reference-blocks-v2", "motion.json"],
    ["reference-text-v3", "text.json"],
  ])
    entries.push([
      [prefix, reference.id, reference.fingerprint].join(":"),
      await json(file),
    ]);
  await page.evaluate(async (entries) => {
    const module = "/packages/platform/derived.ts";
    const { writeDerived } = await import(module);
    for (const [key, value] of entries)
      await writeDerived(key, value, JSON.stringify(value).length * 2);
  }, entries);
  await page
    .getByTestId("project-input")
    .setInputFiles(path.join(dir, "SOURCE.supp"));
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  const panel = page.getByRole("region", { name: "Recreate an edit" });
  await panel
    .getByLabel("Reference video", { exact: true })
    .selectOption(reference.id);
  await panel.getByLabel("Add raw video").selectOption(raw.id);
  await panel
    .getByRole("combobox", { name: "Music", exact: true })
    .selectOption(music.id);
  await panel
    .getByLabel("Optional instructions")
    .fill('Use the titles "BRACE", "SIT BACK", "DRIVE UP", "RESET".');
  const timelines = [];
  let count = 0;
  for (const mode of ["Close Match", "Smart Adaptation", "Creative Remix"]) {
    await panel
      .getByRole("combobox", { name: "Recreation mode", exact: true })
      .selectOption(mode);
    await panel
      .getByLabel("Reference text", { exact: true })
      .selectOption(mode === "Close Match" ? "original" : "adapt");
    await panel.getByRole("button", { name: "Recreate This Style" }).click();
    await expect(
      panel.getByRole("button", { name: "Apply recreation" }),
    ).toBeEnabled({ timeout: 45000 });
    expect((await model(page)).compositions).toHaveLength(count);
    await expect(panel.getByText(/4 measured shots/)).toBeVisible();
    const scrub = panel.getByLabel("Revision preview frame");
    await scrub.focus();
    await scrub.press("End");
    await expect(panel.locator(".sequence-preview figcaption")).toContainText(
      "proposed sequence",
    );
    await expect
      .poll(() =>
        panel
          .locator(".reference-compare video")
          .evaluate((v) => (v as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(11.8);
    await panel.getByRole("button", { name: "Apply recreation" }).click();
    const generated = (await model(page)).compositions.at(-1);
    expect(generated.ai.plannerVersion).toBe("reference-edit-1");
    const ranges = generated.layers.filter((c: any) => c.assetId === raw.id);
    expect(ranges).toHaveLength(4);
    expect(
      generated.layers
        .filter((c: any) => c.kind === "media")
        .every((c: any) => [raw.id, music.id].includes(c.assetId)),
    ).toBe(true);
    expect(generated.layers.filter((c: any) => c.kind === "text")).toHaveLength(
      4,
    );
    const titles = generated.layers.filter((c: any) => c.kind === "text");
    expect(titles.map((c: any) => c.text.content)).toEqual(
      mode === "Close Match"
        ? ["STAY FOCUSED", "BUILD STRENGTH", "ONE MORE REP", "EARN IT"]
        : ["BRACE", "SIT BACK", "DRIVE UP", "RESET"],
    );
    const detected = await json("text.json");
    for (const [i, c] of titles.entries()) {
      expect(c.text.color).toBe(detected[i].foreground);
      expect(c.text.emphasis[0]?.color).toBe(detected[i].accent);
    }
    expect(ranges.filter((c: any) => c.timeRemap)).toHaveLength(1);
    timelines.push(
      JSON.stringify(ranges.map((c: any) => [c.sourceIn, c.duration])),
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await model(page)).compositions).toHaveLength(count);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await model(page)).compositions.at(-1)).toEqual(generated);
    count++;
  }
  expect(new Set(timelines).size).toBe(3);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const output = path.join(dir, "Three-modes.supp");
  await download.saveAs(output);
  const previous = await model(page);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await reopened.getByTestId("project-input").setInputFiles(output);
  await expect
    .poll(async () => (await model(reopened)).compositions.length)
    .toBe(3);
  expect((await model(reopened)).compositions).toEqual(previous.compositions);
});
