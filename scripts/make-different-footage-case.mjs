// A different-footage case: the reference is cut from one set of real recordings, the raw footage
// supplied with it is a different set of real recordings. Some reference shots have an adequate
// counterpart in the raw footage (another recording of the same kind of subject and action), some
// have none. Nothing here says which raw moments are acceptable: that is labelled by a person from
// the raw footage itself (labels.json, written before any build runs) and graded afterwards.
//
// The reference: 7 shots (seeded windows inside each source's usable stretch), a warm grade, a
// random reframe and ±10% speed per shot, a title, a white flash and a dissolve, over music.
// reference-shots.json records which reference-side recording each shot came from (what the shot
// shows), for the labeller.
// Usage: node scripts/make-different-footage-case.mjs OUT_DIR [SEED]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const out = path.resolve(process.argv[2] ?? "test-results/footage/different42");
const seed = Number(process.argv[3] ?? Date.now() % 2147483647);
fs.mkdirSync(path.join(out, "parts"), { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-y", ...args], { env, stdio: "inherit" });
let state = seed;
const rand = () => (state = (state * 48271) % 2147483647) / 2147483647;
// Reference side: what each shot shows comes from these recordings (none is supplied as raw).
const referenceSide = [
  { file: "work/reference-advanced/cloudy-beach.webm", shows: "sea, waves, beach under cloud", stretch: [0.5, 11.6] },
  { file: "work/gym/incline.webm", shows: "a barbell press lying on an incline bench (one repetition)", stretch: [0.5, 5.5] },
  { file: "work/flower.mp4", shows: "a flower close-up", stretch: [0.3, 4.8] },
  { file: "work/gym/row.webm", shows: "a bent-over barbell row", stretch: [0.5, 4.7] },
  { file: "work/reference-advanced/coastal-reference.webm", shows: "a rocky coastline and sea", stretch: [3.95, 6.2] },
  { file: "work/gym/incline.webm", shows: "a barbell press lying on an incline bench (another repetition)", stretch: [0.5, 5.5] },
  { file: "work/reframe-scenarios/two.mp4", shows: "two people in conversation", stretch: [0.2, 2.9] },
];
// Raw side: different recordings, supplied unchanged.
const rawSide = ["work/gym/bench.webm", "work/gym/deadlift.webm", "work/vision/squat.webm", "work/reference-advanced/forster-beach.webm"];
for (const f of rawSide) fs.copyFileSync(path.resolve(f), path.join(out, "raw-" + path.basename(f)));
const W = 1280,
  H = 720,
  FPS = 30;
const shots = [];
const used = [];
for (const r of referenceSide) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const length = 1.2 + rand() * 0.6,
      speed = 0.9 + rand() * 0.2,
      span = length * speed;
    const [a, b] = r.stretch;
    if (b - a < span + 0.1) continue;
    const start = a + rand() * (b - a - span);
    if (used.some((u) => u.file === r.file && start < u.end + 0.8 && start + span > u.start - 0.8)) continue;
    used.push({ file: r.file, start, end: start + span });
    shots.push({ ...r, srcStart: start, srcEnd: start + span, length, speed, zoom: 1 + rand() * 0.25, xShift: rand() * 0.6 - 0.3 });
    break;
  }
}
const parts = shots.map((s, k) => {
  const f = path.join(out, "parts", `shot${k}.mp4`);
  const crop = `scale=${W}*${s.zoom.toFixed(3)}:${H}*${s.zoom.toFixed(3)}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*(0.5+${(s.xShift / 2).toFixed(3)}):(ih-${H})/2`;
  const grade = "eq=saturation=1.2:contrast=1.06:gamma=0.96,colorbalance=rs=0.07:gs=0.02:bs=-0.07:rh=0.05:bh=-0.05";
  const title = k === 1 ? ",drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='KEEP GOING':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=h*0.8:shadowcolor=black@0.6:shadowx=3:shadowy=3" : "";
  run(["-ss", s.srcStart.toFixed(3), "-t", (s.srcEnd - s.srcStart).toFixed(3), "-i", path.resolve(s.file), "-vf", `setpts=PTS-STARTPTS,setpts=PTS/${s.speed.toFixed(4)},fps=${FPS},${crop},${grade}${title},setsar=1,format=yuv420p`, "-t", s.length.toFixed(3), "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", f]);
  return f;
});
const L = shots.map((s) => s.length);
const at = (i) => L.slice(0, i).reduce((x, y) => x + y, 0);
const n = parts.length;
const g = parts.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},settb=AVTB[s${i}]`);
g.push(`${parts.slice(0, n - 1).map((_, i) => `[s${i}]`).join("")}concat=n=${n - 1}:v=1:a=0,settb=AVTB[a0]`);
g.push(`[a0][s${n - 1}]xfade=transition=fade:duration=0.4:offset=${(at(n - 1) - 0.4).toFixed(3)}[a1]`);
const flash = at(3);
g.push(`color=white:s=${W}x${H}:r=${FPS}:d=30,format=rgba,fade=t=in:st=${(flash - 0.1).toFixed(3)}:d=0.1:alpha=1,fade=t=out:st=${flash.toFixed(3)}:d=0.1:alpha=1[fl]`);
g.push(`[a1][fl]overlay=shortest=1,format=yuv420p[v]`);
const duration = at(n) - 0.4;
const reference = path.join(out, "reference.mp4");
run([...parts.flatMap((f) => ["-i", f]), "-i", path.resolve("work/gym/music.wav"), "-filter_complex", g.join(";"), "-map", "[v]", "-map", `${n}:a`, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-t", duration.toFixed(3), "-r", String(FPS), reference]);
// What each reference shot shows and where it sits in the reference (for the labeller).
let cursor = 0;
const described = shots.map((s, k) => {
  const length = k === n - 2 || k === n - 1 ? s.length - 0.2 : s.length;
  const row = { shot: k + 1, startMs: Math.round(cursor * 1000), endMs: Math.round((cursor + length) * 1000), shows: s.shows, from: path.basename(s.file), sourceStartMs: Math.round(s.srcStart * 1000), sourceEndMs: Math.round(s.srcEnd * 1000), speed: Number(s.speed.toFixed(3)) };
  cursor += length;
  return row;
});
fs.writeFileSync(path.join(out, "reference-shots.json"), JSON.stringify({ seed, reference, durationMs: Math.round(duration * 1000), raw: rawSide.map((f) => "raw-" + path.basename(f)), shots: described, transitions: [{ kind: "flash", atMs: Math.round(flash * 1000) }, { kind: "dissolve", atMs: Math.round((at(n - 1) - 0.2) * 1000) }], title: { text: "KEEP GOING", shot: 2 } }, null, 1));
console.log(JSON.stringify({ reference, durationS: duration.toFixed(2), shots: shots.length, seed }));
