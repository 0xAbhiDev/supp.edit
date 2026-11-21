// Export the last sequence of a saved project through the Windows application's Deliver panel
// several times in one session, recording each outcome and any error the app reports.
// Usage: node scripts/repeat-native-export.mjs PROJECT.supp OUT_DIR [COUNT]
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { mediaEnvironment } from "./runtime.mjs";
const [projectArg, outArg, countArg = "4"] = process.argv.slice(2);
const project = path.resolve(projectArg),
  out = path.resolve(outArg),
  port = 9333,
  count = Number(countArg);
fs.mkdirSync(out, { recursive: true });
const running = () => execFileSync("tasklist", ["/FI", "IMAGENAME eq supp-edit.exe", "/NH"], { encoding: "utf8" }).includes("supp-edit.exe");
const dialog = (file) =>
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("scripts/native-file-dialog.ps1"), "-Path", file], { encoding: "utf8" }).trim();
assert(!running(), "Close the running supp.edit first.");
const env = mediaEnvironment();
env.SUPP_AI_MODELS ||= path.resolve("work/ai-models");
env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=" + port;
spawn(path.resolve("bin/supp-edit.exe"), [], { env, stdio: "ignore", detached: true }).unref();
let browser;
for (let i = 0; i < 60 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + port).catch(() => undefined);
}
const page = browser.contexts()[0].pages()[0];
await page.getByRole("button", { name: "Open project", exact: true }).click();
dialog(project);
const saved = JSON.parse(fs.readFileSync(project, "utf8"));
const target = saved.compositions.at(-1);
await page.getByRole("combobox", { name: "Active sequence" }).locator(`option[value="${target.id}"]`).waitFor({ state: "attached", timeout: 120000 });
await page.getByRole("combobox", { name: "Active sequence" }).selectOption(target.id);
await page.locator(".workspace-tabs").getByRole("button", { name: "Export", exact: true }).click();
const results = [];
for (let k = 1; k <= count; k++) {
  const movie = path.join(out, `export-${k}.mp4`);
  fs.rmSync(movie, { force: true });
  const began = Date.now();
  await page.getByRole("button", { name: "Export MP4" }).click();
  const answered = dialog(movie);
  await page.waitForTimeout(1500);
  // Evidence only: a busy renderer can delay screenshots, which must not fail the export.
  await page.screenshot({ path: path.join(out, `attempt-${k}.png`), timeout: 5000 }).catch(() => {});
  await page.getByRole("button", { name: /Rendering/ }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.getByRole("button", { name: "Export MP4" }).waitFor({ timeout: 30 * 60000 });
  const alerts = await page.locator("[role=alert], [role=status]").allTextContents();
  const visibility = await page.evaluate(() => document.visibilityState);
  results.push({ attempt: k, answered, written: fs.existsSync(movie), seconds: Math.round((Date.now() - began) / 1000), alerts, visibility });
  console.log(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(path.join(out, "repeat-export.json"), JSON.stringify(results, null, 2));
await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
await browser.close().catch(() => {});
