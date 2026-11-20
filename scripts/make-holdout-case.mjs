// Held-out generalization cases, written after the engine was finished and never used to tune it:
//  workshop - a top-down bench: saw strokes (left-right), hammer strikes (up-down), a drill
//             spinning in place, sanding in wide circles, a still product shot, idle hands.
//  street   - a generated street: a cyclist crossing right to left, a lift rising, a camera pan,
//             a pull-out zoom, a still skyline hold, static street holds.
// The raw clips share one look; the reference uses another palette, positions, speeds (±15%) and,
// for the bench, a different framing per shot. truth.json records where each action is planted.
// Usage: node scripts/make-holdout-case.mjs workshop|street OUT_DIR
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [kind, outArg] = process.argv.slice(2);
if (!["workshop", "street"].includes(kind) || !outArg) throw Error("Usage: make-holdout-case.mjs workshop|street OUT_DIR");
const out = path.resolve(outArg);
fs.mkdirSync(path.join(out, "parts"), { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const W = 1280,
  H = 720,
  FPS = 30;
const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-y", ...args], { env, stdio: "inherit" });
const still = (file, w, h, geq) => run(["-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:d=1`, "-vf", `geq=${geq}`, "-frames:v", "1", file]);
const looks = {};
if (kind === "workshop") {
  // A cutting mat with a grid, a board on the right, a metal plate on the left.
  const bench = (mat, grid, board, plate) =>
    ["r", "g", "b"]
      .map(
        (ch, k) =>
          `${ch}='if(between(X,860,1220)*between(Y,180,620),${board[k]}+8*sin(Y/5),if(between(X,60,420)*between(Y,120,560),${plate[k]}+6*sin((X+Y)/9),if(lt(mod(X,64),3)+lt(mod(Y,64),3),${grid[k]},${mat[k]})))'`,
      )
      .join(":");
  looks.raw = path.join(out, "parts", "bench-raw.png");
  looks.ref = path.join(out, "parts", "bench-ref.png");
  still(looks.raw, W, H, bench([60, 105, 80], [90, 140, 110], [190, 150, 105], [150, 152, 158]));
  still(looks.ref, W, H, bench([200, 110, 50], [225, 140, 80], [110, 75, 45], [95, 95, 105]));
} else {
  // A street of low blocks under a sky band; raw by day, reference at dusk.
  const street = (sky, wall, win, road) =>
    ["r", "g", "b"]
      .map(
        (ch, k) =>
          `${ch}='if(gt(Y,1300),${road[k]},if(gt(Y,1300-(380+300*abs(sin(floor(X/130)*7.31)))),if(lt(mod(X,36),12)*lt(mod(Y,48),18),${win[k]},${wall[k]}+10*sin(floor(X/130))),${sky[k]}+(Y/1300)*40))'`,
      )
      .join(":");
  looks.raw = path.join(out, "parts", "street-raw.png");
  looks.ref = path.join(out, "parts", "street-ref.png");
  still(looks.raw, 3000, 1500, street([120, 165, 220], [175, 160, 140], [220, 225, 230], [90, 90, 92]));
  still(looks.ref, 3000, 1500, street([60, 45, 90], [80, 70, 75], [255, 190, 110], [40, 40, 45]));
}
const box = (color, w, h, x, y) => ({ color, w, h, x, y });
const actions =
  kind === "workshop"
    ? {
        saw: (s, o) => ({ pre: "null", shapes: [box("0xD0D4D8", 220, 18, `${830 + o}+120*sin(2*PI*t*2.4*${s})`, "500"), box("0x7A3B1F", 60, 40, `${1050 + o}+120*sin(2*PI*t*2.4*${s})`, "490")] }),
        hammer: (s, o) => ({ pre: "null", shapes: [box("0x404448", 70, 44, `${210 + o}`, `180+170*max(0,sin(2*PI*t*1.3*${s}))`), box("0x8B5A2B", 18, 120, `${236 + o}`, `60+170*max(0,sin(2*PI*t*1.3*${s}))`)] }),
        drill: (s, o) => ({ pre: `drawbox=x=${520 + o}:y=330:w=90:h=90:color=0x303030:t=fill`, shapes: [box("0xE8C030", 26, 10, `${552 + o}+28*cos(2*PI*t*4.5*${s})`, `370+28*sin(2*PI*t*4.5*${s})`)] }),
        sand: (s, o) => ({ pre: "null", shapes: [box("0xC89060", 120, 70, `${980 + o}+140*cos(2*PI*t*0.6*${s})`, `330+70*sin(2*PI*t*0.6*${s})`)] }),
        product: (s, o) => ({ pre: `drawbox=x=${560 + o}:y=260:w=200:h=200:color=0xE04040:t=fill,drawbox=x=${600 + o}:y=300:w=120:h=120:color=0xF0F0F0:t=fill`, shapes: [] }),
        idle: (s, o) => ({ pre: "null", shapes: [box("0xD8A888", 150, 100, `${90 + o}+3*sin(2*PI*t*0.3)`, "600")] }),
      }
    : {
        cyclist: (s, o) => ({ pre: `crop=${W}:${H}:x=${500 + o}:y=780`, shapes: [box("0x2050C0", 90, 110, `1400-mod(520*t*${s},1700)`, "470"), box("0x101010", 110, 30, `1390-mod(520*t*${s},1700)`, "580")] }),
        lift: (s, o) => ({ pre: `crop=${W}:${H}:x=${1400 + o}:y=700`, shapes: [box("0xC0C0C8", 120, 160, "580", `560-90*t*${s}`)] }),
        pan: (s, o) => ({ pre: `crop=${W}:${H}:x='${1700 + o}-110*t*${s}':y=700`, shapes: [] }),
        pullout: (s, o) => ({ pre: `zoompan=z='1.7-0.0035*${s}*on':x='${1200 + o}-iw/zoom/2':y='950-ih/zoom/2':d=1:s=${W}x${H}:fps=${FPS}`, shapes: [] }),
        skyline: (s, o) => ({ pre: `crop=${W}:${H}:x=${300 + o}:y=0`, shapes: [] }),
        idle: (s, o) => ({ pre: `crop=${W}:${H}:x=${2100 + o}:y=780`, shapes: [] }),
      };
let partNo = 0;
function part(look, name, seconds, speed = 1, offset = 0, zoom = 1) {
  const file = path.join(out, "parts", `${String(partNo++).padStart(3, "0")}-${name}.mp4`);
  const { pre, shapes } = actions[name](speed, offset);
  const frame = kind === "workshop" && zoom !== 1 ? `crop=iw/${zoom}:ih/${zoom}:(iw-iw/${zoom})/2:(ih-ih/${zoom})/2,` : "";
  const inputs = ["-loop", "1", "-framerate", String(FPS), "-t", String(seconds), "-i", look];
  const chain = [`[0:v]${pre},fps=${FPS},setpts=N/${FPS}/TB[s0]`];
  shapes.forEach((sh, k) => {
    inputs.push("-f", "lavfi", "-t", String(seconds), "-i", `color=c=${sh.color}:s=${sh.w}x${sh.h}:r=${FPS}`);
    chain.push(`[s${k}][${k + 1}:v]overlay=x='${sh.x}':y='${sh.y}':eval=frame:shortest=1[s${k + 1}]`);
  });
  chain.push(`[s${shapes.length}]${frame}scale=${W}:${H},setsar=1,format=yuv420p[out]`);
  run([...inputs, "-filter_complex", chain.join(";"), "-map", "[out]", "-t", String(seconds), "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-r", String(FPS), file]);
  return file;
}
function concat(files, target, audio) {
  const list = path.join(out, "parts", path.basename(target) + ".txt");
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  run(["-f", "concat", "-safe", "0", "-i", list, ...(audio ? ["-i", audio] : []), "-map", "0:v", ...(audio ? ["-map", "1:a", "-c:a", "aac", "-shortest"] : []), "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-r", String(FPS), "-pix_fmt", "yuv420p", target]);
}
const plans =
  kind === "workshop"
    ? { "bench-A": [["hammer", 9], ["saw", 30], ["product", 52], ["sand", 70]], "bench-B": [["drill", 6], ["saw", 24], ["hammer", 45], ["drill", 66]] }
    : { "street-A": [["pan", 7], ["cyclist", 26], ["skyline", 44], ["lift", 63]], "street-B": [["pullout", 5], ["lift", 22], ["cyclist", 40], ["pan", 58]] };
const lengths = { "bench-A": 86, "bench-B": 82, "street-A": 82, "street-B": 76 };
const planted = [];
for (const [clip, plan] of Object.entries(plans)) {
  const files = [];
  let t = 0,
    idle = 0;
  for (const [name, at] of plan) {
    if (at > t) files.push(part(looks.raw, "idle", at - t, 1, (idle++ % 3) * 120));
    const seconds = name === "product" || name === "skyline" ? 4 : 3.5;
    files.push(part(looks.raw, name, seconds));
    planted.push({ clip: clip + ".mp4", source: name, startMs: at * 1000, endMs: Math.round((at + seconds) * 1000) });
    t = at + seconds;
  }
  if (lengths[clip] > t) files.push(part(looks.raw, "idle", lengths[clip] - t, 1, 60));
  concat(files, path.join(out, clip + ".mp4"));
  console.log(clip, lengths[clip] + " s");
}
const shots =
  kind === "workshop"
    ? [["saw", 1.5, 1.1, -30, 1.0], ["hammer", 1.3, 0.9, 25, 1.15], ["drill", 1.2, 1.12, -20, 1.2], ["product", 1.8, 1, 30, 1.1], ["sand", 1.6, 0.88, 20, 1.05], ["hammer", 1.2, 1.1, -15, 1.0]]
    : [["cyclist", 1.6, 1.12, 200, 1], ["lift", 1.5, 0.9, -300, 1], ["pan", 1.7, 1.1, 250, 1], ["skyline", 1.8, 1, -150, 1], ["pullout", 1.5, 0.9, 200, 1], ["cyclist", 1.3, 0.88, -250, 1]];
const reference = path.join(out, `reference-${kind}.mp4`);
concat(
  shots.map(([name, seconds, speed, offset, zoom]) => part(looks.ref, name, seconds, speed, offset, zoom)),
  reference,
  path.resolve("work/gym/music.wav"),
);
fs.writeFileSync(
  path.join(out, "truth.json"),
  JSON.stringify({ kind, holdout: true, reference, rawCuts: kind === "street", planted, shots: shots.map(([source, lengthS, speed, offset]) => ({ source, lengthS, speed, offset })) }, null, 2),
);
console.log("reference", reference);
