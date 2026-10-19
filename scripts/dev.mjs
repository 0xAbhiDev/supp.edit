import { spawn } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const child = spawn(
  process.execPath,
  ["node_modules/@tauri-apps/cli/tauri.js", "dev"],
  { env: mediaEnvironment(), stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => process.exit(code ?? 1));
