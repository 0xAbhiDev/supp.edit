// Labelling aid: one row per reference shot — the reference frame at the shot's middle, the raw
// frame find-exact matched, and its runner-up — to check matches by eye before labelling.
// Usage: node scripts/eval/compare-frames.mjs PAIR_DIR MATCHES.json OUT_PREFIX
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mediaEnvironment } from "../runtime.mjs";
import { pairSchema, readJson } from "./lib.mjs";

const [dirArg, matchesFile, prefix] = process.argv.slice(2);
const dir = path.resolve(dirArg);
const pair = pairSchema.parse(readJson(path.join(dir, "pair.json")));
const matches = readJson(matchesFile);
const ffmpeg = mediaEnvironment().SUPP_FFMPEG || "ffmpeg";
const font = "C\\:/Windows/Fonts/arial.ttf";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "supp-compare-"));
let n = 0;
function frame(file, ms, label) {
  const out = path.join(tmp, `f-${String(++n).padStart(4, "0")}.jpg`);
  const text = label.replace(/[:\\']/g, " ");
  const filters = `scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,drawtext=fontfile='${font}':text='${text}':x=4:y=4:fontsize=15:fontcolor=yellow:box=1:boxcolor=black@0.6`;
  const run = file ? spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.max(0, ms) / 1000), "-i", path.join(dir, file), "-frames:v", "1", "-vf", filters, out], { windowsHide: true }) : { status: 1 };
  if (run.status !== 0 || !fs.existsSync(out)) spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180", "-frames:v", "1", "-vf", filters, out], { windowsHide: true });
}
const PER_SHEET = 8;
const sheets = [];
for (let s = 0; s < matches.length; s += PER_SHEET) {
  n = 0;
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
  const rows = matches.slice(s, s + PER_SHEET);
  for (const m of rows) {
    const mid = (m.startMs + m.endMs) / 2;
    frame(pair.reference.file, mid, `shot ${m.shot} ref ${(mid / 1000).toFixed(2)}`);
    const rawMid = m.clip ? m.rawStartMs + (mid - m.startMs) * m.speed : null;
    frame(m.clip, rawMid, m.clip ? `${m.clip} ${(rawMid / 1000).toFixed(2)} x${m.speed} ${m.score}` : "no match");
    const rivalMid = m.rival ? m.rival.atMs + (mid - m.startMs - (m.lead ?? 0)) * m.rival.speed : null;
    frame(m.rival?.clip, rivalMid, m.rival ? `next ${m.rival.clip} ${(rivalMid / 1000).toFixed(2)} ${m.rival.score}` : "no rival");
  }
  const out = `${prefix}-${String(sheets.length + 1).padStart(2, "0")}.jpg`;
  spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(tmp, "f-%04d.jpg"), "-vf", `tile=3x${rows.length}:padding=3:color=black`, "-frames:v", "1", out], { windowsHide: true });
  sheets.push(out);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(sheets.join("\n"));
