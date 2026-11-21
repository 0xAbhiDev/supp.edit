// Generated effects in a recreation, measured on isolated tracks rebuilt from the saved project.
//
// A finished mix cannot separate an effect from music under it (subtracting two nearly equal
// powers is unstable), so each audio layer — supplied music and generated effects — is rebuilt
// from its own source file with its clip gain, its gain keys (dB, linear between keys) and its
// placement, at 22.05 kHz mono (the planner's audio-analysis domain). The rebuilt mix is then
// compared with the decoded export to show the rebuild is what the app rendered.
//
// Per effect, with the planner's own windows (effectWindows) on the timeline clock:
//  - timingErrorMs: the isolated effect's 100 ms RMS peak − where the note says it lands;
//  - ownOverBedDb: isolated effect peak (peak window) − median isolated music (bed window);
//  - plannedOwnDb: the reference relation the plan aimed at (the bed's share of the reference mix
//    peak removed); levelErrorDb = ownOverBedDb − plannedOwnDb;
//  - overMusicAtPeakDb: isolated effect − isolated music at the effect's peak (masking check).
// Usage: node scripts/measure-effect-tracks.mjs RENDER.mp4 SAVED.supp [OUT.json]
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [render, project, outFile] = process.argv.slice(2);
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const RATE = 22050;
const pcm = (args) => {
  const raw = execFileSync(ffmpeg, ["-v", "error", ...args, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { env, maxBuffer: 512 * 1024 * 1024 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
};
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
/** 100 ms RMS dBFS every 10 ms (centre times). */
const envelope = (x) => {
  const w = Math.round(RATE / 10),
    hop = Math.round(RATE / 100),
    out = [];
  for (let i = 0; i + w <= x.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + w; k++) s += x[k] * x[k];
    out.push({ t: ((i + w / 2) * 1000) / RATE, db: db(Math.sqrt(s / w)) });
  }
  return out;
};
const p = JSON.parse(fs.readFileSync(project, "utf8"));
const c = p.compositions.find((x) => x.ai?.audioMode) ?? p.compositions.at(-1);
const f = c.settings?.fps ?? p.settings.fps,
  fps = f.num / f.den;
const total = Math.ceil((c.duration / fps) * RATE);
const clean = (path) => (path.startsWith("\\\\?\\") ? path.slice(4) : path);
const assetOf = (l) => p.assets.find((a) => a.id === l.assetId);
const audioTracks = new Set(c.tracks.filter((t) => t.kind === "audio").map((t) => t.id));
/** One layer rebuilt on the timeline: source segment × gain (clip gain, or keys in dB). */
function rebuild(l) {
  const a = assetOf(l);
  const x = new Float32Array(total);
  const seg = pcm(["-ss", (l.sourceIn / fps).toFixed(4), "-t", (l.duration / fps).toFixed(4), "-i", clean(a.path)]);
  const keys = (l.keyframes?.gain ?? []).map((k) => [k.frame, k.value]);
  const gainAt = (frame) => {
    if (!keys.length) return l.gain ?? 0;
    if (frame <= keys[0][0]) return keys[0][1];
    for (let j = 1; j < keys.length; j++)
      if (frame <= keys[j][0]) return keys[j][0] === keys[j - 1][0] ? keys[j][1] : keys[j - 1][1] + ((keys[j][1] - keys[j - 1][1]) * (frame - keys[j - 1][0])) / (keys[j][0] - keys[j - 1][0]);
    return keys.at(-1)[1];
  };
  const s0 = Math.round((l.start / fps) * RATE);
  for (let i = 0; i < seg.length && s0 + i < total; i++) x[s0 + i] = seg[i] * 10 ** (gainAt((i * fps) / RATE) / 20);
  return x;
}
const layers = c.layers.filter((l) => audioTracks.has(l.trackId) && l.kind === "media" && assetOf(l));
const effects = layers.filter((l) => /^supp-generated-/.test(assetOf(l).name));
const others = layers.filter((l) => !effects.includes(l));
const music = new Float32Array(total);
for (const l of others) rebuild(l).forEach((v, i) => (music[i] += v));
const effectTracks = effects.map((l) => ({ l, x: rebuild(l) }));
const mix = Float32Array.from(music);
for (const e of effectTracks) e.x.forEach((v, i) => (mix[i] += v));
// The rebuild against the export: per 100 ms window level difference, where the mix is audible.
const exported = pcm(["-i", render]);
const em = envelope(mix),
  ee = envelope(exported);
const diffs = em.map((q, i) => (ee[i] && q.db > -60 ? Math.abs(q.db - ee[i].db) : null)).filter((v) => v !== null).sort((a, b) => a - b);
const median = (v) => v[v.length >> 1];
const fidelity = { windows: diffs.length, medianAbsDiffDb: Number(median(diffs).toFixed(2)), p90AbsDiffDb: Number(diffs[Math.floor(diffs.length * 0.9)].toFixed(2)) };
let samplePeak = 0;
for (const v of exported) samplePeak = Math.max(samplePeak, Math.abs(v));
const musicEnv = envelope(music);
const ownRelation = (d) => {
  const q = 10 ** (d / 10) - 1;
  return Math.max(-12, q > 0 ? 10 * Math.log10(q) : -12);
};
const windows = (rising, onset, landing) => (rising ? { peak: [landing - 250, landing + 50], bed: [onset - 2000, onset - 100] } : { peak: [landing - 100, landing + 400], bed: [landing - 2000, landing - 300] });
const rows = [];
for (const note of c.ai?.audioNotes ?? []) {
  const m = /Generated (\w+) at ([\d.]+) s(?: \(lands ([\d.]+) s\))?, (-?[\d.]+) dB \(reference ([+-]?[\d.]+) dB over its music/.exec(note);
  if (!m) continue;
  const kind = m[1],
    start = Number(m[2]) * 1000,
    landing = m[3] ? Number(m[3]) * 1000 : null;
  const e = effectTracks.find((t) => Math.abs((t.l.start / fps) * 1000 - start) < 40 && assetOf(t.l).name.includes(kind));
  if (!e) continue;
  const env = envelope(e.x);
  const top = env.reduce((a, b) => (b.db > a.db ? b : a));
  const rising = kind === "whoosh" || kind === "riser";
  const w = windows(rising, start, landing ?? (rising ? top.t : start));
  const inW = (list, [a, b]) => list.filter((q) => q.t >= a && q.t <= b);
  const peakDb = Math.max(...inW(env, w.peak).map((q) => q.db));
  const bed = inW(musicEnv, w.bed).map((q) => q.db).sort((a, b) => a - b);
  const bedDb = median(bed);
  const musicAtPeak = musicEnv.reduce((a, b) => (Math.abs(b.t - top.t) < Math.abs(a.t - top.t) ? b : a)).db;
  const planned = ownRelation(Number(m[5]));
  rows.push({
    kind,
    startMs: Math.round(start),
    landsAtMs: landing === null ? null : Math.round(landing),
    peakAtMs: Math.round(top.t),
    timingErrorMs: landing === null ? null : Math.round(top.t - landing),
    gainDb: Number(m[4]),
    ownOverBedDb: Number((peakDb - bedDb).toFixed(1)),
    plannedOwnDb: Number(planned.toFixed(1)),
    levelErrorDb: Number((peakDb - bedDb - planned).toFixed(1)),
    overMusicAtPeakDb: Number((top.db - musicAtPeak).toFixed(1)),
    audible: top.db - musicAtPeak >= -10,
  });
}
const result = { fidelity, samplePeak: Number(samplePeak.toFixed(4)), clipped: samplePeak >= 0.999, effects: rows };
if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
