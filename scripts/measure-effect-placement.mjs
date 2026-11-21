// Controlled measurement of generated-effect timing and level, with isolated tracks.
//
// For each case a reference is synthesised: a music bed plus one effect whose own peak lands at a
// known moment and stands a known number of dB over the bed. The reference mix goes through the
// app's own audio analysis (audioFeatures → analyzeAudio), sound planning (plannedSounds) and
// placement (placeSound) against a different replacement music, exactly as the recreation does.
// The planned effect is rendered with its clip gain and gain keys and mixed with the replacement
// (music clip gain -12 dB, as the planner assumes).
//
// Measured on isolated tracks, identically for reference and output (100 ms RMS dBFS on a 10 ms
// hop of the 22.05 kHz signal — the analysis domain):
//  - timingErrorMs: output effect peak time − reference effect peak time (same clock);
//  - peakRelationErrorDb: output − reference of (isolated effect peak in the peak window − median
//    isolated music in the bed window), with the planner's own shared windows (effectWindows) on
//    each side's clock — the planner's definition, measured without the mix;
//  - riseRelationErrorDb: (effect − music) output − reference at 25/50/75% of the reference
//    effect's own audible rise (from 20 dB under its peak to the peak), isolated truth;
//  - plannerEstimateErrorDb: what the planner read from the finished reference mix
//    (relativeGainDb) − the true isolated relation (the mix estimate's own error);
//  - samplePeak / clipped on the output mix.
// Usage: node scripts/measure-effect-placement.mjs [OUT.json]
import fs from "node:fs";
import { createServer } from "vite";
const out = process.argv[2];
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
try {
  const { synthesize } = await host.ssrLoadModule("/packages/ai/audio/synth.ts");
  const { audioFeatures } = await host.ssrLoadModule("/packages/ai/audio/features.ts");
  const { analyzeAudio } = await host.ssrLoadModule("/packages/ai/audio/timeline.ts");
  const structure = await host.ssrLoadModule("/packages/ai/reference/audio-structure.ts");
  const { plannedSounds } = structure;
  // The metric's windows are fixed here so a build with other windows is measured the same way.
  const effectWindows = (rising, onsetMs, landingMs) => (rising ? { peak: [landingMs - 250, landingMs + 50], bed: [onsetMs - 2000, onsetMs - 100] } : { peak: [landingMs - 100, landingMs + 400], bed: [landingMs - 2000, landingMs - 300] });
  // Builds before placeSound existed placed sounds inline in the planner; this is that logic.
  const placeSound =
    structure.placeSound ??
    ((sound, assetMs, rate, toFrame, cursor) => {
      const rising = sound.kind === "whoosh" || sound.kind === "riser",
        assetFrames = Math.floor((assetMs * rate) / 1000),
        startAt = toFrame(sound.startMs),
        endAt = toFrame(sound.startMs + sound.durationMs),
        planned = Math.max(1, endAt - startAt);
      let duration = Math.min(planned, assetFrames),
        at = rising ? endAt - duration : startAt;
      if (at < 0) {
        duration += at;
        at = 0;
      }
      duration = Math.min(duration, cursor - at);
      if (duration < 1) return null;
      const attack = rising ? 0 : Math.max(1, Math.min(Math.floor(duration / 3), Math.round((sound.attackMs * rate) / 1000))),
        release = Math.max(1, Math.min(Math.floor(duration / 2), Math.round((sound.releaseMs * rate) / 1000)));
      const keys = [...(attack ? [[at, -40], [at + attack, sound.gainDb]] : []), [Math.max(at + attack, at + duration - release), sound.gainDb], [at + duration - 1, -40]];
      return { at, duration, sourceIn: rising ? Math.max(0, assetFrames - duration) : 0, keys: keys.filter((k, i, all) => i === 0 || k[0] > all[i - 1][0]) };
    });
  const RATE = 22050,
    FPS = 30,
    SECONDS = 12,
    N = RATE * SECONDS,
    MUSIC_GAIN_DB = -12;
  // Generated assets as the app renders them (generatedSound): riser 4 s, whoosh 1 s, others default.
  const ASSET_MS = { riser: 4000, whoosh: 1000, impact: 1400, bass_hit: 900 };
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
  /** 44.1 kHz → the 22.05 kHz analysis domain (63-tap windowed sinc, then every second sample):
   * the app's generated assets as analysis hears them, the same for every build measured. */
  const band = (x) => {
    const taps = 63,
      half = 31,
      h = Array.from({ length: taps }, (_, k) => {
        const n = k - half;
        return (n === 0 ? 0.5 : Math.sin(Math.PI * 0.5 * n) / (Math.PI * n)) * (0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1)));
      }),
      sum = h.reduce((a, b) => a + b, 0),
      y = new Float32Array(Math.floor(x.length / 2));
    for (let i = 0; i < y.length; i++) {
      let v = 0;
      for (let k = 0; k < taps; k++) {
        const j = 2 * i + k - half;
        if (j >= 0 && j < x.length) v += x[j] * h[k];
      }
      y[i] = v / sum;
    }
    return y;
  };
  const amp = (d) => 10 ** (d / 20);
  /** 100 ms RMS dBFS every 10 ms (centre times). */
  const envelope = (x) => {
    const w = Math.round(RATE / 10),
      hop = Math.round(RATE / 100),
      outE = [];
    for (let i = 0; i + w <= x.length; i += hop) {
      let s = 0;
      for (let k = i; k < i + w; k++) s += x[k] * x[k];
      outE.push({ t: ((i + w / 2) * 1000) / RATE, db: db(Math.sqrt(s / w)) });
    }
    return outE;
  };
  const at = (env, t) => env.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).db;
  const peakOf = (env, from, to) => env.filter((p) => p.t >= from && p.t <= to).reduce((a, b) => (b.db > a.db ? b : a), { t: from, db: -200 });
  const rms = (x) => db(Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length));
  let seed = 1;
  const noise = () => ((seed = (seed * 48271) % 2147483647) / 2147483647) * 2 - 1;
  /** A music bed: kicks and hats at `bpm`, a sustained filtered pad, scaled to `levelDb` (RMS). */
  function bed(bpm, levelDb, s0, accents = []) {
    seed = s0;
    const x = new Float32Array(N),
      beat = 60000 / bpm;
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp += 0.02 * (noise() - lp);
      x[i] = lp * 0.6 + 0.08 * Math.sin((2 * Math.PI * 110 * i) / RATE);
    }
    const put = (sound, ms, g) => {
      const s = Math.round((ms * RATE) / 1000);
      for (let i = 0; i < sound.length && s + i < N; i++) x[s + i] += sound[i] * g;
    };
    for (let t = 0, k = 0; t < SECONDS * 1000 - 300; t += beat, k++) {
      put(synthesize("kick", RATE, k + s0), t, 0.5);
      put(synthesize("hat", RATE, 50 + k + s0), t + beat / 2, 0.15);
    }
    for (const a of accents) put(synthesize("snare", RATE, 7 + s0), a, 1.2);
    const g = amp(levelDb - rms(x));
    for (let i = 0; i < N; i++) x[i] *= g;
    return x;
  }
  const add = (a, b) => Float32Array.from(a, (v, i) => v + (b[i] ?? 0));
  const timeline = (x) => analyzeAudio(audioFeatures({ rate: RATE, channels: [x, x] }));

  const LANDING = 7000;
  const cases = [];
  const effects = [
    ...[300, 600, 1000].map((length) => ({ kind: "whoosh", length })),
    ...[1000, 2000, 4000].map((length) => ({ kind: "riser", length })),
    { kind: "impact", length: 1400 },
    { kind: "bass_hit", length: 900 },
  ];
  for (const fx of effects)
    for (const musicDb of [-30, -18])
      for (const accent of [false, true]) {
        const rising = fx.kind === "whoosh" || fx.kind === "riser";
        // Reference: the effect's own peak lands at LANDING, standing `relation` dB over the bed.
        const refBedDb = -24,
          relation = 8;
        const refBed = bed(120, refBedDb, 3);
        const effect = synthesize(fx.kind, RATE, 11, fx.length);
        const effEnv = envelope(effect);
        const own = effEnv.reduce((a, b) => (b.db > a.db ? b : a));
        const onsetRef = rising ? LANDING - own.t : LANDING; // a hit lands at its onset
        const gain = amp(refBedDb + relation - own.db);
        const refFx = new Float32Array(N);
        const start = Math.round((onsetRef * RATE) / 1000);
        for (let i = 0; i < effect.length && start + i < N; i++) refFx[start + i] = effect[i] * gain;
        const refMix = add(refBed, refFx);
        const refTimeline = timeline(refMix);
        const detected = refTimeline.events.find((e) => (e.kind === fx.kind || (fx.kind === "impact" && e.kind === "drop")) && Math.abs((rising ? (e.endMs ?? e.timeMs) : e.timeMs) - LANDING) < 700);
        // Planning needs the event; when the detector misses it, the true event is supplied so the
        // placement and level stages are still measured (detection is reported separately).
        const event = detected ?? { id: "truth", kind: fx.kind, timeMs: Math.round(onsetRef), endMs: rising ? LANDING : undefined, strength: 1, confidence: 1, measured: {} };
        const planningTimeline = detected ? refTimeline : { ...refTimeline, events: [...refTimeline.events, event] };
        const graph = { anchors: [], links: [{ anchorId: event.id + (rising ? "_end" : "") }] };
        // Replacement music: another tempo and seed, `musicDb` RMS, with a snare on the landing
        // when `accent` (the replacement's own beat lands where the effect does).
        const rep = bed(100, musicDb, 9, accent ? [LANDING - 20] : []);
        const repTimeline = timeline(rep);
        const sounds = plannedSounds(graph, planningTimeline, repTimeline, { map: (ms) => ms }, 0, MUSIC_GAIN_DB).filter((s) => s.kind === fx.kind);
        const sound = sounds.find((s) => Math.abs(s.startMs + (rising ? s.durationMs : 0) - (rising ? (event.endMs ?? LANDING) : event.timeMs)) < 1500) ?? sounds[0];
        const row = { kind: fx.kind, lengthMs: fx.length, musicDb, accent, detected: detected ? { timeMs: detected.timeMs, endMs: detected.endMs ?? null, confidence: detected.confidence } : null };
        if (!sound) {
          cases.push({ ...row, planned: false });
          continue;
        }
        const assetMs = ASSET_MS[fx.kind];
        const placed = placeSound(sound, assetMs, FPS, (ms) => Math.round((ms * FPS) / 1000), SECONDS * FPS);
        // Render: the asset's part from source in, clip gain overridden by gain keys (dB, linear).
        // The asset as the app renders it (44.1 kHz), heard in the analysis domain.
        const asset = band(synthesize(fx.kind, 44100, 1, assetMs));
        const outFx = new Float32Array(N);
        const keyGain = (frame) => {
          const k = placed.keys;
          if (!k.length) return sound.gainDb;
          if (frame <= k[0][0]) return k[0][1];
          for (let j = 1; j < k.length; j++) if (frame <= k[j][0]) return k[j - 1][1] + ((k[j][1] - k[j - 1][1]) * (frame - k[j - 1][0])) / (k[j][0] - k[j - 1][0]);
          return k.at(-1)[1];
        };
        const s0 = Math.round((placed.at * RATE) / FPS),
          src0 = Math.round((placed.sourceIn * RATE) / FPS),
          len = Math.round((placed.duration * RATE) / FPS);
        for (let i = 0; i < len && s0 + i < N && src0 + i < asset.length; i++) outFx[s0 + i] = asset[src0 + i] * amp(keyGain(placed.at + (i * FPS) / RATE));
        const music = Float32Array.from(rep, (v) => v * amp(MUSIC_GAIN_DB));
        const outMix = add(music, outFx);
        // Measurements on isolated tracks.
        const refFxEnv = envelope(refFx),
          refBedEnv = envelope(refBed),
          outFxEnv = envelope(outFx),
          musicEnv = envelope(music);
        const refPeak = peakOf(refFxEnv, 0, SECONDS * 1000),
          outPeak = peakOf(outFxEnv, 0, SECONDS * 1000);
        // The planner's shared windows on each side's own timing.
        const med = (env, [a, b]) => {
          const v = env.filter((p) => p.t >= a && p.t <= b).map((p) => p.db).sort((x, y) => x - y);
          return v[v.length >> 1];
        };
        const refWin = effectWindows(rising, onsetRef, LANDING),
          outOnset = (placed.at * 1000) / FPS,
          // The output effect lands where its own peak is (the measured output peak for a rising
          // sound; a hit lands at its start).
          outWin = effectWindows(rising, outOnset, rising ? outPeak.t : outOnset);
        const refRelation = peakOf(refFxEnv, ...refWin.peak).db - med(refBedEnv, refWin.bed),
          outRelation = peakOf(outFxEnv, ...outWin.peak).db - med(musicEnv, outWin.bed);
        // Audibility where it lands: the effect against the music at that moment (a beat included).
        const audibleDb = outPeak.db - at(musicEnv, outPeak.t);
        // Across the rise as the app perceives it: from the detected onset (where the reference effect
        // becomes measurable) to the landing, at 25/50/75% of that span, on both sides' clocks.
        // The reference effect's own audible rise (isolated truth): from where it first comes within
        // 20 dB of its peak to the peak.
        const audibleFrom = refFxEnv.find((p) => p.t <= refPeak.t && p.db >= refPeak.db - 20)?.t ?? refPeak.t;
        const span = rising ? Math.max(0, refPeak.t - audibleFrom) : 0;
        const rise = rising
          ? [0.25, 0.5, 0.75].map((f) => {
              const tr = refPeak.t - (1 - f) * span,
                to = outPeak.t - (1 - f) * span;
              return Number((at(outFxEnv, to) - at(musicEnv, to) - (at(refFxEnv, tr) - at(refBedEnv, tr))).toFixed(1));
            })
          : [];
        let samplePeak = 0;
        for (const v of outMix) samplePeak = Math.max(samplePeak, Math.abs(v));
        cases.push({
          ...row,
          planned: true,
          placement: { startMs: Math.round((placed.at * 1000) / FPS), durationMs: Math.round((placed.duration * 1000) / FPS), sourceInMs: Math.round((placed.sourceIn * 1000) / FPS), gainDb: sound.gainDb, keys: placed.keys.length },
          referencePeakMs: Math.round(refPeak.t),
          outputPeakMs: Math.round(outPeak.t),
          timingErrorMs: Math.round(outPeak.t - refPeak.t),
          referenceRelationDb: Number(refRelation.toFixed(1)),
          outputRelationDb: Number(outRelation.toFixed(1)),
          peakRelationErrorDb: Number((outRelation - refRelation).toFixed(1)),
          overMusicAtPeakDb: Number(audibleDb.toFixed(1)),
          riseRelationErrorDb: rise,
          plannerEstimateErrorDb: Number((sound.relativeGainDb - refRelation).toFixed(1)),
          samplePeak: Number(samplePeak.toFixed(3)),
          clipped: samplePeak >= 0.999,
        });
      }
  const summary = {};
  for (const k of ["whoosh", "riser", "impact", "bass_hit"]) {
    const rows = cases.filter((c) => c.kind === k && c.planned);
    const mean = (f) => (rows.length ? Number((rows.reduce((s, r) => s + Math.abs(f(r)), 0) / rows.length).toFixed(1)) : null);
    summary[k] = { cases: rows.length, detected: cases.filter((c) => c.kind === k && c.detected).length, meanAbsTimingErrorMs: mean((r) => r.timingErrorMs), meanAbsPeakRelationErrorDb: mean((r) => r.peakRelationErrorDb), meanAbsRiseRelationErrorDb: rows.some((r) => r.riseRelationErrorDb.length) ? mean((r) => r.riseRelationErrorDb.reduce((s, v) => s + Math.abs(v), 0) / r.riseRelationErrorDb.length) : null, clipped: rows.filter((r) => r.clipped).length };
  }
  const result = { summary, cases };
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  for (const c of cases)
    console.log(
      `${c.kind.padEnd(8)} ${String(c.lengthMs).padStart(4)} ms music ${c.musicDb} ${c.accent ? "beat-on-landing" : "flat          "} det ${c.detected ? `${c.detected.timeMs}-${c.detected.endMs ?? ""}` : "none"} ` +
        (c.planned ? `timing ${String(c.timingErrorMs).padStart(5)} ms · level err ${String(c.peakRelationErrorDb).padStart(5)} dB (ref ${c.referenceRelationDb}, out ${c.outputRelationDb}) · over music at peak ${c.overMusicAtPeakDb} · planner est err ${c.plannerEstimateErrorDb} dB${c.clipped ? " CLIPPED" : ""}` : "not planned"),
    );
} finally {
  await host.close();
}
