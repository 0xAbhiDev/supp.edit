// Capture local analysis for repeatable reference recreation tests.
// Usage: node scripts/capture-reference-analysis.mjs DIRECTORY REFERENCE RAW MUSIC
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { mediaEnvironment } from "./runtime.mjs";
const [dir, ...files] = process.argv.slice(2);
if (files.length !== 3)
  throw Error(
    "Supply an output directory, reference, raw video and music file",
  );
fs.mkdirSync(dir, { recursive: true });
const env = mediaEnvironment(),
  models = env.SUPP_AI_MODELS || path.resolve("work/ai-models");
const run = (name, args) =>
  execFileSync(
    path.resolve(
      "target/debug/examples",
      name + (process.platform === "win32" ? ".exe" : ""),
    ),
    args,
    { env, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  );
const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);
const assets = JSON.parse(
  run(
    "probe_assets",
    files.map((f) => path.resolve(f)),
  ),
);
write("assets.json", JSON.stringify({ assets }));
for (const [i, a] of assets.entries()) {
  const tasks = [
    ...(a.kind === "video" ? ["vision"] : []),
    ...(a.hasAudio ? ["audio"] : []),
  ];
  for (const task of tasks)
    write(
      i + "-" + task + ".json",
      run("analyze", [
        models,
        path.resolve("work/analysis-cache"),
        task,
        a.path,
        a.id,
      ]),
    );
}
write("motion.json", run("reference_motion", [assets[0].path]));
write("text.json", run("reference_text", [assets[0].path]));
run("color_samples", [
  path.join(dir, "assets.json"),
  path.join(dir, "colors.json"),
  "--reference",
]);
const server = await createServer({
  appType: "custom",
  server: { middlewareMode: true, watch: null },
});
try {
  const { newProject } = await server.ssrLoadModule(
    "/packages/project-schema/index.ts",
  );
  const p = newProject("Reference recreation acceptance", 360, 640);
  p.assets = assets;
  write("SOURCE.supp", JSON.stringify(p));
} finally {
  await server.close();
}
