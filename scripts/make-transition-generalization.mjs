// A reference with one of each common transition at known times, cut from local CC0 coastal
// footage (work/reference-advanced). Ground truth goes to truth.json: every shot boundary with its
// kind and span, plus in-shot events that are NOT boundaries (a continuous zoom, a negative pulse).
// Usage: node scripts/make-transition-generalization.mjs OUT_DIR
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const out = path.resolve(process.argv[2] ?? "test-results/transitions-ue");
fs.mkdirSync(path.join(out, "parts"), { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-y", ...args], { env, stdio: "inherit" });
const src = (name) => path.resolve("work/reference-advanced", name);
const W = 960,
  H = 540,
  FPS = 30;
// Source pieces: [file, start s, length s, extra filter before scaling].
const piece = (i, file, start, length, pre = "") => {
  const f = path.join(out, "parts", `p${i}.mp4`);
  run(["-ss", String(start), "-t", String(length), "-i", src(file), "-vf", `${pre}fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p`, "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", f]);
  return f;
};
const p = [
  piece(0, "coastal-reference.webm", 0.2, 1.6),
  piece(1, "forster-beach.webm", 2.0, 1.6),
  // 2: the same take as 1 continuing, punched in 1.5x (a cut that keeps the scene).
  piece(2, "forster-beach.webm", 3.6, 1.6, "crop=iw/1.5:ih/1.5,"),
  // 3: a continuous push-in over the whole shot (not a boundary).
  piece(3, "cloudy-beach.webm", 1.0, 2.0, `scale=1920:1080,zoompan=z='1+0.25*on/60':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=${FPS},`),
  piece(4, "coastal-reference.webm", 8.2, 2.0),
  piece(5, "forster-beach.webm", 9.0, 1.8),
  piece(6, "cloudy-beach.webm", 6.0, 1.8),
  piece(7, "coastal-reference.webm", 10.6, 1.8),
  piece(8, "forster-beach.webm", 13.0, 1.8),
  piece(9, "cloudy-beach.webm", 9.0, 1.6),
];
// Assemble with explicit transitions; times are on the output clock.
const inputs = p.flatMap((f) => ["-i", f]);
// Every input and every join on one timebase, so xfade can join them.
const g = p.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},settb=AVTB[s${i}]`);
let t = 0;
const truth = { boundaries: [], inShot: [] };
const len = [1.6, 1.6, 1.6, 2.0, 2.0, 1.8, 1.8, 1.8, 1.8, 1.6];
// 0 -> 1 hard cut; 1 -> 2 punch-in cut; 2 -> 3 hard cut (3 zooms continuously).
g.push(`[s0][s1][s2][s3]concat=n=4:v=1:a=0,settb=AVTB[a0]`);
truth.boundaries.push({ kind: "cut", atMs: 1600 }, { kind: "punch-in cut", atMs: 3200 }, { kind: "cut", atMs: 4800 });
truth.inShot.push({ kind: "continuous zoom", startMs: 4800, endMs: 6800 });
t = 6.8;
// 3 -> 4 dissolve of 0.6 s centred on the join.
g.push(`[a0][s4]xfade=transition=fade:duration=0.6:offset=${(t - 0.6).toFixed(3)}[a1]`);
truth.boundaries.push({ kind: "dissolve", atMs: Math.round((t - 0.3) * 1000), startMs: Math.round((t - 0.6) * 1000), endMs: Math.round(t * 1000) });
t = t - 0.6 + 2.0;
// 4 -> 5 white flash over the cut (0.1 s up, 0.1 s down).
g.push(`[a1][s5]concat=n=2:v=1:a=0,settb=AVTB[a2pre]`);
const flashAt = t;
g.push(`color=white:s=${W}x${H}:r=${FPS}:d=30,format=rgba,fade=t=in:st=${(flashAt - 0.1).toFixed(3)}:d=0.1:alpha=1,fade=t=out:st=${flashAt.toFixed(3)}:d=0.1:alpha=1[fl]`);
g.push(`[a2pre][fl]overlay=shortest=1[a2]`);
truth.boundaries.push({ kind: "flash", atMs: Math.round(flashAt * 1000), startMs: Math.round((flashAt - 0.1) * 1000), endMs: Math.round((flashAt + 0.1) * 1000) });
t += 1.8;
// 5 -> 6 blur transition (a strong blur from 0.15 s before to 0.15 s after the cut).
g.push(`[a2][s6]concat=n=2:v=1:a=0,settb=AVTB,gblur=sigma=20:enable='between(t,${(t - 0.15).toFixed(3)},${(t + 0.15).toFixed(3)})'[a3]`);
truth.boundaries.push({ kind: "blur", atMs: Math.round(t * 1000), startMs: Math.round((t - 0.15) * 1000), endMs: Math.round((t + 0.15) * 1000) });
// 6: a negative pulse inside the shot (3 frames inverted, then back) — an effect, not a boundary.
const pulse = t + 0.8;
g.push(`[a3]negate=enable='between(t,${pulse.toFixed(3)},${(pulse + 0.09).toFixed(3)})'[a4]`);
truth.inShot.push({ kind: "negative pulse", startMs: Math.round(pulse * 1000), endMs: Math.round((pulse + 0.1) * 1000) });
t += 1.8;
// 6 -> 7 whip: a fast slide over 0.2 s.
g.push(`[a4][s7]xfade=transition=slideleft:duration=0.2:offset=${(t - 0.2).toFixed(3)}[a5]`);
truth.boundaries.push({ kind: "whip", atMs: Math.round((t - 0.1) * 1000), startMs: Math.round((t - 0.2) * 1000), endMs: Math.round(t * 1000) });
t = t - 0.2 + 1.8;
// 7 -> 8 hard cut; 8 ends in a 0.6 s freeze (frame hold), then a hard cut to 9.
g.push(`[s8]tpad=stop_mode=clone:stop_duration=0.6[held]`);
g.push(`[a5][held][s9]concat=n=3:v=1:a=0,format=yuv420p[v]`);
truth.boundaries.push({ kind: "cut", atMs: Math.round(t * 1000) });
truth.inShot.push({ kind: "freeze (frame hold)", startMs: Math.round((t + 1.8) * 1000), endMs: Math.round((t + 2.4) * 1000) });
t += 2.4;
truth.boundaries.push({ kind: "cut after a freeze", atMs: Math.round(t * 1000) });
t += 1.6;
const reference = path.join(out, "reference-transitions.mp4");
run([...inputs, "-filter_complex", g.join(";"), "-map", "[v]", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-r", String(FPS), "-pix_fmt", "yuv420p", reference]);
fs.writeFileSync(path.join(out, "truth.json"), JSON.stringify({ reference, durationMs: Math.round(t * 1000), ...truth }, null, 1));
console.log(JSON.stringify({ reference, durationS: t.toFixed(2), boundaries: truth.boundaries.length, inShot: truth.inShot.length }));
