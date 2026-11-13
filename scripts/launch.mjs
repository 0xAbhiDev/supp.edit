import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { mediaEnvironment } from "./runtime.mjs";
const file = process.platform === "win32" ? "supp-edit.exe" : "supp-edit";
const candidate = [
  path.resolve("bin", file),
  path.resolve("target/release", file),
  ...(process.platform === "win32"
    ? [
        path.resolve("bin", "supp-edit-compositor.exe"),
        path.resolve("bin", "supp-edit-foundation.exe"),
        path.resolve("bin", "supp-edit-animation.exe"),
        path.resolve("bin", "supp-edit-gpu.exe"),
      ]
    : []),
  path.resolve("target/debug", file),
].find(existsSync);
if (!candidate)
  throw new Error("Build the desktop application first: npm run build:desktop");
const env = mediaEnvironment();
const models = path.resolve("work/ai-models");
if (!env.SUPP_AI_MODELS && existsSync(models)) env.SUPP_AI_MODELS = models;
const child = spawn(candidate, [], {
  env,
  stdio: "ignore",
  detached: true,
  windowsHide: true,
});
child.once("error", (error) => {
  console.error(`Could not launch supp.edit: ${error.message}`);
  process.exitCode = 1;
});
child.once("spawn", () => {
  child.unref();
  console.log(`Started ${candidate}`);
});
