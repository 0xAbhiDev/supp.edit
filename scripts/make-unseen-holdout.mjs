// Final unseen holdout: a vertical (9:16) social edit cut from real footage of mixed sizes and
// frame rates (beach, coastline, an outdoor squat, a gym lift). Shot moments are drawn at random
// (the seed is recorded); the reference regrades them warm, reframes them vertically, changes
// their speed by up to ±10%, adds a title, a white flash and a dissolve, over music.
// truth.json is written for grading only — do not read it before the single graded run.
// Variant landscape: a 16:9 cool-graded edit from gym clips and coastline footage, reframed by a
// random zoom, with a small top-left title in yellow, the same flash and dissolve.
// Variant square: a 1:1 desaturated high-contrast edit from a flower close-up, a two-person clip,
// a squat, a deadlift and a beach, with a title at the top, a slide (whip-like push), a flash and a
// dissolve.
// Usage: node scripts/make-unseen-holdout.mjs OUT_DIR [SEED] [vertical|landscape|square]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const out = path.resolve(process.argv[2] ?? "test-results/footage/holdout-final");
const seed = Number(process.argv[3] ?? Date.now() % 2147483647);
const variant = ["landscape", "square"].includes(process.argv[4]) ? process.argv[4] : "vertical";
fs.mkdirSync(path.join(out, "parts"), { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-y", ...args], { env, stdio: "inherit" });
let state = seed;
const rand = () => ((state = (state * 48271) % 2147483647) / 2147483647);
// Raw pool, copied in as delivered (the app reads them unchanged). Usable stretches avoid the
// first/last half second and, for the coastline reel, its own edits.
const raw = variant === "square" ? [
  { file: "work/flower.mp4", stretches: [[0.3, 4.8]] },
  { file: "work/reframe-scenarios/two.mp4", stretches: [[0.2, 2.9]] },
  { file: "work/vision/squat.webm", stretches: [[0.5, 15.0]] },
  { file: "work/gym/deadlift.webm", stretches: [[0.5, 6.9]] },
  { file: "work/reference-advanced/forster-beach.webm", stretches: [[0.5, 17.0]] },
] : variant === "landscape" ? [
  { file: "work/gym/row.webm", stretches: [[0.5, 4.7]] },
  { file: "work/gym/incline.webm", stretches: [[0.5, 5.5]] },
  { file: "work/gym/bench.webm", stretches: [[0.5, 6.6]] },
  { file: "work/reference-advanced/coastal-reference.webm", stretches: [[2.25, 3.65], [3.95, 6.2], [8.3, 10.3], [10.6, 13.2], [13.5, 15.1]] },
  { file: "work/reference-advanced/cloudy-beach.webm", stretches: [[0.5, 11.6]] },
] : [
  { file: "work/reference-advanced/forster-beach.webm", stretches: [[0.5, 17.0]] },
  { file: "work/reference-advanced/cloudy-beach.webm", stretches: [[0.5, 11.6]] },
  { file: "work/reference-advanced/coastal-reference.webm", stretches: [[2.25, 3.65], [3.95, 6.2], [8.3, 10.3], [10.6, 13.2], [13.5, 15.1]] },
  { file: "work/vision/squat.webm", stretches: [[0.5, 15.0]] },
  { file: "work/gym/deadlift.webm", stretches: [[0.5, 6.9]] },
];
for (const r of raw) {
  r.name = "raw-" + path.basename(r.file);
  fs.copyFileSync(path.resolve(r.file), path.join(out, r.name));
}
const shots = [];
const used = [];
for (let k = 0; k < 6; k++) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = raw[Math.floor(rand() * raw.length)];
    const [a, b] = r.stretches[Math.floor(rand() * r.stretches.length)];
    const length = 1.2 + rand() * 0.8,
      speed = 0.9 + rand() * 0.2,
      span = length * speed;
    if (b - a < span + 0.1) continue;
    const start = a + rand() * (b - a - span);
    if (used.some((u) => u.name === r.name && start < u.end + 0.8 && start + span > u.start - 0.8)) continue;
    used.push({ name: r.name, start, end: start + span });
    shots.push({ clip: r.name, file: path.join(out, r.name), srcStart: start, srcEnd: start + span, length, speed, xShift: rand() * 0.6 - 0.3 });
    break;
  }
}
const W = variant === "landscape" ? 1280 : 720,
  H = variant === "landscape" ? 720 : variant === "square" ? 720 : 1280,
  FPS = 30;
