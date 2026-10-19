import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { mediaEnvironment } from "./runtime.mjs";
const file = process.platform === "win32" ? "supp-edit.exe" : "supp-edit";
const candidate = ["bin", "target/release", "target/debug"]
  .map((dir) => path.resolve(dir, file))
  .find(existsSync);
if (!candidate)
  throw new Error("Build the desktop application first: npm run build:desktop");
const child = spawn(candidate, [], {
  env: mediaEnvironment(),
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
