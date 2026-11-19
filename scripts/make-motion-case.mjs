// Non-gym long-footage acceptance cases, generated (no people, no labels, no downloaded media):
//  cooking - a countertop seen from above: pour, stir, knife chop, finished dish, idle hands.
//  travel  - a generated city: walking pan, building reveal (tilt), passing vehicle, close-up
//            push-in, sunset hold, static street holds.
// Every action in the raw clips shares one look (the same counter, the same city) so look alone
// cannot pick the right moment; the reference is generated with a different palette, positions
// and speeds (±15%), so only how the picture moves can. truth.json records where each planted
// action is (per clip) and which action each reference shot shows.
// Usage: node scripts/make-motion-case.mjs cooking|travel OUT_DIR
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [kind, outArg] = process.argv.slice(2);
if (!["cooking", "travel"].includes(kind) || !outArg) throw Error("Usage: make-motion-case.mjs cooking|travel OUT_DIR");
const out = path.resolve(outArg);
fs.mkdirSync(path.join(out, "parts"), { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const W = 1280,
  H = 720,
  FPS = 30;
const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-y", ...args], { env, stdio: "inherit" });
const still = (file, w, h, geq) => run(["-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:d=1`, "-vf", `geq=${geq}`, "-frames:v", "1", file]);

// ---- Scenes: one generated still per look, animated by drawn shapes or a moving camera crop.
const looks = {};
if (kind === "cooking") {
  // Raw look: wooden counter, white bowl, cutting board. Reference look: grey marble, blue bowl.
  const counter = (r, g, b, bowl, board) =>
    `r='if(lt(hypot(X-640,Y-380),185),${bowl[0]},if(lt(hypot(X-640,Y-380),200),${bowl[0] - 35},if(between(X,900,1240)*between(Y,240,540),${board},${r})))':` +
    `g='if(lt(hypot(X-640,Y-380),185),${bowl[1]},if(lt(hypot(X-640,Y-380),200),${bowl[1] - 35},if(between(X,900,1240)*between(Y,240,540),${board - 30},${g})))':` +
    `b='if(lt(hypot(X-640,Y-380),185),${bowl[2]},if(lt(hypot(X-640,Y-380),200),${bowl[2] - 35},if(between(X,900,1240)*between(Y,240,540),${board - 70},${b})))'`;
  looks.raw = path.join(out, "parts", "counter-raw.png");
  looks.ref = path.join(out, "parts", "counter-ref.png");
  still(looks.raw, W, H, counter("110+25*sin(Y/7+3*sin(X/90))", "75+18*sin(Y/7+3*sin(X/90))", "45+10*sin(Y/7+3*sin(X/90))", [225, 222, 215], 205));
  still(looks.ref, W, H, counter("190+22*sin((X+Y)/37+2*sin(X/150))", "192+22*sin((X+Y)/37+2*sin(X/150))", "198+20*sin((X+Y)/37+2*sin(X/150))", [70, 85, 150], 170));
} else {
  // A wide generated city: sky gradient, buildings of pseudo-random height with windows, street.
  const city = (sky, wall, lit, street) =>
    `r='if(gt(Y,1400),${street},if(gt(Y,1600-(620+380*abs(sin(floor(X/170)*12.9898)))),if(lt(mod(X,42),14)*lt(mod(Y,56),22),${lit[0]},${wall[0]}+12*sin(floor(X/170))),${sky[0]}+(Y/1600)*${sky[3]}))':` +
    `g='if(gt(Y,1400),${street},if(gt(Y,1600-(620+380*abs(sin(floor(X/170)*12.9898)))),if(lt(mod(X,42),14)*lt(mod(Y,56),22),${lit[1]},${wall[1]}+12*sin(floor(X/170))),${sky[1]}+(Y/1600)*${sky[3]}))':` +
    `b='if(gt(Y,1400),${street},if(gt(Y,1600-(620+380*abs(sin(floor(X/170)*12.9898)))),if(lt(mod(X,42),14)*lt(mod(Y,56),22),${lit[2]},${wall[2]}+12*sin(floor(X/170))),${sky[2]}+(Y/1600)*${sky[3]}))'`;
  looks.raw = path.join(out, "parts", "city-raw.png");
  looks.ref = path.join(out, "parts", "city-ref.png");
  still(looks.raw, 3200, 1600, city([90, 140, 210, 60], [150, 140, 125], [235, 230, 190], 95));
  still(looks.ref, 3200, 1600, city([20, 25, 60, 40], [55, 55, 70], [255, 200, 90], 45));
}

// ---- Actions. s: speed factor, o: position offset (px). Each action is a filter on the looped
// still ("pre": a camera crop or static garnish) plus moving shapes, composited with overlay
// (evaluated every frame; drawbox expressions are not re-evaluated per frame).
const box = (color, w, h, x, y) => ({ color, w, h, x, y });
const actions =
  kind === "cooking"
    ? {
        // Pour: a stream from the top into the bowl, droplets falling (vertical, top-centre).
        pour: (s, o) => ({
          pre: `drawbox=x=${630 + o}:y=0:w=14:h=380:color=0xF0E8D0@0.9:t=fill`,
          shapes: [box("0xFFF8E8", 30, 28, `${622 + o}`, `mod(t*700*${s},380)`), box("0xFFF8E8", 26, 24, `${624 + o}`, `mod(t*700*${s}+190,380)`), box("0xE8DCC0", 60, 10, `${608 + o}+10*sin(2*PI*t*3*${s})`, "372")],
        }),
        // Stir: a spoon circling inside the bowl (periodic, centre).
        stir: (s, o) => ({
          pre: "null",
          shapes: [box("0x8A8A8A", 64, 16, `${610 + o}+95*cos(2*PI*t*1.25*${s})`, `${372 + o / 2}+95*sin(2*PI*t*1.25*${s})`), box("0x6A6A6A", 14, 80, `${636 + o}+95*cos(2*PI*t*1.25*${s})`, `${300 + o / 2}+95*sin(2*PI*t*1.25*${s})`)],
        }),
        // Knife chop: a blade going up and down quickly over the board (periodic vertical, right).
        chop: (s, o) => ({
          pre: "null",
          shapes: [box("0xC8CCD0", 210, 20, `${980 + o}`, `290+130*abs(sin(2*PI*t*2.2*${s}))`), box("0x303030", 70, 60, `${1150 + o}`, `270+130*abs(sin(2*PI*t*2.2*${s}))`)],
        }),
        // Finished dish: garnish in the bowl, a hand-free still.
        finished: (s, o) => ({ pre: `drawbox=x=${560 + o}:y=320:w=160:h=40:color=0x3C8C3C:t=fill,drawbox=x=${590 + o}:y=380:w=100:h=60:color=0xD04A2A:t=fill`, shapes: [] }),
        // Idle (distractor): a resting hand that barely moves.
        idle: (s, o) => ({ pre: "null", shapes: [box("0xD8A888", 160, 110, `${80 + o}+3*sin(2*PI*t*0.3)`, "560")] }),
      }
    : {
        walk: (s, o) => ({ pre: `crop=${W}:${H}:x='${400 + o}+95*t*${s}':y=760`, shapes: [box("0x202020", 40, 120, "620", `560+8*abs(sin(2*PI*t*1.6*${s}))`)] }),
        reveal: (s, o) => ({ pre: `crop=${W}:${H}:x=${1500 + o}:y='860-80*t*${s}'`, shapes: [] }),
        vehicle: (s, o) => ({ pre: `crop=${W}:${H}:x=${300 + o}:y=860`, shapes: [box("0xB02020", 240, 90, `-260+mod(760*t*${s},1800)`, "575"), box("0x902020", 150, 40, `-230+mod(760*t*${s},1800)`, "545")] }),
        detail: (s, o) => ({ pre: `zoompan=z='1.4+0.0025*${s}*on':x='${1700 + o}-iw/zoom/2':y='900-ih/zoom/2':d=1:s=${W}x${H}:fps=${FPS}`, shapes: [] }),
        sunset: (s, o) => ({ pre: `crop=${W}:${H}:x=${900 + o}:y=0,colorchannelmixer=rr=1.25:gg=0.75:bb=0.45`, shapes: [] }),
        // Static street hold (distractor), a different place each time.
        idle: (s, o) => ({ pre: `crop=${W}:${H}:x=${2000 + o}:y=860`, shapes: [] }),
      };

let partNo = 0;
// zoom: a tighter framing of the counter (each reference shot is its own camera set-up, so the
// reference has real cuts; the raw clips are one continuous camera).
function part(look, name, seconds, speed = 1, offset = 0, zoom = 1) {
  const file = path.join(out, "parts", `${String(partNo++).padStart(3, "0")}-${name}.mp4`);
  const { pre, shapes } = actions[name](speed, offset);
  const frame = kind === "cooking" && zoom !== 1 ? `crop=iw/${zoom}:ih/${zoom}:(iw-iw/${zoom})/2:(ih-ih/${zoom})/2,` : "";
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

// ---- Raw clips: planted actions (3.5 s; holds 4 s) separated by idle stretches.
const plans =
  kind === "cooking"
    ? {
        "cook-A": [["pour", 6], ["stir", 22], ["chop", 40], ["finished", 58], ["pour", 76]],
        "cook-B": [["stir", 8], ["chop", 26], ["finished", 44], ["stir", 61]],
      }
    : {
        "city-A": [["walk", 5], ["reveal", 22], ["vehicle", 40], ["detail", 57], ["sunset", 75]],
        "city-B": [["vehicle", 8], ["walk", 25], ["sunset", 42], ["reveal", 58], ["detail", 72]],
      };
const lengths = { "cook-A": 92, "cook-B": 78, "city-A": 92, "city-B": 88 };
const planted = [];
for (const [clip, plan] of Object.entries(plans)) {
  const files = [];
  let t = 0,
    idle = 0;
  for (const [name, at] of plan) {
    if (at > t) files.push(part(looks.raw, "idle", at - t, 1, (idle++ % 3) * 140));
    const seconds = name === "finished" || name === "sunset" ? 4 : 3.5;
    files.push(part(looks.raw, name, seconds));
    planted.push({ clip: clip + ".mp4", source: name, startMs: at * 1000, endMs: Math.round((at + seconds) * 1000) });
    t = at + seconds;
  }
  if (lengths[clip] > t) files.push(part(looks.raw, "idle", lengths[clip] - t, 1, 70));
  concat(files, path.join(out, clip + ".mp4"));
  console.log(clip, lengths[clip] + " s");
}

// ---- Reference: other instances of the same actions, different palette, positions and speeds.
const shots =
  kind === "cooking"
    ? [["pour", 1.6, 1.12, 30, 1.0], ["stir", 1.4, 0.88, -20, 1.2], ["chop", 1.2, 1.1, -40, 1.1], ["finished", 1.8, 1, 20, 1.25], ["stir", 1.5, 1.15, 25, 1.05], ["pour", 1.3, 0.9, -25, 1.15]]
    : [["walk", 1.8, 1.1, 300], ["reveal", 1.6, 0.9, -400], ["vehicle", 1.2, 1.12, 500], ["detail", 1.4, 0.88, -300], ["sunset", 2.0, 1, 400], ["vehicle", 1.3, 0.92, -200]];
const reference = path.join(out, `reference-${kind}.mp4`);
concat(
  shots.map(([name, seconds, speed, offset, zoom]) => part(looks.ref, name, seconds, speed, offset, zoom ?? 1)),
  reference,
  path.resolve("work/gym/music.wav"),
);
fs.writeFileSync(
  path.join(out, "truth.json"),
  JSON.stringify({ kind, reference, rawCuts: kind === "travel", planted, shots: shots.map(([source, lengthS, speed, offset]) => ({ source, lengthS, speed, offset, expected: planted.filter((p) => p.source === source) })) }, null, 2),
);
console.log("reference", reference);
