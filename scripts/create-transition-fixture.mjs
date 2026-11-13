// Controlled transition regression made from real CC0 footage, not an independent style benchmark.
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { mediaEnvironment } from "./runtime.mjs";
const dir = path.resolve("work/reference-advanced"),
  source = path.join(dir, "coastal-reference.webm");
const output = path.join(dir, "controlled-transitions.mp4"),
  env = mediaEnvironment();
const args = ["-v", "error", "-y"];
for (const start of [0, 2.5, 8.2, 10.6])
  args.push("-ss", String(start), "-t", "2", "-i", source);
args.push(
  "-filter_complex",
  [0, 1, 2, 3]
    .map(
      (i) =>
        "[" +
        i +
        ":v]fps=30,scale=640:250,setsar=1,setpts=PTS-STARTPTS[v" +
        i +
        "]",
    )
    .join(";") +
    ";" +
    "[v0][v1][v2][v3]concat=n=4:v=1:a=0,gblur=sigma=18:enable='between(t,3.86,4.13)'[base];" +
    "color=white:s=640x250:r=30:d=8,format=rgba,fade=t=in:st=1.8:d=0.2:alpha=1,fade=t=out:st=2:d=0.2:alpha=1[flash];" +
    "[base][flash]overlay=shortest=1,format=yuv420p[v]",
  "-map",
  "[v]",
  "-an",
  "-c:v",
  "libx264",
  "-crf",
  "18",
  "-movflags",
  "+faststart",
  output,
);
execFileSync(env.SUPP_FFMPEG, args, {
  windowsHide: true,
  maxBuffer: 4 * 1024 * 1024,
});
fs.writeFileSync(
  path.join(dir, "controlled-transitions.json"),
  JSON.stringify(
    {
      source,
      output,
      kind: "controlled regression from actual footage; not an independently authored reference",
      boundariesSeconds: [2, 4, 6],
      flash: { start: 1.8, peak: 2, end: 2.2 },
      blur: { start: 3.86, end: 4.13, sigma: 18 },
    },
    null,
    2,
  ),
);
console.log(output);
