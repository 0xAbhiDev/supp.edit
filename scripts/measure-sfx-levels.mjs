// Generated effects in an exported recreation, measured in the planner's own level domain
// (100 ms RMS dBFS of mono 22.05 kHz audio, 50 ms hop — the planner's audio-analysis domain):
//  - exportRelativeDb: the export's peak in [t-150, t+400] ms (rising effects: at their end) over
//    its bed median in [t-2000, t-300] ms, against the reference's relation (mix over its music);
//  - musicAtEventDb: the music track alone at the same moments, rebuilt from the music source
//    with its layer's source offset and gain (constant gains only), so a beat of the music that
//    lands on the effect is not mistaken for the effect;
//  - effectOverMusicDb: the effect's own energy (export minus music, per window) at its peak over
//    the music there — audibility: about -3 dB or more is clearly heard, below about -10 dB the
//    music masks it;
//  - clipping (sample peak).
// Usage: node scripts/measure-sfx-levels.mjs RENDER.mp4 SAVED.supp
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mediaEnvironment } from "./runtime.mjs";
const [render, project] = process.argv.slice(2);
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
const RATE = 22050,
  W = 2205;
const pcm = (args) => {
  const raw = execFileSync(ffmpeg, ["-v", "error", ...args, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { env, maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
};
const levels = (x, offsetMs = 0, gainDb = 0) => {
  const g = 10 ** (gainDb / 20),
    out = [];
  for (let i = 0; i + W <= x.length; i += W / 2) {
    let s = 0;
    for (let k = i; k < i + W; k++) s += x[k] * x[k];
    out.push({ t: offsetMs + (i / RATE) * 1000 + 50, db: 20 * Math.log10(Math.sqrt(s / W) * g + 1e-9) });
  }
  return out;
};
const x = pcm(["-i", render]);
let samplePeak = 0;
for (const v of x) samplePeak = Math.max(samplePeak, Math.abs(v));
const lv = levels(x);
const p = JSON.parse(fs.readFileSync(project, "utf8"));
const c = p.compositions.find((c) => c.ai);
const fps = (c.settings?.fps ?? p.settings.fps).num / (c.settings?.fps ?? p.settings.fps).den;
// The music track alone, placed on the timeline as the composition plays it.
const musicTrack = c.tracks.find((t) => t.kind === "audio" && /music/i.test(t.name));
const musicLayers = musicTrack ? c.layers.filter((l) => l.trackId === musicTrack.id && l.kind !== "text") : [];
const music = [];
for (const l of musicLayers) {
  const a = p.assets.find((a) => a.id === l.assetId);
  if (!a || typeof l.gain !== "number") continue;
  const file = a.path.startsWith("\\\\?\\") ? a.path.slice(4) : a.path;
  const seg = pcm(["-ss", String(l.sourceIn / fps), "-t", String(l.duration / fps), "-i", file]);
  music.push(...levels(seg, (l.start / fps) * 1000, l.gain));
}
const musicAt = (t) => {
  const near = music.filter((q) => Math.abs(q.t - t) <= 25);
  return near.length ? Math.max(...near.map((q) => q.db)) : -120;
};
const power = (db) => 10 ** (db / 10);
const rows = [];
for (const note of c.ai?.audioNotes ?? []) {
  const m = /Generated (\w+) at ([\d.]+) s(?: \(lands ([\d.]+) s\))?, (-?[\d.]+) dB \(reference ([+-]?[\d.]+) dB over its music/.exec(note);
  if (!m) continue;
  const at = Number(m[2]) * 1000;
  const layer = c.layers.find((l) => Math.abs((l.start * 1000) / fps - at) <= 40 && /supp-generated/.test(p.assets.find((a) => a.id === l.assetId)?.name ?? ""));
  const peakAt = layer && (m[1] === "riser" || m[1] === "whoosh") ? ((layer.start + layer.duration) * 1000) / fps : at;
  // The mix peak where the reference's relation was measured; the effect's own loudest moment is
  // searched over everything it plays (a symmetric whoosh peaks mid-way, a riser at its end).
  const win = lv.filter((q) => q.t >= peakAt - 150 && q.t < peakAt + 400);
  const span = layer ? lv.filter((q) => q.t >= (layer.start * 1000) / fps && q.t < ((layer.start + layer.duration) * 1000) / fps + 100) : win;
  const peak = Math.max(...win.map((q) => q.db));
  const bed = lv.filter((q) => q.t >= at - 2000 && q.t < at - 300).map((q) => q.db).sort((a, b) => a - b);
  const b = bed[bed.length >> 1];
  // The effect's own energy per window: export minus the music alone at the same time.
  const own = span.map((q) => ({ t: q.t, music: musicAt(q.t), effect: power(q.db) - power(musicAt(q.t)) }));
  const best = own.reduce((a, o) => (o.effect > a.effect ? o : a), { t: peakAt, music: musicAt(peakAt), effect: 0 });
  const effectDb = best.effect > 0 ? 10 * Math.log10(best.effect) : -120;
  rows.push({
    kind: m[1],
    atMs: Math.round(at),
    gainDb: Number(m[4]),
    referenceRelativeDb: Number(m[5]),
    exportRelativeDb: +(peak - b).toFixed(1),
    errorDb: +(peak - b - Number(m[5])).toFixed(1),
    ...(m[3] ? { landsAtMs: Math.round(Number(m[3]) * 1000) } : {}),
    peakDbfs: +peak.toFixed(1),
    ...(music.length
      ? {
          musicAtEventDb: +Math.max(...win.map((q) => musicAt(q.t))).toFixed(1),
          effectPeakAtMs: Math.round(best.t),
          ...(m[3] ? { peakTimingErrorMs: Math.round(best.t - Number(m[3]) * 1000) } : {}),
          effectAloneDb: +effectDb.toFixed(1),
          effectOverMusicDb: +(effectDb - best.music).toFixed(1),
          effectOverBedDb: +(effectDb - b).toFixed(1),
          audible: effectDb - best.music >= -10,
        }
      : {}),
  });
}
console.log(
  JSON.stringify(
    {
      effects: rows,
      samplePeak: +samplePeak.toFixed(4),
      clipped: samplePeak >= 0.999,
      meanAbsErrorDb: rows.length ? +(rows.reduce((a, r) => a + Math.abs(r.errorDb), 0) / rows.length).toFixed(2) : null,
      musicRebuilt: music.length > 0,
      inaudible: rows.filter((r) => r.audible === false).map((r) => r.kind),
    },
    null,
    1,
  ),
);
