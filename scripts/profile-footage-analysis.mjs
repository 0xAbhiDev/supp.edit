// Time each native stage that understanding a raw clip runs, on a cold cache.
// Usage: node scripts/profile-footage-analysis.mjs VIDEO [OUT.json] [--profile=debug|release] [--parallel]
// --parallel runs the stages at once, as the app does per clip, and reports the wall clock.
// The webview stage (two-a-second tone sampling) is timed in the app; see the recreate warnings.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mediaEnvironment } from "./runtime.mjs";
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const [video, out] = args.filter((a) => !a.startsWith("--"));
if (!video) throw Error("Supply a video file.");
const profile = flag("profile") ?? "debug";
const env = mediaEnvironment(),
  models = env.SUPP_AI_MODELS || path.resolve("work/ai-models");
const exe = (name) => path.resolve(`target/${profile}/examples`, name + (process.platform === "win32" ? ".exe" : ""));
const cold = fs.mkdtempSync(path.join(os.tmpdir(), "supp-profile-"));
const time = (label, name, argv) => {
  const t = performance.now();
  const output = execFileSync(exe(name), argv, { env, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  const seconds = (performance.now() - t) / 1000;
  console.log(`${label.padEnd(28)} ${seconds.toFixed(1).padStart(7)} s`);
  return { label, seconds, bytes: output.length };
};
const file = path.resolve(video);
const asset = JSON.parse(execFileSync(exe("probe_assets"), [file], { env, windowsHide: true }))[0];
console.log(`${path.basename(file)} · ${asset.duration.toFixed(1)} s · ${asset.width}x${asset.height} · ${profile}`);
const inventory = path.join(cold, "assets.json");
fs.writeFileSync(inventory, JSON.stringify({ assets: [asset] }));
const parallel = args.includes("--parallel");
const timeAsync = async (label, name, argv) => {
  const t = performance.now();
  const { stdout } = await promisify(execFile)(exe(name), argv, { env, windowsHide: true, maxBuffer: 256 * 1024 * 1024, encoding: "buffer" });
  const seconds = (performance.now() - t) / 1000;
  console.log(`${label.padEnd(28)} ${seconds.toFixed(1).padStart(7)} s (concurrent)`);
  return { label, seconds, bytes: stdout.length };
};
const wall = performance.now();
const stages = parallel
  ? await Promise.all([
      timeAsync("scenes + vision", "analyze", [models, path.join(cold, "b"), "vision", file, asset.id]),
      timeAsync("per-frame visual (33 ms)", "reference_visual", [file]),
      timeAsync("colour samples (≤300 s)", "color_samples", [inventory, path.join(cold, "colors.json"), "--reference"]),
      timeAsync("picture aperture", "aperture", [file]),
      timeAsync("person masks (10 Hz)", "person_mask", [models, file]),
    ])
  : [
  time("scenes + quality (video)", "analyze", [models, path.join(cold, "a"), "video", file, asset.id]),
  time("vision embeddings", "analyze", [models, path.join(cold, "b"), "vision", file, asset.id]),
  time("per-frame visual (33 ms)", "reference_visual", [file]),
  time("colour samples (≤300 s)", "color_samples", [inventory, path.join(cold, "colors.json"), "--reference"]),
  time("picture aperture", "aperture", [file]),
  time("person masks (10 Hz)", "person_mask", [models, file]),
];
const total = parallel ? (performance.now() - wall) / 1000 : stages.reduce((n, s) => n + s.seconds, 0);
console.log(`${(parallel ? "wall clock" : "total native").padEnd(28)} ${total.toFixed(1).padStart(7)} s  (${(total / asset.duration).toFixed(2)} s per footage second)`);
if (out) fs.writeFileSync(out, JSON.stringify({ file: path.basename(file), duration: asset.duration, profile, parallel, stages, total }, null, 2));
fs.rmSync(cold, { recursive: true, force: true });
