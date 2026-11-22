// Labelling aid: contact sheets of a video, each frame stamped with its time in seconds.
// Usage: node scripts/eval/sheet.mjs VIDEO OUT_PREFIX [--fps=1] [--from=S] [--to=S] [--cols=6] [--rows=5] [--width=240]
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { mediaEnvironment } from "../runtime.mjs";

const [video, prefix] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const opt = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d);
const fps = opt("fps", 1),
  cols = opt("cols", 6),
  rows = opt("rows", 5),
  width = opt("width", 240);
const from = opt("from", 0),
  to = opt("to", Infinity);
if (!video || !prefix) throw Error("Usage: node scripts/eval/sheet.mjs VIDEO OUT_PREFIX [--fps=1] [--from=S] [--to=S]");
fs.mkdirSync(path.dirname(path.resolve(prefix)), { recursive: true });
const ffmpeg = mediaEnvironment().SUPP_FFMPEG || "ffmpeg";
// The font for the time stamps (Windows ships Arial); ffmpeg's filter syntax needs the colon escaped.
const font = "C\\:/Windows/Fonts/arial.ttf";
const span = Number.isFinite(to) ? ["-t", String(to - from)] : [];
const filters = [
  `fps=${fps}`,
  `scale=${width}:-2`,
  // The time of each tile: the start plus its frame number over the sampling rate (the stream's own
  // timestamps can carry a container offset).
  `drawtext=fontfile='${font}':text='%{expr\\:${from}+n/${fps}}':x=4:y=4:fontsize=${Math.round(width / 11)}:fontcolor=yellow:box=1:boxcolor=black@0.6`,
  `tile=${cols}x${rows}:padding=2:color=black`,
].join(",");
const run = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(from), ...span, "-i", video, "-an", "-vf", filters, "-q:v", "4", `${prefix}-%02d.jpg`], { encoding: "utf8", windowsHide: true });
if (run.status !== 0) throw Error(run.stderr);
console.log(fs.readdirSync(path.dirname(path.resolve(prefix))).filter((f) => f.startsWith(path.basename(prefix) + "-")).join(" "));
