// Known transform envelopes on real CC0 footage for motion-transition regression.
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { mediaEnvironment } from "./runtime.mjs";
const dir = path.resolve("work/reference-advanced"),
  source = path.join(dir, "coastal-reference.webm");
const output = path.join(dir, "controlled-motion.mp4"),
  env = mediaEnvironment(),
  args = ["-v", "error", "-y"];
for (const start of [0, 2.5, 8.2, 10.6])
  args.push("-ss", String(start), "-t", "2", "-i", source);
const travel = (cut) =>
  "if(between(on," +
  (cut - 6) +
  "," +
  (cut - 1) +
  "),(on-" +
  (cut - 6) +
  ")/5,if(between(on," +
  cut +
  "," +
  (cut + 5) +
  "),-(1-(on-" +
  cut +
  ")/5),0))";
const whip = travel(120),
  motion = travel(180);
const zoom =
  "1+0.18*max(0,1-abs(on-60)/6)+0.24*abs(" +
  whip +
  ")+0.10*abs(" +
  motion +
  ")";
const x = "iw/2-iw/zoom/2+iw*(0.1*(" + whip + ")+0.04*(" + motion + "))/zoom";
args.push(
  "-filter_complex",
  [0, 1, 2, 3]
    .map(
      (i) =>
        "[" +
        i +
        ":v]fps=30,scale=960:376,setsar=1,setpts=PTS-STARTPTS[v" +
        i +
        "]",
    )
    .join(";") +
    ";" +
    "[v0][v1][v2][v3]concat=n=4:v=1:a=0,zoompan=z='" +
    zoom +
    "':x='" +
    x +
    "':y='ih/2-ih/zoom/2':d=1:s=640x250:fps=30,format=yuv420p[v]",
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
  path.join(dir, "controlled-motion.json"),
  JSON.stringify(
    {
      source,
      output,
      kind: "controlled motion regression using real footage; not an independent natural style reference",
      boundariesSeconds: [2, 4, 6],
      zoom: { center: 2, span: 0.4, scale: 1.18 },
      whip: { center: 4, span: 0.4, translationFraction: 0.1 },
      motion: { center: 6, span: 0.4, translationFraction: 0.04 },
    },
    null,
    2,
  ),
);
console.log(output);
