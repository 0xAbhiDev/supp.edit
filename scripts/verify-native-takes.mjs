// Alternative takes in the real Windows app: does each "Choose another take" name the shot it
// would repeat, measured on the timeline as it is now — after Apply, after choosing a take, after
// Undo and Redo, and after Save, Exit and Reopen (the saved takes panel)?
// Usage: node scripts/verify-native-takes.mjs PROJECT_COPY.supp OUT_DIR [--audio=recreate]
//
// Expected warnings are computed here independently from the saved project file (each shot's
// played source interval = sourceIn .. sourceIn + duration × constant speed; a take repeats a shot
// when they share ≥ 250 ms of the same asset or ≥ 30% of the shorter interval) and compared with
// what the app shows. PROJECT is opened and saved in place: pass a copy.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { mediaEnvironment } from "./runtime.mjs";
// The take choices this driver makes are tests, not a person's corrections: the corrections log
// (corrections.rs) is put back as it was when the driver exits.
const correctionsLog = path.join(process.env.APPDATA ?? "", "studio.supp.edit", "take-corrections.jsonl");
const correctionsBefore = fs.existsSync(correctionsLog) ? fs.readFileSync(correctionsLog) : null;
process.on("exit", () => {
  try {
    if (correctionsBefore) fs.writeFileSync(correctionsLog, correctionsBefore);
    else if (fs.existsSync(correctionsLog)) fs.unlinkSync(correctionsLog);
  } catch {}
});
const [projectArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const audioMode = process.argv.find((a) => a.startsWith("--audio="))?.slice(8);
const project = path.resolve(projectArg),
  out = path.resolve(outArg),
  port = 9333,
  exe = path.resolve("bin/supp-edit.exe");
fs.mkdirSync(out, { recursive: true });
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const report = { project, executable: { modified: fs.statSync(exe).mtime.toISOString(), bytes: fs.statSync(exe).size }, steps: [] };
const step = (name, detail) => {
  report.steps.push({ name, ...detail });
  log(name, JSON.stringify(detail ?? {}));
  fs.writeFileSync(path.join(out, "takes-verification.json"), JSON.stringify(report, null, 1));
};
const running = () => {
  try {
    return execFileSync("tasklist", ["/FI", "IMAGENAME eq supp-edit.exe", "/NH"], { encoding: "utf8" }).includes("supp-edit.exe");
  } catch {
    return false;
  }
};
const dialog = (file) => execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("scripts/native-file-dialog.ps1"), "-Path", file], { encoding: "utf8" }).trim();
async function launch() {
  assert(!running(), "Close the running supp.edit first.");
  const env = mediaEnvironment();
  env.SUPP_AI_MODELS ||= path.resolve("work/ai-models");
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=" + port;
  const child = spawn(exe, [], { env, stdio: "ignore", detached: true });
  fs.writeFileSync(path.join(out, "app.pid"), String(child.pid));
  child.unref();
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + port).catch(() => undefined);
  }
  assert(browser, "The application window did not become available.");
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", { name: "Open project", exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1000);
  return { browser, page };
}
async function open(page) {
  const name = read(project).name;
  const done = page.getByRole("combobox", { name: "Active sequence" }).locator("option", { hasText: name }).first().waitFor({ state: "attached", timeout: 120000 });
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  dialog(project);
  await done;
}
async function quit(browser, page) {
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
  await browser.close().catch(() => {});
  for (let i = 0; i < 30 && running(); i++) await new Promise((r) => setTimeout(r, 500));
  assert(!running(), "The application did not exit.");
}
async function save(page) {
  const before = fs.statSync(project).mtimeMs;
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  for (let i = 0; i < 60 && fs.statSync(project).mtimeMs === before; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(400);
  return read(project);
}
// ---- Independent expectation from the saved file.
function expected(file) {
  const comp = file.compositions.find((c) => c.ai?.takes?.length);
  const rate = (comp.settings?.fps ?? file.settings.fps).num / (comp.settings?.fps ?? file.settings.fps).den;
  const shotIds = comp.ai.takes.map((t) => t.clipId);
  const layers = comp.layers.filter((l) => shotIds.includes(l.id));
  const order = [...layers].sort((a, b) => a.start - b.start).map((l) => l.id);
  const played = new Map(
    layers.map((l) => {
      const speed = l.timeRemap?.keys?.length ? l.timeRemap.keys[0].speed : 1;
      return [l.id, { sourceId: l.assetId, inMs: (l.sourceIn * 1000) / rate, outMs: ((l.sourceIn + l.duration * speed) * 1000) / rate }];
    }),
  );
  const repeats = (clipId, take) =>
    [...played.entries()]
      .filter(([id, iv]) => id !== clipId && iv.sourceId === take.sourceId)
      .filter(([, iv]) => {
        const overlap = Math.min(iv.outMs, take.outMs) - Math.max(iv.inMs, take.inMs);
        return overlap > 0 && (overlap >= 250 || overlap / Math.max(1, Math.min(iv.outMs - iv.inMs, take.outMs - take.inMs)) >= 0.3);
      })
      .map(([id]) => order.indexOf(id) + 1)
      .sort((a, b) => a - b);
  return { comp, rate, played, repeats, shotIds, order };
}
const shotsOf = (text) => (text ? [...text.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n, i, all) => i < all.length - 1 || !/s of the same/.test(text)) : []);
/** The app's take rows: [{ label, warning }] in page order, from a container locator. */
async function shown(container) {
  const rows = container.locator(".re-alt");
  const n = await rows.count();
  const outRows = [];
  for (let k = 0; k < n; k++) {
    const row = rows.nth(k);
    const label = (await row.locator("button").first().textContent()).trim();
    // Read a warning only where one is shown (a locator waits for an absent element).
    const warning = (await row.locator("[role=note]").count()) ? await row.locator("[role=note]").first().textContent() : null;
    outRows.push({ label, warning });
  }
  return outRows;
}
const repeatedShots = (warning) => (warning ? warning.replace(/\(.*$/, "").match(/\d+/g).map(Number).sort((a, b) => a - b) : []);

// ---- Session 1
let { browser, page } = await launch();
await open(page);
const assets = read(project).assets;
await page.getByRole("button", { name: "AI Studio", exact: true }).click();
const panel = page.getByRole("region", { name: "Recreate an edit" });
await panel.getByLabel("Reference video", { exact: true }).selectOption(assets[0].id);
for (const a of assets.slice(1).filter((a) => a.kind === "video")) await panel.getByLabel("Add raw video").selectOption(a.id);
if (audioMode) {
  const music = assets.find((a) => a.kind === "audio");
  if (music) await panel.getByRole("combobox", { name: "Music", exact: true }).selectOption(music.id);
  await panel.getByLabel("Audio mode").selectOption(audioMode);
}
const began = Date.now();
await panel.getByRole("button", { name: "Recreate This Style" }).click();
const apply = panel.getByRole("button", { name: "Apply recreation" });
for (;;) {
  if (await apply.isVisible().catch(() => false)) break;
  if (await panel.getByRole("alert").isVisible().catch(() => false)) throw Error("Recreation failed: " + (await panel.getByRole("alert").textContent()));
  assert(Date.now() - began < 45 * 60000, "Recreation did not finish in 45 minutes.");
  await page.waitForTimeout(2000);
}
step("Preview ready", { seconds: Math.round((Date.now() - began) / 1000) });
await apply.click();
await page.waitForTimeout(1500);
const why = panel.locator("details", { has: page.getByText("Why each source moment was chosen", { exact: true }) });
// Open the table (clicking its summary would close it when it is already open).
await why.evaluate((d) => (d.open = true));
await page.waitForTimeout(500);
// The table's rows map to the saved takes in order (rows without alternatives have no buttons).
async function check(label) {
  const file = await save(page);
  const exp = expected(file);
  const rows = await why.locator("table tbody tr").all();
  const mismatches = [];
  let row = 0,
    warned = 0,
    total = 0;
  const takesByClip = new Map(exp.comp.ai.takes.map((t) => [t.clipId, t]));
  for (const tr of rows) {
    // Rows follow the shots in order, as the saved takes do (every shot is saved).
    const take = exp.comp.ai.takes[row++];
    const items = await shown(tr);
    if (!items.length || !take) continue;
    for (const it of items) {
      // Match the button to its saved alternative by source name and time.
      const m = it.label.match(/: (.+) @ ([\d.]+) s$/);
      const asset = file.assets.find((a) => a.name === m[1]);
      const alt = [take.original, ...take.alternatives].find((a) => a.sourceId === asset?.id && Math.abs(a.inMs / 1000 - Number(m[2])) < 0.006);
      if (!alt) continue;
      total++;
      const want = exp.repeats(take.clipId, alt);
      const got = repeatedShots(it.warning);
      if (got.length) warned++;
      if (JSON.stringify(want) !== JSON.stringify(got)) mismatches.push({ shot: exp.order.indexOf(take.clipId) + 1, take: it.label, expected: want, shown: got });
    }
  }
  void takesByClip;
  step(label, { takes: total, warned, mismatches });
  return { file, exp, total, warned, mismatches };
}
const initial = await check("Warnings after Apply match the timeline");
// Choose a take: one that repeats another shot when there is one (deliberate reuse), else any.
const buttons = why.locator(".re-alt");
let pick = null;
for (let k = 0; k < (await buttons.count()); k++) {
  const w = await buttons.nth(k).locator("[role=note]").count();
  if (w) {
    pick = buttons.nth(k);
    break;
  }
}
pick ??= buttons.first();
const pickLabel = (await pick.locator("button").textContent()).trim(),
  pickWarning = (await pick.locator("[role=note]").count()) ? await pick.locator("[role=note]").first().textContent() : null;
await pick.locator("button").scrollIntoViewIfNeeded();
await pick.locator("button").click();
await page.waitForTimeout(1000);
step("Chose a take", { take: pickLabel, warningShownBeforeChoosing: pickWarning });
const chosen = await check("Warnings after choosing a take match the changed timeline");
await page.getByRole("button", { name: "Undo", exact: true }).click();
await page.waitForTimeout(800);
const undone = await check("Warnings after Undo match the restored timeline");
await page.getByRole("button", { name: "Redo", exact: true }).click();
await page.waitForTimeout(800);
const redone = await check("Warnings after Redo match the changed timeline");
assert.deepEqual(undone.exp.comp.layers, initial.exp.comp.layers, "Undo did not restore the timeline");
assert.deepEqual(redone.exp.comp.layers, chosen.exp.comp.layers, "Redo did not restore the chosen take");
const savedFile = await save(page);
fs.copyFileSync(project, path.join(out, "before-close.supp"));
await page.screenshot({ path: path.join(out, "1-takes-after-redo.png") }).catch(() => {});
await quit(browser, page);
step("Saved and exited", { takesSaved: savedFile.compositions.find((c) => c.ai?.takes)?.ai.takes.length ?? 0 });

// ---- Session 2: reopen; the saved takes panel.
({ browser, page } = await launch());
await open(page);
const comp = savedFile.compositions.find((c) => c.ai?.takes?.length);
await page.getByRole("combobox", { name: "Active sequence" }).selectOption(comp.id);
await page.getByRole("button", { name: "AI Studio", exact: true }).click();
const reopened = page.locator("details.re-saved-takes");
await reopened.waitFor({ timeout: 20000 });
await page.screenshot({ path: path.join(out, "2-reopened-takes.png") }).catch(() => {});
const exp = expected(savedFile);
const rows = await reopened.locator("table tbody tr").all();
const mismatches = [];
let total = 0,
  warned = 0;
for (const tr of rows) {
  const shotNo = Number((await tr.locator("td").first().textContent()).match(/\d+/)[0]);
  const clipId = exp.order[shotNo - 1];
  const take = savedFile.compositions.find((c) => c.id === comp.id).ai.takes.find((t) => t.clipId === clipId);
  for (const it of await shown(tr)) {
    const m = it.label.match(/: (.+) @ ([\d.]+) s$/);
    const asset = savedFile.assets.find((a) => a.name === m[1]);
    const alt = [take.original, ...take.alternatives].find((a) => a.sourceId === asset?.id && Math.abs(a.inMs / 1000 - Number(m[2])) < 0.006);
    if (!alt) continue;
    total++;
    const want = exp.repeats(clipId, alt),
      got = repeatedShots(it.warning);
    if (got.length) warned++;
    if (JSON.stringify(want) !== JSON.stringify(got)) mismatches.push({ shot: shotNo, take: it.label, expected: want, shown: got });
  }
}
step("Reopened: saved takes and warnings match the saved timeline", { rows: rows.length, takes: total, warned, mismatches });
// Restore the first choice of the shot changed in session 1.
const restore = reopened.getByRole("button", { name: /^Restore the first choice/ }).first();
let restored = null;
if (await restore.count()) {
  const label = (await restore.textContent()).trim();
  await restore.scrollIntoViewIfNeeded();
  await restore.click();
  await page.waitForTimeout(800);
  const after = await save(page);
  const c = after.compositions.find((x) => x.id === comp.id);
  const changed = c.layers.filter((l) => {
    const was = initial.exp.comp.layers.find((x) => x.id === l.id);
    return was && (was.assetId !== l.assetId || was.sourceIn !== l.sourceIn);
  });
  restored = { label, layersDifferingFromFirstPlan: changed.length };
  step("Restored the first choice from the saved takes", restored);
}
await quit(browser, page);
const failures = report.steps.filter((s) => s.mismatches?.length);
report.ok = !failures.length && (!restored || restored.layersDifferingFromFirstPlan === 0);
fs.writeFileSync(path.join(out, "takes-verification.json"), JSON.stringify(report, null, 1));
log(report.ok ? "Take reuse verification passed" : "Take reuse verification FAILED", path.join(out, "takes-verification.json"));
process.exit(report.ok ? 0 : 1);
