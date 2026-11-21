// Save → Close → Launch → Open → Verify → Close, repeated, on the real Windows application.
// Usage: node scripts/stress-reopen.mjs PROJECT.supp OUT_DIR [CYCLES=20] [--export]
//
// PROJECT.supp is opened and saved in place; pass a copy. Each cycle launches bin/supp-edit.exe,
// opens the project through the native dialog, checks the restored sequences, plays the last
// sequence, saves, deep-compares the saved file with the baseline (every composition, layer,
// effect parameter, gain key, text and asset), closes the window and waits for the process to
// exit. Per cycle it records each stage's timing, the process exit code, page crashes, a left-over
// recovery snapshot (an unclean exit), and the lifecycle-log lines the host and page wrote for
// that process. A failed cycle is recorded and the run continues.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "@playwright/test";
import { mediaEnvironment } from "./runtime.mjs";
const [projectArg, outArg, cyclesArg = "20"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// --export also delivers the last sequence through the Deliver panel before closing (the state in
// which an earlier run's window stopped answering close requests).
const withExport = process.argv.includes("--export");
if (!outArg) throw Error("Supply a project copy and an output directory.");
const project = path.resolve(projectArg),
  out = path.resolve(outArg),
  cycles = Number(cyclesArg),
  port = 9333,
  exe = path.resolve("bin/supp-edit.exe"),
  appData = path.join(process.env.APPDATA ?? "", "studio.supp.edit"),
  recoverySnapshot = path.join(appData, "recovery-0.json"),
  lifecycleLog = path.join(appData, "lifecycle.log");
fs.mkdirSync(out, { recursive: true });
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const running = () => {
  try {
    return execFileSync("tasklist", ["/FI", "IMAGENAME eq supp-edit.exe", "/NH"], { encoding: "utf8" }).includes("supp-edit.exe");
  } catch {
    return false;
  }
};
const dialog = (file) =>
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("scripts/native-file-dialog.ps1"), "-Path", file], { encoding: "utf8" }).trim();
const lifecycleLines = (pid, fromBytes) => {
  if (!fs.existsSync(lifecycleLog)) return [];
  const text = fs.readFileSync(lifecycleLog, "utf8").slice(fromBytes);
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter((f) => Number(f[1]) === pid)
    .map(([ms, , stage, detail]) => ({ ms: Number(ms), stage, detail }));
};
// What a reopen must restore exactly. The path and modification times are the save's own.
const persistent = (p) => ({ settings: p.settings, tracks: p.tracks, clips: p.clips, assets: p.assets, compositions: p.compositions, markers: p.markers, transcripts: p.transcripts });
function differences(a, b, at = "", outList = []) {
  if (outList.length >= 8) return outList;
  if (isDeepStrictEqual(a, b)) return outList;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], `${at}/${k}`, outList);
  } else outList.push({ at, before: JSON.stringify(a)?.slice(0, 120), after: JSON.stringify(b)?.slice(0, 120) });
  return outList;
}
if (running()) throw Error("Close the running supp.edit first.");
const original = read(project),
  expectedSequences = original.compositions.map((c) => c.name);
