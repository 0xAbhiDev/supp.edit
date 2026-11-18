// Generate an offline reference corpus with exact ground truth. Every picture comes from ffmpeg's
// built-in generators and every sound from packages/ai/audio/synth.ts, so nothing copyrighted or
// downloaded is needed. Each case is a structurally different editing style; its truth.json says
// where every cut, title, flash, beat, impact, silence, sweep and sung word was placed.
// Usage: node scripts/make-reference-corpus.mjs OUT_DIR
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { mediaEnvironment } from "./runtime.mjs";
const out = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Supply an output directory.");
fs.mkdirSync(out, { recursive: true });
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const FPS = 30,
  RATE = 44100,
  frameMs = (f) => (f * 1000) / FPS,
  toFrame = (ms) => Math.round((ms * FPS) / 1000);
const font = "C\\:/Windows/Fonts/arialbd.ttf";
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
const { synthesize, place, wav } = await host.ssrLoadModule("/packages/ai/audio/synth.ts");

/** A sung syllable: harmonics with vibrato and a soft attack/release. */
function voice(ms, f0, seed) {
  const n = Math.round((RATE * ms) / 1000),
    v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE,
      env = Math.min(1, t / 0.015) * Math.min(1, (n - i) / (RATE * 0.08)),
      f = f0 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t + seed));
    let s = 0;
    for (let k = 1; k <= 6; k++) s += Math.sin(2 * Math.PI * f * k * t + k * seed) / k ** 1.3;
    v[i] = 0.35 * env * s;
  }
  return v;
}
const sources = [
  (w, h, k) => `gradients=s=${w}x${h}:r=${FPS}:speed=0.03:seed=${k + 3}:n=4`,
  (w, h) => `mandelbrot=s=${w}x${h}:r=${FPS}`,
  (w, h, k) => `life=s=${w}x${h}:r=${FPS}:mold=10:ratio=0.18:seed=${k}:life_color=#5ef0a0:death_color=#1c2450:mold_color=#203070`,
  (w, h) => `cellauto=s=${w}x${h}:r=${FPS}:rule=110:scroll=1`,
  (w, h) => `testsrc2=s=${w}x${h}:r=${FPS}`,
];
const quote = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function render(name, c) {
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  const totalFrames = toFrame(c.durationMs),
    cutFrames = c.cuts.map((x) => toFrame(x.ms)),
    bounds = [0, ...cutFrames, totalFrames];
  // ---- audio
  const left = new Float32Array(Math.round((RATE * c.durationMs) / 1000));
  c.sound(left);
  for (const [a, b] of c.silences ?? []) left.fill(0, Math.round((a * RATE) / 1000), Math.round((b * RATE) / 1000));
  const peak = left.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  for (let i = 0; i < left.length; i++) left[i] *= 0.89 / peak;
  // The audible gap: from the last sample above −50 dBFS before the muted span to the first after it.
  const audible = (c.silences ?? []).map(([a, b]) => {
    let i = Math.round((a * RATE) / 1000),
      j = Math.round((b * RATE) / 1000);
    while (i > 0 && Math.abs(left[i - 1]) < 0.00316) i--;
    while (j < left.length && Math.abs(left[j]) < 0.00316) j++;
    return { startMs: Math.round((i * 1000) / RATE), endMs: Math.round((j * 1000) / RATE), mutedFromMs: a, mutedToMs: b };
  });
  const right = left.map((v, i) => v * (c.stereo ? 0.7 + 0.3 * Math.cos((i / RATE) * 0.9) : 1));
  fs.writeFileSync(path.join(dir, "audio.wav"), wav([left, right], RATE));
  // ---- pictures: one generator per shot, trimmed to whole frames, joined, then bars, flashes, text
  const pw = c.width,
    ph = c.height - 2 * (c.bars ?? 0);
  const inputs = [],
    chains = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const frames = bounds[k + 1] - bounds[k];
    inputs.push("-f", "lavfi", "-t", String(frames / FPS + 1), "-i", sources[(k + c.sourceShift) % sources.length](pw, ph, k));
    chains.push(`[${k}:v]trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p,setsar=1,pad=${c.width}:${c.height}:0:${c.bars ?? 0}:black[s${k}]`);
  }
  let graph = chains.join(";\n") + ";\n" + chains.map((_, k) => `[s${k}]`).join("") + `concat=n=${chains.length}:v=1:a=0[cat]`;
  const overlays = [];
  for (const f of c.flashes ?? []) overlays.push(`drawbox=x=0:y=0:w=iw:h=ih:color=white@1:t=fill:enable='between(n,${toFrame(f.startMs)},${toFrame(f.endMs) - 1})'`);
  for (const t of [...(c.titles ?? []), ...(c.captions ?? [])])
    overlays.push(
      `drawtext=fontfile='${font}':text='${quote(t.text)}':fontsize=${t.size}:fontcolor=${t.color}:borderw=${t.border ?? 0}:bordercolor=black:x=(w-text_w)/2:y=${t.y}:enable='between(n,${toFrame(t.startMs)},${toFrame(t.endMs) - 1})'`,
    );
  graph += overlays.length ? ";\n[cat]" + overlays.join(",") + "[out]" : ";\n[cat]null[out]";
  fs.writeFileSync(path.join(dir, "graph.txt"), graph);
  const movie = path.join(dir, name + ".mp4");
  execFileSync(
    ffmpeg,
    ["-v", "error", "-y", ...inputs, "-i", path.join(dir, "audio.wav"), "-/filter_complex", path.join(dir, "graph.txt"), "-map", "[out]", "-map", `${inputs.length / 6}:a`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "192k", "-t", String(c.durationMs / 1000), movie],
    { env, stdio: "inherit" },
  );
  fs.rmSync(path.join(dir, "audio.wav"));
  const truth = {
    name,
    file: movie,
    width: c.width,
    height: c.height,
    fps: FPS,
    durationMs: c.durationMs,
    bars: c.bars ?? 0,
    tempoBpm: c.bpm,
    beats: c.beats.map(Math.round),
    downbeats: c.beats.filter((_, i) => i % 4 === 0).map(Math.round),
    impacts: (c.impacts ?? []).map(Math.round),
    silences: audible,
    // A whoosh swells and falls away; the moment it lands is its peak.
    whooshes: (c.whooshes ?? []).map((w) => ({ ...w, peakMs: Math.round((w.startMs + w.endMs) / 2) })),
    risers: c.risers ?? [],
    drops: c.drops ?? [],
    words: c.words ?? [],
    // Cut times are frame-exact; trigger and relation say how each was placed.
    cuts: c.cuts.map((x) => ({ ms: Math.round(frameMs(toFrame(x.ms))), trigger: x.trigger, relation: x.relation })),
    titles: (c.titles ?? []).map((t) => ({ text: t.text, startMs: Math.round(frameMs(toFrame(t.startMs))), endMs: Math.round(frameMs(toFrame(t.endMs))), trigger: t.trigger })),
    captions: (c.captions ?? []).map((t) => ({ text: t.text, startMs: Math.round(frameMs(toFrame(t.startMs))), endMs: Math.round(frameMs(toFrame(t.endMs))) })),
    flashes: (c.flashes ?? []).map((f) => ({ startMs: Math.round(frameMs(toFrame(f.startMs))), endMs: Math.round(frameMs(toFrame(f.endMs))), trigger: f.trigger })),
    style: c.style,
  };
  fs.writeFileSync(path.join(dir, "truth.json"), JSON.stringify(truth, null, 2));
  console.log(name, "→", movie);
}

