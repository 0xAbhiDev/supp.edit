// INVENTORY PLAN_DIR BEFORE.mp4 AFTER.mp4 FRAME OUT.png
// Read reference time from the real plan, preserving the aspect of every decoded frame.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [inventory, planDir, before, after, frameArg, dest] =
    process.argv.slice(2),
  frame = Number(frameArg);
if (!dest || !Number.isInteger(frame) || frame < 0)
  throw Error("Supply inputs, timeline frame and output PNG");
const read = (dir, name) =>
  JSON.parse(
    fs.readFileSync(path.join(dir, name), "utf8").replace(/^\uFEFF/, ""),
  );
const plan = read(planDir, "plan-report.json").find(
  (p) => p.mode === "Close Match",
);
const seq = read(planDir, "Three-modes.supp").compositions.find(
  (c) => c.id === plan.compositionId,
);
const shot = plan.matches.find(
  (m) => m.start <= frame && frame < m.start + m.duration,
);
if (!shot) throw Error("Frame outside matched timeline");
const rate = seq.settings.fps.num / seq.settings.fps.den,
  refMs =
    shot.referenceMs +
    ((frame - shot.start) * (shot.referenceEndMs - shot.referenceMs)) /
      shot.duration;
const inputs = [
  [read(inventory, "assets.json").assets[0].path, refMs / 1000, "Reference"],
  [before, frame / rate, "Previous output"],
  [after, frame / rate, "Current Windows export"],
];
const env = mediaEnvironment(),
  width = 400,
  height = 620,
  panels = [];
for (const [movie, time, label] of inputs) {
  const pixels = execFileSync(
    env.SUPP_FFMPEG,
    [
      "-v",
      "error",
      "-ss",
      time.toFixed(8),
      "-i",
      movie,
      "-an",
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:${height - 52}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:52+(oh-52-ih)/2:color=0x202020,drawtext=font=Arial:text='${label}':fontsize=19:fontcolor=white:x=14:y=14`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { env, windowsHide: true, maxBuffer: width * height * 3 + 4096 },
  );
  if (pixels.length !== width * height * 3)
    throw Error("Could not decode requested frame");
  panels.push(pixels);
}
const sheet = Buffer.alloc(width * 3 * height * 3);
for (let y = 0; y < height; y++)
  for (let col = 0; col < 3; col++)
    panels[col].copy(
      sheet,
      (y * width * 3 + col * width) * 3,
      y * width * 3,
      (y + 1) * width * 3,
    );
execFileSync(
  env.SUPP_FFMPEG,
  [
    "-v",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    width * 3 + "x" + height,
    "-i",
    "pipe:0",
    "-frames:v",
    "1",
    dest,
  ],
  { input: sheet, env, windowsHide: true },
);
fs.writeFileSync(
  dest + ".json",
  JSON.stringify({ frame, referenceMs: refMs, inputs }, null, 2),
);
