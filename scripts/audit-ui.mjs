import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
page.setDefaultTimeout(4000);
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const button = (n) => page.getByRole("button", { name: n, exact: true });
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: "passed" });
  } catch (e) {
    results.push({ name, status: "failed", error: String(e).slice(0, 500) });
  }
  console.log(results.at(-1));
}
async function saved() {
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    button("Save project").click(),
  ]);
  return JSON.parse(await fs.readFile(await d.path(), "utf8"));
}
await page.goto("http://127.0.0.1:1420");
await check("Create project", async () => {
  await button("New project").click();
  await page.getByLabel("Project name", { exact: true }).fill("Control audit");
  await page.getByLabel("Project canvas").selectOption("1280x720");
  await button("Create project").click();
  assert.equal((await saved()).name, "Control audit");
});
await check("Title typography controls", async () => {
  await button("Title").click();
  await page.getByLabel("Title text").fill("Audit");
  await page.getByLabel("Font family").selectOption("monospace");
  await page.getByLabel("Font weight").selectOption("normal");
  await page.getByLabel("Text alignment").selectOption("right");
  await page.getByLabel("Text color", { exact: true }).fill("#00ccff");
  await page.getByLabel("Font size", { exact: true }).fill("64");
  assert.equal((await saved()).clips[0].text.size, 64);
});
await check("Shape controls and effects", async () => {
  await button("Shape").click();
  await page.getByLabel("Shape type").selectOption("ellipse");
  await page.getByLabel("Shape width", { exact: true }).fill("200");
  await page.getByLabel("Shape height", { exact: true }).fill("120");
  await page.getByLabel("Shape color", { exact: true }).fill("#ff0000");
  await page.getByLabel("Gaussian blur", { exact: true }).fill("2");
  for (const label of ["Brightness", "Contrast", "Saturation"])
    await page.getByLabel(label, { exact: true }).fill("1.3");
  const p = await saved();
  assert.equal(p.clips[1].effects.blur, 2);
  assert.equal(p.clips[1].shape.type, "ellipse");
});
await check("Track rename lock hide mute solo", async () => {
  await page.getByLabel("Rename Video 3").fill("Graphic");
  await button("Lock Graphic").click();
  assert.equal((await saved()).tracks[0].locked, true);
  await button("Unlock Graphic").click();
  await button("Hide Graphic").click();
  await button("Mute Graphic").click();
  await button("Solo Graphic").click();
  let t = (await saved()).tracks[0];
  assert.ok(t.hidden && t.muted && t.solo);
  await button("Show Graphic").click();
  await button("Unmute Graphic").click();
  await button("Solo Graphic").click();
});
await check("Track creation", async () => {
  await button("Video").click();
  await page
    .locator(".timeline-tools")
    .getByRole("button", { name: "Audio", exact: true })
    .click();
  assert.equal((await saved()).tracks.length, 6);
});
await check("Timeline zoom and snap", async () => {
  const old = await page.getByLabel("Timeline zoom").inputValue();
  await button("Zoom in timeline").click();
  assert.notEqual(await page.getByLabel("Timeline zoom").inputValue(), old);
  await button("Zoom out timeline").click();
  await button("Snapping").click();
  assert.equal(await button("Snapping").getAttribute("aria-pressed"), "false");
  await button("Snapping").click();
});
await check("Marker create seek remove", async () => {
  await button("Marker").click();
  assert.equal((await saved()).markers.length, 1);
  await page.locator(".marker").dblclick();
  assert.equal((await saved()).markers.length, 0);
});
await check("Safe areas and loop", async () => {
  await button("Safe margins").click();
  assert.equal(await page.locator(".safe-guides").count(), 1);
  await button("Loop playback").click();
  assert.equal(
    await button("Loop playback").getAttribute("aria-pressed"),
    "true",
  );
  await button("Safe margins").click();
  await button("Loop playback").click();
});
await check("Fullscreen enter and exit", async () => {
  await button("Fullscreen monitor").click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
});
await check("Workspaces", async () => {
  for (const w of ["Composite", "Color", "Audio", "Export", "Edit"])
    await page
      .locator(".workspace-tabs")
      .getByRole("button", { name: w, exact: true })
      .click();
});
await check("Preferences theme accent reset", async () => {
  await button("Preferences").click();
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await page.getByLabel("Accent color").fill("#aaccff");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("supp-theme")),
    "light",
  );
  await button("Reset panel layout").click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await button("Close Preferences & diagnostics").click();
});
await check("Library import search filter and views", async () => {
  await page
    .getByTestId("media-input")
    .setInputFiles(
      ["footage.mp4", "tone.wav", "still.png"].map((n) =>
        path.resolve("test-results/fixtures", n),
      ),
    );
  await page.getByLabel("Preview still.png").waitFor();
  await page.getByLabel("Search media").fill("tone");
  assert.equal(await page.locator(".asset").count(), 1);
  await page.getByLabel("Search media").fill("");
  await page.getByLabel("Filter media").selectOption("image");
  assert.equal(await page.locator(".asset").count(), 1);
  await page.getByLabel("Filter media").selectOption("all");
  await button("List view").click();
  assert.equal(await page.locator(".asset-items.list").count(), 1);
  await button("Grid view").click();
});
await check("Source monitor and insert", async () => {
  await button("Preview footage.mp4").click();
  assert.equal(
    await page.getByRole("dialog", { name: "Source monitor" }).count(),
    1,
  );
  await button("Close source monitor").click();
  await page
    .locator(".asset")
    .filter({ hasText: "footage.mp4" })
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  assert.equal((await saved()).clips.length, 3);
});
await check("Delete undo redo", async () => {
  await button("Delete selected clip").click();
  assert.equal((await saved()).clips.length, 2);
  await button("Undo").click();
  assert.equal((await saved()).clips.length, 3);
  await button("Redo").click();
  assert.equal((await saved()).clips.length, 2);
  await button("Undo").click();
});
await check("PNG export", async () => {
  await page
    .locator(".workspace-tabs")
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    button("Export current frame · PNG").click(),
  ]);
  const b = await fs.readFile(await d.path());
  assert.equal(b.subarray(1, 4).toString(), "PNG");
  assert.equal(b.readUInt32BE(16), 1280);
});
await check("Command palette search execute", async () => {
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search commands").fill("Save project");
  await page
    .getByRole("dialog", { name: "Command palette" })
    .getByRole("button", { name: /Save project/ })
    .click();
  assert.equal(
    await page.getByRole("dialog", { name: "Command palette" }).count(),
    0,
  );
});
await fs.writeFile(
  "test-results/control-audit.json",
  JSON.stringify({ results, pageErrors: errors }, null, 2),
);
await browser.close();

if (errors.length || results.some((result) => result.status === "failed"))
  process.exitCode = 1;
