import { spawnSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment();
const checks = [
  ["Node", process.execPath, ["--version"]],
  ["Rust", "rustc", ["--version"]],
  ["Cargo", "cargo", ["--version"]],
  ["FFmpeg", env.SUPP_FFMPEG || "ffmpeg", ["-version"]],
  ["FFprobe", env.SUPP_FFPROBE || "ffprobe", ["-version"]],
];
let missing = false;
for (const [label, cmd, args] of checks) {
  const result = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  const ok = result.status === 0;
  console.log(
    `${ok ? "OK" : "MISSING"}  ${label}: ${ok ? result.stdout.split("\n")[0] : "install the tool or configure its environment variable"}`,
  );
  if (!ok) missing = true;
}
console.log(
  "Desktop: Windows requires MSVC Build Tools + WebView2. macOS requires Xcode CLI tools. Linux requires WebKitGTK 4.1 and platform development packages.",
);
process.exitCode = missing ? 1 : 0;
