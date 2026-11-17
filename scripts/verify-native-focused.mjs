// Drive the real Windows application through a focused reference recreation.
// Usage: node scripts/verify-native-focused.mjs PROJECT.supp OUT_DIR START_MS END_MS [REVIEW.txt]
//
// The executable in bin/ is launched as a user would launch it. Its WebView2 window is driven
// through the debugging port: every step below is a click or selection in the application's own
// interface, native file dialogs are answered through Windows UI Automation, analysis runs in
// the native host, and the MP4 is written by the application's Deliver exporter.
// PROJECT.supp is opened and saved in place; pass a copy.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { mediaEnvironment } from "./runtime.mjs";
const [projectArg, outArg, start, end, reviewFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!end) throw Error("Supply a project copy, an output directory and the reference in/out milliseconds.");
const project = path.resolve(projectArg),
  out = path.resolve(outArg),
  port = 9333;
fs.mkdirSync(out, { recursive: true });
const review = reviewFile ? fs.readFileSync(reviewFile, "utf8").trim() : "";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const exe = path.resolve("bin/supp-edit.exe");
const running = () => {
  try {
    return execFileSync("tasklist", ["/FI", "IMAGENAME eq supp-edit.exe", "/NH"], { encoding: "utf8" }).includes("supp-edit.exe");
  } catch {
    return false;
  }
};
const dialog = (file) =>
  log(
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("scripts/native-file-dialog.ps1"), "-Path", file], { encoding: "utf8" }).trim(),
  );
async function launch() {
  assert(!running(), "Close the running supp.edit before this verification.");
  const env = mediaEnvironment();
  env.SUPP_AI_MODELS ||= path.resolve("work/ai-models");
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=" + port;
  spawn(exe, [], { env, stdio: "ignore", detached: true, windowsHide: false }).unref();
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + port).catch(() => undefined);
  }
  assert(browser, "The application window did not become available.");
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", { name: "Open project", exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, "0-launched.png") });
  return { browser, page };
}
async function quit(browser, page) {
  // Close the window as the title-bar button would; the app exits when its last window closes.
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
  await browser.close().catch(() => {});
  for (let i = 0; i < 30 && running(); i++) await new Promise((r) => setTimeout(r, 500));
  assert(!running(), "The application did not exit.");
}
async function open(page) {
  const name = read(project).name;
  const done = page.getByRole("combobox", { name: "Active sequence" }).locator("option", { hasText: name }).first().waitFor({ state: "attached", timeout: 120000 });
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  dialog(project);
  await done;
}
const sequences = (page) => page.getByRole("combobox", { name: "Active sequence" }).locator("option").allTextContents();
const shot = (page, name) => page.screenshot({ path: path.join(out, name) });
const report = { project, interval: { startMs: Number(start), endMs: Number(end) }, executable: { path: exe, modified: fs.statSync(exe).mtime.toISOString(), bytes: fs.statSync(exe).size }, steps: [] };
const step = (name, detail) => {
  report.steps.push({ name, at: new Date().toISOString(), ...detail });
  log(name, detail ? JSON.stringify(detail) : "");
};