const parts = shots.map((s, k) => {
  const f = path.join(out, "parts", `shot${k}.mp4`);
  // Vertical reframe at a random horizontal position, warm grade, speed change.
  const zoom = (1 + Math.abs(s.xShift)).toFixed(3);
  const crop =
    variant === "landscape"
      ? `scale=${W}*${zoom}:${H}*${zoom}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*(0.5+${(s.xShift / 2).toFixed(3)}):(ih-${H})/2`
      : `scale=-2:${H},crop=${W}:${H}:(iw-${W})*(0.5+${s.xShift.toFixed(3)}):0`;
  const grade =
    variant === "square"
      ? "eq=saturation=0.3:contrast=1.3:brightness=0.02"
      : variant === "landscape"
      ? "eq=saturation=0.85:contrast=1.12:gamma=1.05,colorbalance=rs=-0.06:bs=0.08:rh=-0.05:bh=0.07"
      : "eq=saturation=1.25:contrast=1.08:gamma=0.95,colorbalance=rs=0.08:gs=0.02:bs=-0.08:rh=0.06:bh=-0.06";
  const words = variant === "landscape" ? "TRAIN HARD" : variant === "square" ? "STAY CURIOUS" : "GOLDEN HOUR";
  const style =
    variant === "square"
      ? "fontcolor=white:fontsize=60:x=(w-text_w)/2:y=h*0.1:borderw=2:bordercolor=black"
      : variant === "landscape"
      ? "fontcolor=yellow:fontsize=54:x=w*0.06:y=h*0.08:borderw=3:bordercolor=black"
      : "fontcolor=white:fontsize=78:x=(w-text_w)/2:y=h*0.72:shadowcolor=black@0.6:shadowx=3:shadowy=3";
  const title = k === 1 ? `,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='${words}':${style}` : "";
  run(["-ss", s.srcStart.toFixed(3), "-t", (s.srcEnd - s.srcStart).toFixed(3), "-i", s.file, "-vf", `setpts=PTS-STARTPTS,setpts=PTS/${s.speed.toFixed(4)},fps=${FPS},${crop},${grade}${title},setsar=1,format=yuv420p`, "-t", s.length.toFixed(3), "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", f]);
  return f;
});
const inputs = parts.flatMap((f) => ["-i", f]);
const g = parts.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},settb=AVTB[s${i}]`);
const L = shots.map((s) => s.length);
const at = (i) => L.slice(0, i).reduce((x, y) => x + y, 0);
// Shots 0-2 hard cuts (square: a 0.25 s slide 0->1); a white flash over the 2->3 cut; a 0.4 s
// dissolve 4->5.
const slide = variant === "square" ? 0.25 : 0;
if (slide) {
  g.push(`[s0][s1]xfade=transition=slideleft:duration=${slide}:offset=${(L[0] - slide).toFixed(3)},settb=AVTB[w01]`);
  g.push(`[w01][s2][s3][s4]concat=n=4:v=1:a=0,settb=AVTB[a0]`);
} else g.push(`[s0][s1][s2][s3][s4]concat=n=5:v=1:a=0,settb=AVTB[a0]`);
g.push(`[a0][s5]xfade=transition=fade:duration=0.4:offset=${(at(5) - slide - 0.4).toFixed(3)}[a1]`);
const flash = at(3) - slide;
g.push(`color=white:s=${W}x${H}:r=${FPS}:d=30,format=rgba,fade=t=in:st=${(flash - 0.1).toFixed(3)}:d=0.1:alpha=1,fade=t=out:st=${flash.toFixed(3)}:d=0.1:alpha=1[fl]`);
g.push(`[a1][fl]overlay=shortest=1,format=yuv420p[v]`);
const duration = at(6) - slide - 0.4;
const reference = path.join(out, "reference-final.mp4");
run([...inputs, "-i", path.resolve("work/gym/music.wav"), "-filter_complex", g.join(";"), "-map", "[v]", "-map", `${parts.length}:a`, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-t", duration.toFixed(3), "-r", String(FPS), reference]);
// Ground truth in the planted format the graders read: each reference shot's source window.
const truth = {
  kind: "unseen-holdout",
  holdout: true,
  seed,
  reference,
  rawCuts: false,
  durationMs: Math.round(duration * 1000),
  planted: shots.map((s, k) => ({ clip: s.clip, source: `moment-${k + 1}`, startMs: Math.round(s.srcStart * 1000) - 300, endMs: Math.round(s.srcEnd * 1000) + 300 })),
  shots: shots.map((s, k) => ({ source: `moment-${k + 1}`, lengthS: Number((k === 4 || k === 5 ? s.length - 0.2 : k <= 1 ? s.length - slide / 2 : s.length).toFixed(3)), speed: Number(s.speed.toFixed(3)) })),
  transitions: [
    ...(slide ? [{ kind: "whip (slide left)", atMs: Math.round((L[0] - slide / 2) * 1000), startMs: Math.round((L[0] - slide) * 1000), endMs: Math.round(L[0] * 1000) }] : []),
    { kind: "flash", atMs: Math.round(flash * 1000) },
    { kind: "dissolve", atMs: Math.round((at(5) - slide - 0.2) * 1000) },
  ],
  variant,
  title: { text: variant === "landscape" ? "TRAIN HARD" : variant === "square" ? "STAY CURIOUS" : "GOLDEN HOUR", shot: 2 },
};
fs.writeFileSync(path.join(out, "truth.json"), JSON.stringify(truth, null, 1));
console.log(JSON.stringify({ reference, durationS: duration.toFixed(2), shots: shots.length, raw: raw.map((r) => r.name), seed }));