// ---- S1: landscape letterbox, sung words as captions, a sweep into a title, a cut after an impact,
// an offbeat cut, a silence. Slow, lyric-led pacing.
{
  const bpm = 96,
    beat = 60000 / bpm,
    durationMs = 12000;
  const beats = [];
  for (let t = 0; t < durationMs - 200; t += beat) beats.push(t);
  const words = [
    { text: "we", startMs: 1250, endMs: 1500 },
    { text: "rise", startMs: 1875, endMs: 2300 },
    { text: "and", startMs: 3125, endMs: 3300 },
    { text: "we", startMs: 3750, endMs: 3950 },
    { text: "fall", startMs: 4375, endMs: 4800 },
    { text: "again", startMs: 8125, endMs: 8700 },
    { text: "tonight", startMs: 10000, endMs: 10600 },
  ];
  const silences = [[7400, 7900]],
    impacts = [9000],
    whooshes = [{ startMs: 5400, endMs: 6000 }];
  render("s1-letterbox-lyrics", {
    width: 1280,
    height: 720,
    bars: 90,
    sourceShift: 0,
    durationMs,
    bpm,
    beats,
    words,
    silences,
    impacts,
    whooshes,
    stereo: true,
    style: "Landscape letterbox; captions word by word on sung syllables; a sweep into a title; one cut after an impact; one offbeat cut; slow pacing.",
    cuts: [
      { ms: 2500, trigger: "downbeat", relation: "on" },
      { ms: 4375 + beat / 2, trigger: "beat", relation: "offbeat" },
      { ms: 5700, trigger: "whoosh_peak", relation: "on" },
      { ms: 9066, trigger: "impact", relation: "after" },
    ],
    titles: [{ text: "NEW HEIGHTS", startMs: 5700, endMs: 7300, size: 110, color: "#ffd23f", y: "(h-text_h)/2", border: 0, trigger: "whoosh_peak" }],
    captions: words.map((w) => ({ ...w, endMs: w.endMs + 150, size: 46, color: "white", border: 3, y: "h-90-80" })),
    sound(left) {
      beats.forEach((t, k) => {
        place(left, synthesize("kick", RATE, k + 1), RATE, t, k % 4 === 0 ? 0.5 : 0.35);
        place(left, synthesize("hat", RATE, 50 + k), RATE, t + beat / 2, 0.12);
      });
      words.forEach((w, k) => place(left, voice(w.endMs - w.startMs, [220, 247, 262, 294][k % 4], k), RATE, w.startMs, 0.8));
      place(left, synthesize("whoosh", RATE, 5, 600), RATE, 5400, 0.7);
      place(left, synthesize("impact", RATE, 9), RATE, 9000, 1);
    },
  });
}

