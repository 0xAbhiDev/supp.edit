// Re-measure the dense per-frame data (i-visual.json) of every video in captured inventories,
// after the native per-frame measurement changes. Inventories run in parallel.
// Usage: node scripts/recapture-visual.mjs INVENTORY_DIR [INVENTORY_DIR…]
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment();
const exe = path.resolve("target/debug/examples/reference_visual" + (process.platform === "win32" ? ".exe" : ""));
await Promise.all(
  process.argv.slice(2).map(async (dir) => {
    const { assets } = JSON.parse(fs.readFileSync(path.join(dir, "assets.json"), "utf8"));
    for (const [i, a] of assets.entries()) {
      if (a.kind !== "video") continue;
      const t = performance.now();
      const { stdout } = await promisify(execFile)(exe, [a.path.replace(/^\\\\\?\\/, "")], { env, windowsHide: true, maxBuffer: 512 * 1024 * 1024 });
      fs.writeFileSync(path.join(dir, `${i}-visual.json`), stdout);
      console.log(`${dir} ${i} ${a.name} ${((performance.now() - t) / 1000).toFixed(1)} s ${(stdout.length / 1e6).toFixed(1)} MB`);
    }
  }),
);