// ---- Session 1: recreate, preview, apply, undo, redo, save, exit
// --export-only resumes at Deliver in an application that already has the saved project open.
const exportOnly = process.argv.includes("--export-only");
let browser, page, applied, saved;
if (exportOnly) {
  Object.assign(report, read(path.join(out, "native-session.json")));
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
  page = browser.contexts()[0].pages()[0];
  saved = read(project);
} else {
({ browser, page } = await launch());
await open(page);
const assets = read(project).assets;
const before = await sequences(page);
step("Opened project in the Windows application", { sequences: before });
await page.getByRole("button", { name: "AI Studio", exact: true }).click();
const panel = page.getByRole("region", { name: "Recreate an edit" });
await panel.getByLabel("Output framing").selectOption("reference");
await panel.getByLabel("Reference video", { exact: true }).selectOption(assets[0].id);
for (const a of assets.slice(1).filter((a) => a.kind === "video")) await panel.getByLabel("Add raw video").selectOption(a.id);
const music = assets.find((a) => a.kind === "audio");
if (music) await panel.getByRole("combobox", { name: "Music", exact: true }).selectOption(music.id);
await panel.getByRole("combobox", { name: "Recreation mode", exact: true }).selectOption("Close Match");
await panel.getByLabel("Reference text", { exact: true }).selectOption("original");
await panel.getByLabel("Text layering").selectOption("reference");
await panel.getByText("Style controls", { exact: true }).click();
await panel.getByLabel("Reconstruct a focused title interval").check();
await panel.getByLabel("Reference in (seconds)").fill(String(Number(start) / 1000));
await panel.getByLabel("Reference out (seconds)").fill(String(Number(end) / 1000));
if (review) await panel.getByLabel(/Visually reviewed words/).fill(review);
await shot(page, "1-controls.png");
const began = Date.now();
await panel.getByRole("button", { name: "Recreate This Style" }).click();
const apply = panel.getByRole("button", { name: "Apply recreation" });
const failure = panel.getByRole("alert");
for (;;) {
  if (await apply.isVisible().catch(() => false)) break;
  if (await failure.isVisible().catch(() => false)) throw Error("Recreation failed: " + (await failure.textContent()));
  if (Date.now() - began > 45 * 60000) throw Error("Recreation did not finish in 45 minutes.");
  const status = await panel.getByRole("status").textContent().catch(() => "");
  if (status && Math.round((Date.now() - began) / 1000) % 30 < 2) log("  ", status.replace("Cancel", "").trim());
  await page.waitForTimeout(2000);
}
const summary = (await panel.locator("p").allTextContents()).filter((t) => /measured shots|editable text|excluded|withheld|isolated|cropped|Lettering/.test(t));
step("Preview ready", { seconds: Math.round((Date.now() - began) / 1000), summary });
await apply.scrollIntoViewIfNeeded();
await shot(page, "2-preview.png");
// Scrub the preview to a title frame before applying.
const scrub = panel.getByLabel("Revision preview frame");
if (await scrub.count()) {
  await scrub.fill("40");
  await page.waitForTimeout(1500);
  await scrub.scrollIntoViewIfNeeded();
  await shot(page, "3-preview-frame-40.png");
}
await apply.click();
await page.waitForTimeout(1000);
applied = await sequences(page);
assert.equal(applied.length, before.length + 1, "Apply did not add the recreated sequence");
await page.getByRole("button", { name: "Undo", exact: true }).click();
await page.waitForTimeout(500);
const undone = await sequences(page);
assert.deepEqual(undone, before, "Undo did not remove the recreated sequence");
await page.getByRole("button", { name: "Redo", exact: true }).click();
await page.waitForTimeout(500);
const redone = await sequences(page);
assert.deepEqual(redone, applied, "Redo did not restore the recreated sequence");
step("Apply, Undo and Redo", { applied, undone, redone });
await page.getByRole("button", { name: "Save project", exact: true }).click();
// Saving is in place for an opened project; wait for the file to change on disk.
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(500);
  try {
    if (read(project).compositions.length === applied.length - 1) break;
  } catch {}
}
saved = read(project);
assert.equal(saved.compositions.length, applied.length - 1, "Saved project lacks the recreated sequence");
fs.copyFileSync(project, path.join(out, "before-close.supp"));
step("Saved", { compositions: saved.compositions.map((c) => c.name) });
await quit(browser, page);
step("Application exited");

// ---- Session 2: reopen, compare, resave, export through Deliver
({ browser, page } = await launch());
await open(page);
const reopened = await sequences(page);
assert.deepEqual(reopened, applied, "Reopened project lists different sequences");
{
const target = saved.compositions.at(-1);
await page.getByRole("combobox", { name: "Active sequence" }).selectOption(target.id);
await page.waitForTimeout(1500);
await shot(page, "4-reopened-timeline.png");
await page.getByRole("button", { name: "Save project", exact: true }).click();
await page.waitForTimeout(4000);
const resaved = read(project);
assert.deepEqual(resaved.compositions, saved.compositions, "Compositions changed across exit and reopen");
assert.deepEqual(resaved.assets, saved.assets, "Assets changed across exit and reopen");
step("Reopened and resaved identically", { layers: target.layers.length, texts: target.layers.filter((l) => l.kind === "text").length });
}
fs.writeFileSync(path.join(out, "native-session.json"), JSON.stringify(report, null, 2));
}
const target = saved.compositions.at(-1);
await page.locator(".workspace-tabs").getByRole("button", { name: "Export", exact: true }).click();
const movie = path.join(out, "render.mp4");
fs.rmSync(movie, { force: true });
const render = page.getByRole("button", { name: /Export MP4|Rendering/ });
await render.click();
dialog(movie);
const exportBegan = Date.now();
await page.getByRole("button", { name: /Rendering/ }).waitFor({ timeout: 30000 }).catch(() => {});
await shot(page, "5-deliver-rendering.png");
await page.getByRole("button", { name: "Export MP4" }).waitFor({ timeout: 60 * 60000 });
assert(fs.existsSync(movie), "Deliver did not write the MP4");
await shot(page, "6-deliver-done.png");
step("Exported through Deliver", { movie, seconds: Math.round((Date.now() - exportBegan) / 1000), bytes: fs.statSync(movie).size });
await quit(browser, page);
report.composition = { name: target.name, settings: target.settings, duration: target.duration, layers: target.layers.map((l) => ({ kind: l.kind, name: l.name, start: l.start, duration: l.duration, blend: l.blendMode, text: l.text && { content: l.text.content, font: l.text.font, weight: l.text.weight, size: l.text.size, color: l.text.color } })) };
fs.writeFileSync(path.join(out, "native-verification.json"), JSON.stringify(report, null, 2));
log("Native verification complete:", path.join(out, "native-verification.json"));