// ---- S2: vertical montage, cuts every two beats on kicks, flashes on impacts, a riser into a
// drop, titles on downbeats. Fast, beat-led pacing.
{
  const bpm = 128,
    beat = 60000 / bpm,
    durationMs = 10000;
  const beats = [];
  for (let t = 0; t < durationMs - 200; t += beat) beats.push(t);
  const impacts = [beats[8], beats[16]],
    risers = [{ startMs: Math.round(beats[10]), endMs: Math.round(beats[16]) }],
    drops = [Math.round(beats[16])];
  const cuts = [];
  for (let k = 2; k < beats.length; k += 2) cuts.push({ ms: beats[k], trigger: impacts.includes(beats[k]) ? "impact" : k % 4 === 0 ? "downbeat" : "kick", relation: "on" });
  render("s2-vertical-montage", {
    width: 720,
    height: 1280,
    sourceShift: 2,
    durationMs,
    bpm,
    beats,
    impacts,
    risers,
    drops,
    style: "Vertical; a cut every two beats on the kick; white flashes on impacts; a riser into a drop; titles on downbeats; fast pacing.",
    cuts,
    flashes: impacts.map((t) => ({ startMs: t, endMs: t + 67, trigger: "impact" })),
    titles: [
      { text: "PUSH", startMs: beats[4], endMs: beats[6], size: 150, color: "white", y: "(h-text_h)/2", border: 6, trigger: "downbeat" },
      { text: "HARDER", startMs: beats[16], endMs: beats[20], size: 130, color: "#ff3b3b", y: "(h-text_h)/2", border: 6, trigger: "drop" },
    ],
    sound(left) {
      beats.forEach((t, k) => {
        const loud = t >= drops[0] ? 1 : 0.7;
        place(left, synthesize("kick", RATE, k + 1), RATE, t, 0.55 * loud);
        if (k % 2 === 1) place(left, synthesize("snare", RATE, 80 + k), RATE, t, 0.4 * loud);
        place(left, synthesize("hat", RATE, 200 + k), RATE, t + beat / 2, 0.15);
      });
      for (const t of impacts) place(left, synthesize("impact", RATE, Math.round(t)), RATE, t, 1);
      place(left, synthesize("riser", RATE, 3, risers[0].endMs - risers[0].startMs), RATE, risers[0].startMs, 0.5);
      for (let i = Math.round((drops[0] * RATE) / 1000); i < left.length; i++) left[i] += 0.18 * Math.sin((2 * Math.PI * 49 * i) / RATE);
    },
  });
}
await host.close();
