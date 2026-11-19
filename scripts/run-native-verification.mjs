// Run the Windows verification driver and clean up after it if it fails, without touching anything
// the run did not create.
// Usage: node scripts/run-native-verification.mjs PROJECT.supp OUT_DIR START_MS END_MS [driver options]
//
// On failure:
//  1. a screenshot of the application window (through its debugging port) goes to OUT_DIR;
//  2. the application's console (recorded continuously by the driver) stays in OUT_DIR;
//  3. the window is closed gracefully; only if the process this run launched (OUT_DIR/app.pid)
//     is still running afterwards is it stopped;
//  4. a recovery snapshot is moved into OUT_DIR only if it appeared during this run and refers to
//     the project under test; any other snapshot (a user's session) is left where it is.
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const args = process.argv.slice(2);
const [projectArg, outArg] = args.filter((a) => !a.startsWith("--"));
if (!outArg) throw Error("Supply the project copy, the output directory, then the driver's arguments.");
const out = path.resolve(outArg);
fs.mkdirSync(out, { recursive: true });
const started = Date.now();
const snapshot = path.join(process.env.APPDATA ?? "", "studio.supp.edit", "recovery-0.json");
const existedBefore = fs.existsSync(snapshot);
const run = spawnSync(process.execPath, [path.resolve("scripts/verify-native-focused.mjs"), ...args], { stdio: "inherit" });
if (run.status === 0) process.exit(0);
const note = (...a) => {
  const line = `${new Date().toISOString().slice(11, 19)} [harness] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(path.join(out, "harness.log"), line + "\n");
};
note(`driver failed with exit ${run.status}; collecting evidence`);
const pidFile = path.join(out, "app.pid");
const pid = fs.existsSync(pidFile) && fs.statSync(pidFile).mtimeMs >= started ? Number(fs.readFileSync(pidFile, "utf8")) : undefined;
const alive = (id) => {
  try {
    return !!id && execFileSync("tasklist", ["/FI", `PID eq ${id}`, "/NH"], { encoding: "utf8" }).includes("supp-edit.exe");
  } catch {
    return false;
  }
};
try {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 5000 });
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    note("saved failure.png");
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
  }
  await browser.close().catch(() => {});
} catch (e) {
  note("application window not reachable:", String(e).slice(0, 120));
}
for (let i = 0; i < 20 && alive(pid); i++) await new Promise((r) => setTimeout(r, 500));
if (alive(pid)) {
  note(`instance ${pid} (launched by this run) did not close; stopping it`);
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/F"]);
  } catch {}
} else if (pid) note(`instance ${pid} closed`);
if (fs.existsSync(snapshot)) {
  const stat = fs.statSync(snapshot);
  const text = fs.readFileSync(snapshot, "utf8");
  const project = projectArg ? JSON.parse(fs.readFileSync(path.resolve(projectArg), "utf8").replace(/^﻿/, "")) : undefined;
  const ours = !existedBefore && stat.mtimeMs >= started && (project?.assets ?? []).some((a) => text.includes(a.id));
  if (ours) {
    fs.renameSync(snapshot, path.join(out, "recovery-from-failed-run.json"));
    note("moved this run's recovery snapshot into the evidence folder");
  } else note("a recovery snapshot exists that this run did not create; left untouched");
}
process.exit(run.status ?? 1);