let baseline = null;
const results = [];
for (let k = 1; k <= cycles; k++) {
  const cycle = { cycle: k, ok: false, stages: {}, problems: [] },
    began = Date.now(),
    stage = (name) => (cycle.stages[name] = Date.now() - began),
    logStart = fs.existsSync(lifecycleLog) ? fs.statSync(lifecycleLog).size : 0;
  let browser, page, child, exit, reattach = async () => false;
  try {
    if (fs.existsSync(recoverySnapshot)) {
      // A snapshot left at launch means the previous process did not exit cleanly. Keep it as
      // evidence (moved, not deleted) so the next launch opens normally.
      cycle.problems.push("recovery snapshot present before launch (previous exit was not clean)");
      fs.renameSync(recoverySnapshot, path.join(out, `recovery-before-cycle-${k}.json`));
    }
    const env = mediaEnvironment();
    env.SUPP_AI_MODELS ||= path.resolve("work/ai-models");
    env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=" + port;
    child = spawn(exe, [], { env, stdio: "ignore", detached: true, windowsHide: false });
    const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal, atMs: Date.now() - began })));
    exited.then((e) => (exit = e));
    cycle.pid = child.pid;
    stage("spawned");
    for (let i = 0; i < 60 && !browser; i++) {
      await sleep(1000);
      if (exit) throw Error(`process exited during launch (code ${exit.code})`);
      browser = await chromium.connectOverCDP("http://127.0.0.1:" + port).catch(() => undefined);
    }
    if (!browser) throw Error("window did not become available");
    page = browser.contexts()[0].pages()[0];
    page.on("crash", () => cycle.problems.push(`page crashed at ${Date.now() - began} ms`));
    // The web view can drop the debugging connection while Deliver runs (the app keeps working):
    // recorded as harness evidence, and the driver reattaches.
    const watch = (b) =>
      b.on("disconnected", () => {
        if (!cycle.closing) (cycle.debuggerDrops ??= []).push(`at ${Date.now() - began} ms (stage: ${Object.keys(cycle.stages).at(-1)})`);
      });
    watch(browser);
    reattach = async () => {
      await browser?.close().catch(() => {});
      browser = await chromium.connectOverCDP("http://127.0.0.1:" + port).catch(() => undefined);
      page = browser?.contexts()[0]?.pages()[0];
      if (browser) watch(browser);
      return !!page;
    };
    page.on("console", (m) => {
      if (m.type() === "error") fs.appendFileSync(path.join(out, `cycle-${k}-console.log`), `${new Date().toISOString()} ${m.text()}\n`);
    });
    await page.getByRole("button", { name: "Open project", exact: true }).waitFor({ timeout: 60000 });
    stage("launched");
    const options = page.getByRole("combobox", { name: "Active sequence" }).locator("option");
    const restored = options.filter({ hasText: expectedSequences.at(-1) }).first().waitFor({ state: "attached", timeout: 180000 });
    await page.getByRole("button", { name: "Open project", exact: true }).click();
    cycle.dialog = dialog(project);
    await restored;
    stage("opened");
    const sequences = await options.allTextContents();
    for (const name of expectedSequences) if (!sequences.includes(name)) cycle.problems.push(`sequence "${name}" missing after open`);
    const target = original.compositions.at(-1);
    await page.getByRole("combobox", { name: "Active sequence" }).selectOption(target.id);
    await page.locator(".workspace-tabs").getByRole("button", { name: "Edit", exact: true }).click();
    await page.waitForTimeout(1500);
    const clock = page.locator(".timecode").first(),
      before = await clock.textContent();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Play", exact: true }).waitFor({ timeout: 5000 });
    const after = await clock.textContent();
    if (after === before) cycle.problems.push(`playback did not advance (${before})`);
    cycle.playback = { from: before, to: after };
    stage("played");
    const mtime = fs.statSync(project).mtimeMs;
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    for (let i = 0; i < 60 && fs.statSync(project).mtimeMs === mtime; i++) await sleep(500);
    if (fs.statSync(project).mtimeMs === mtime) throw Error("save did not write the project");
    await sleep(500);
    stage("saved");
    const saved = persistent(read(project));
    if (!baseline) {
      // The first save may normalise an older file (defaults, migration); record what changed
      // once, then require every later cycle to restore that exact state.
      cycle.firstSaveNormalised = differences(persistent(original), saved);
      baseline = saved;
      fs.copyFileSync(project, path.join(out, "baseline.supp"));
    } else {
      const diff = differences(baseline, saved);
      if (diff.length) {
        cycle.problems.push("saved project differs from the baseline");
        cycle.differences = diff;
        fs.copyFileSync(project, path.join(out, `cycle-${k}-differs.supp`));
      }
    }
    if (withExport) {
      const movie = path.join(out, `cycle-${k}.mp4`);
      fs.rmSync(movie, { force: true });
      await page.locator(".workspace-tabs").getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("button", { name: "Export MP4" }).click();
      cycle.exportDialog = dialog(movie);
      await page.getByRole("button", { name: /Rendering/ }).waitFor({ timeout: 30000 }).catch(() => {});
      for (let attempt = 0; ; attempt++) {
        try {
          await page.getByRole("button", { name: "Export MP4" }).waitFor({ timeout: 30 * 60000 });
          break;
        } catch (e) {
          if (attempt >= 3 || !/closed/i.test(String(e)) || !(await reattach())) throw e;
          cycle.reattached = attempt + 1;
        }
      }
      cycle.exported = { written: fs.existsSync(movie), bytes: fs.existsSync(movie) ? fs.statSync(movie).size : 0, alerts: await page.locator("[role=alert], [role=status]").allTextContents() };
      if (!cycle.exported.written) cycle.problems.push("export wrote no file");
      stage("exported");
    }
    cycle.restored = {
      compositions: saved.compositions.length,
      layers: saved.compositions.reduce((n, c) => n + c.layers.length, 0),
      texts: saved.compositions.reduce((n, c) => n + c.layers.filter((l) => l.kind === "text").length, 0),
      curves: saved.compositions.reduce((n, c) => n + c.layers.filter((l) => l.effectStack?.some((e) => e.type === "curves")).length, 0),
      assets: saved.assets.length,
    };
  } catch (e) {
    cycle.problems.push(`failed at ${Object.keys(cycle.stages).at(-1) ?? "start"}: ${e.message.split("\n")[0]}`);
    await page?.screenshot({ path: path.join(out, `cycle-${k}-failure.png`), timeout: 5000 }).catch(() => {});
  }
  // Close the window as the title-bar button would; the app exits when its last window closes.
  // If the page cannot deliver the request, reattach once; then close the window the way Windows
  // does (WM_CLOSE). Which path closed it is recorded.
  cycle.closing = true;
  const ipcClose = () => page?.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).then(() => true, () => false) ?? Promise.resolve(false);
  const waitExit = async (ms) => {
    for (let i = 0; i < ms / 500 && !exit; i++) await sleep(500);
    return !!exit;
  };
  if (!exit) {
    cycle.closedBy = "window close";
    cycle.closeAnswered = await ipcClose();
    if (!(await waitExit(15000)) && (await reattach())) {
      cycle.closedBy = "window close after reattaching";
      await ipcClose();
      await waitExit(15000);
    }
    if (!exit) {
      cycle.closedBy = "WM_CLOSE";
      try {
        execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${child.pid}).CloseMainWindow()`]);
      } catch {}
      await waitExit(20000);
    }
  }
  await browser?.close().catch(() => {});
  stage("closed");
  if (!exit) {
    cycle.problems.push("process did not exit after window close, reattached close and WM_CLOSE; terminated");
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    } catch {}
    for (let i = 0; i < 20 && !exit; i++) await sleep(500);
  }
  cycle.exit = exit ?? null;
  if (exit && exit.code !== 0) cycle.problems.push(`process exit code ${exit.code}`);
  await sleep(1000);
  if (fs.existsSync(recoverySnapshot)) cycle.problems.push("recovery snapshot left after exit");
  cycle.lifecycle = lifecycleLines(child?.pid, logStart);
  const stages = cycle.lifecycle.map((l) => l.stage);
  for (const needed of ["launch", "page:page loaded", "open: read", "page:project parsed", "page:timeline hydrated", "page:renderer first frame", "page:audio ready", "save: written", "window destroyed", "exit"])
    if (!stages.includes(needed)) cycle.problems.push(`lifecycle stage "${needed}" not recorded`);
  for (const l of cycle.lifecycle) if (/panic|failed|error|rejection/i.test(l.stage)) cycle.problems.push(`${l.stage}: ${l.detail}`);
  cycle.seconds = Math.round((Date.now() - began) / 100) / 10;
  cycle.ok = cycle.problems.length === 0;
  results.push(cycle);
  log(`cycle ${k}/${cycles}`, cycle.ok ? "PASS" : "FAIL", `${cycle.seconds}s`, JSON.stringify(cycle.stages), cycle.problems.join("; "));
  fs.writeFileSync(path.join(out, "stress-reopen.json"), JSON.stringify({ project, executable: { path: exe, modified: fs.statSync(exe).mtime.toISOString(), bytes: fs.statSync(exe).size }, cycles: results }, null, 1));
  await sleep(1500);
}
const passed = results.filter((c) => c.ok).length;
log(`${passed}/${results.length} cycles passed`);
