/** Reference audio timeline: measured events on the shared 10 ms clock, with each event's raw
 * measurements kept apart from any interpretation of them. Nothing here is specific to a genre,
 * a song or a reference: every threshold is relative to the analysed audio itself. */
import { z } from "zod";
import { BANDS, type BandName, type Features } from "./features";

export const audioEventKinds = [
  "onset",
  "kick",
  "snare",
  "hat",
  "impact",
  "bass_hit",
  "whoosh",
  "riser",
  "drop",
  "section",
  "silence",
  "fade_in",
  "fade_out",
  "level_change",
  "filter_sweep",
  "stereo_change",
  "word",
] as const;
export type AudioEventKind = (typeof audioEventKinds)[number];
const unit = z.number().finite().min(0).max(1);
const ms = z.number().int().nonnegative();
export const audioEventSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(audioEventKinds),
    timeMs: ms,
    endMs: ms.optional(),
    strength: unit,
    confidence: unit,
    text: z.string().max(120).optional(),
    /** Raw measurements the event was derived from. */
    measured: z.record(z.string().max(48), z.number().finite()),
    /** Interpretation of the measurements; never a measurement itself. */
    inferred: z.record(z.string().max(48), z.union([z.string().max(120), z.number().finite(), z.boolean()])).optional(),
  })
  .strict();
export type AudioEvent = z.infer<typeof audioEventSchema>;
export const audioTimelineSchema = z
  .object({
    version: z.literal(1),
    hopMs: z.number().int().positive(),
    durationMs: ms,
    loudness: z.array(z.object({ timeMs: ms, db: z.number().finite().min(-120).max(0) }).strict()).max(36000),
    beats: z.array(z.object({ timeMs: ms, strength: unit, downbeat: z.boolean() }).strict()).max(20000),
    tempo: z.array(z.object({ timeMs: ms, bpm: z.number().finite().min(30).max(300) }).strict()).max(4000),
    beatConfidence: unit,
    downbeatConfidence: unit,
    sections: z
      .array(z.object({ startMs: ms, endMs: ms, loudnessDb: z.number().finite(), lowEnergy: z.number().finite(), width: z.number().finite() }).strict())
      .max(2000),
    stereo: z.object({ width: z.number().finite().min(0), balance: z.number().finite().min(-1).max(1) }).strict(),
    events: z.array(audioEventSchema).max(40000),
    capabilities: z.object({ measured: z.array(z.string().max(80)).max(64), notMeasured: z.array(z.string().max(80)).max(64) }).strict(),
  })
  .strict();
export type AudioTimeline = z.infer<typeof audioTimelineSchema>;
export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

const db = (v: number) => Math.max(-120, 20 * Math.log10(Math.max(v, 1e-6)));
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
function quantile(values: ArrayLike<number>, q: number) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0;
}
function movingMean(values: ArrayLike<number>, radius: number) {
  const out = new Float32Array(values.length);
  let sum = 0;
  const n = values.length;
  for (let i = -radius; i < n; i++) {
    if (i + radius < n) sum += values[i + radius];
    if (i - radius - 1 >= 0) sum -= values[i - radius - 1];
    if (i >= 0) out[i] = sum / (Math.min(n - 1, i + radius) - Math.max(0, i - radius) + 1);
  }
  return out;
}
const mean = (values: ArrayLike<number>, a: number, b: number) => {
  let s = 0,
    n = 0;
  for (let i = Math.max(0, a); i < Math.min(values.length, b); i++) {
    s += values[i];
    n++;
  }
  return n ? s / n : 0;
};
const max = (values: ArrayLike<number>, a: number, b: number) => {
  let m = -Infinity;
  for (let i = Math.max(0, a); i < Math.min(values.length, b); i++) m = Math.max(m, values[i]);
  return m;
};

/** Flatness at an attack above which the sound is noise-like (a hit) rather than tonal (a sung or
 * played note that happens to start on a drum). */
const FLAT_NOISE = 0.2;
export function analyzeAudio(f: Features, words: TranscriptWord[] = []): AudioTimeline {
  const hop = f.hopMs,
    n = f.frames,
    toMs = (i: number) => Math.round(i * hop),
    rawDb = Float32Array.from(f.rms, db),
    loud = quantile(rawDb, 0.95),
    // Levels below 60 dB under the track's own loud level are treated alike: digital silence
    // must not make every following sound look like a huge jump.
    rmsDb = Float32Array.from(rawDb, (v) => Math.max(v, loud - 60));
  const events: AudioEvent[] = [];
  let next = 0;
  const add = (e: Omit<AudioEvent, "id">) => events.push({ id: `${e.kind}_${++next}`, ...e });

  // ---- Onsets: spectral flux above a local, self-relative threshold.
  const novelty = new Float32Array(n),
    local = movingMean(f.flux, 25);
  for (let i = 0; i < n; i++) novelty[i] = Math.max(0, f.flux[i] - local[i]);
  const scale = quantile(novelty, 0.99) || 1,
    floor = quantile(novelty, 0.9) * 0.6;
  const onsets: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = novelty[i];
    // The spectral window leads the attack by up to half its length: judge the level just after.
    if (v <= floor || v < 0.12 * scale || max(rmsDb, i, i + 6) < loud - 50) continue;
    let peak = true;
    for (let k = Math.max(0, i - 5); k <= Math.min(n - 1, i + 5) && peak; k++) if (k !== i && novelty[k] > v) peak = false;
    if (!peak || (onsets.length && i - onsets[onsets.length - 1] < 5)) continue;
    onsets.push(i);
  }
  // The spectral window spans ~46 ms; the 10 ms energy frames place the attack itself.
  for (let k = 0; k < onsets.length; k++) {
    const i = onsets[k];
    let best = i,
      rise = -Infinity;
    // Linear energy: a tail rising out of digital silence is a large dB step but no attack.
    for (let j = Math.max(1, i - 4); j <= Math.min(n - 1, i + 4); j++)
      if (f.rms[j] - f.rms[j - 1] > rise) {
        rise = f.rms[j] - f.rms[j - 1];
        best = j;
      }
    onsets[k] = best;
  }
  for (const [k, i] of onsets.entries()) {
    const share = (name: BandName) => mean(f.bandFlux[name], i - 1, i + 3);
    const shares = BANDS.map((b) => share(b.name)),
      total = shares.reduce((s, v) => s + v, 0) || 1,
      [sub, low, mid, high, air] = shares.map((v) => v / total);
    const strengthAt = Math.max(...[-2, -1, 0, 1, 2].map((d) => novelty[Math.min(n - 1, Math.max(0, i + d))]));
    const pre = mean(rmsDb, i - 15, i - 1),
      post = max(rmsDb, i, i + 8),
      // A tail is measured only until the next attack; it must not borrow the next sound's energy.
      nextAt = onsets[k + 1] ?? n,
      tailEnd = Math.min(i + 40, nextAt - 2),
      tail = tailEnd - i >= 25 ? mean(rmsDb, i + 20, tailEnd) : Math.min(...Array.from(rmsDb.slice(i + 3, Math.max(i + 4, tailEnd)))),
      strength = clamp(strengthAt / scale),
      active = [sub, low, mid, high, air].filter((v) => v >= 0.12).length;
    // Decay rate from the peak until the next attack (at most 300 ms). Rings that last (impacts,
    // bass hits) fall slowly; drums fall fast. Too short a gap leaves the rate unmeasured.
    let peakAt = i;
    for (let j = i; j < Math.min(n, i + 8); j++) if (rmsDb[j] > rmsDb[peakAt]) peakAt = j;
    const decayEnd = Math.min(peakAt + 30, nextAt - 2, n - 1),
      decayRate = decayEnd - peakAt >= 5 ? (rmsDb[peakAt] - mean(rmsDb, decayEnd - 2, decayEnd + 1)) / (((decayEnd - peakAt) * hop) / 1000) : Infinity,
      decay = Number.isFinite(decayRate) ? decayRate / 10 : Infinity;
    const measured = {
      fluxStrength: Number(strength.toFixed(3)),
      riseDb: Number((post - pre).toFixed(2)),
      tailDb: Number((tail - pre).toFixed(2)),
      decayDbPerSecond: Number.isFinite(decayRate) ? Number(decayRate.toFixed(1)) : -1,
      lowShare: Number((sub + low).toFixed(3)),
      subShare: Number(sub.toFixed(3)),
      subDecayDb: Number((10 * (max(f.bands.sub, i, i + 4) - mean(f.bands.sub, Math.min(n - 1, i + 18), Math.min(n, i + 22)))).toFixed(1)),
      midShare: Number(mid.toFixed(3)),
      highShare: Number((high + air).toFixed(3)),
      flatness: Number(max(f.flatness, i, i + 4).toFixed(3)),
    };
    const noisy = measured.flatness >= FLAT_NOISE;
    let kind: AudioEventKind = "onset",
      confidence = 0.5;
    // Impacts and bass hits ring on; kicks and other drums decay within a few hundred ms.
    // An impact is also among the loudest moments of the track.
    if (strength >= 0.25 && post - pre >= 12 && active >= 3 && decay <= 4 && post >= loud - 3 && noisy) {
      kind = "impact";
      confidence = clamp(0.5 + (post - pre - 12) / 20 + (active - 3) * 0.1);
    } else if (sub + low >= 0.55 && sub >= 0.35 && decay <= 4 && post - pre >= 6 && measured.subDecayDb <= 12) {
      kind = "bass_hit";
      confidence = clamp(0.4 + (sub + low - 0.55) + (4 - decay) / 8);
    } else if (sub + low >= 0.45) {
      kind = "kick";
      confidence = clamp(0.4 + (sub + low - 0.45) * 2);
    } else if (high + air >= 0.6 && sub + low < 0.15) {
      kind = "hat";
      confidence = clamp(0.4 + (high + air - 0.6) * 2);
    } else if (mid + high + air >= 0.6 && sub + low < 0.35 && high + air >= 0.25) {
      kind = "snare";
      confidence = clamp(0.4 + (mid + high + air - 0.6) * 1.5);
    }
    add({ kind, timeMs: toMs(i), strength: Number(strength.toFixed(3)), confidence: Number(confidence.toFixed(3)), measured });
  }

  // ---- Silence: well below this track's own loud level for at least 200 ms.
  const silenceDb = Math.max(-80, loud - 40);
  for (let i = 0; i < n; ) {
    if (rmsDb[i] >= silenceDb) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && rmsDb[j] < silenceDb) j++;
    if ((j - i) * hop >= 300)
      add({ kind: "silence", timeMs: toMs(i), endMs: toMs(j), strength: 1, confidence: 0.95, measured: { meanDb: Number(mean(rmsDb, i, j).toFixed(1)), thresholdDb: Number(silenceDb.toFixed(1)) } });
    i = j;
  }

  // ---- Loudness envelope at 100 ms.
  const step = Math.max(1, Math.round(100 / hop)),
    loudness: AudioTimeline["loudness"] = [];
  for (let i = 0; i < n; i += step) loudness.push({ timeMs: toMs(i), db: Number(Math.min(0, db(Math.sqrt(mean(Float32Array.from(f.rms, (v) => v * v), i, i + step)))).toFixed(2)) });

  // ---- Fades at the start and end.
  const L = loudness.map((p) => p.db);
  if (L.length > 6) {
    const head = Math.min(L.length, 30),
      peakHead = Math.max(...L.slice(0, head)),
      reach = L.findIndex((v) => v >= peakHead - 3);
    const steady = (a: number, b: number, dir: 1 | -1) => {
      const smooth = movingMean(Float32Array.from(L.slice(a, b + 1)), 3);
      let ok = 0;
      let worst = 0;
      for (let k = 1; k < smooth.length; k++) {
        if (dir * (smooth[k] - smooth[k - 1]) >= -1.5) ok++;
        // A fade never swells back: no later level more than 3 dB against its direction.
        const extreme = dir < 0 ? Math.min(...smooth.slice(0, k)) : Math.max(...smooth.slice(0, k));
        worst = Math.max(worst, dir < 0 ? smooth[k] - extreme : extreme - smooth[k]);
      }
      const raw = L.slice(a, b + 1),
        total = Math.abs(raw[raw.length - 1] - raw[0]);
      let step = 0;
      for (let k = 1; k < raw.length; k++) step = Math.max(step, dir * (raw[k] - raw[k - 1]));
      return smooth.length > 2 && ok >= 0.85 * (smooth.length - 1) && worst <= 3 && step <= 0.4 * total;
    };
    if (reach >= 3 && L[0] <= peakHead - 15 && steady(0, reach, 1))
      add({ kind: "fade_in", timeMs: 0, endMs: loudness[reach].timeMs, strength: clamp((peakHead - L[0]) / 40), confidence: 0.8, measured: { fromDb: L[0], toDb: peakHead } });
    const tailStart = Math.max(0, L.length - 30),
      peakTail = Math.max(...L.slice(tailStart)),
      last = L.length - 1 - [...L].reverse().findIndex((v) => v >= peakTail - 3);
    if (L.length - 1 - last >= 3 && L[L.length - 1] <= peakTail - 15 && steady(last, L.length - 1, -1))
      add({ kind: "fade_out", timeMs: loudness[last].timeMs, endMs: loudness[L.length - 1].timeMs, strength: clamp((peakTail - L[L.length - 1]) / 40), confidence: 0.8, measured: { fromDb: peakTail, toDb: L[L.length - 1] } });
  }

  // ---- Risers and whooshes: high-band energy climbing steadily for at least 300 ms with a
  // rising centroid, not merely sound returning after a silence.
  const silences = events.filter((e) => e.kind === "silence");
  const bright = movingMean(Float32Array.from({ length: n }, (_, i) => Math.max(f.bands.high[i], f.bands.air[i])), 10);
  const brightCentroid = movingMean(f.centroid, 10);
  for (let i = 0; i < n - 30; ) {
    let j = i,
      ups = 0,
      steps = 0;
    while (j + 5 < n && bright[j + 5] > bright[j] - 0.01) {
      if (bright[j + 5] > bright[j]) ups++;
      steps++;
      j += 5;
    }
    const gain = (bright[j] - bright[i]) * 10,
      length = (j - i) * hop,
      afterSilence = silences.some((e) => toMs(i) - (e.endMs ?? e.timeMs) >= -50 && toMs(i) - (e.endMs ?? e.timeMs) <= 200);
    if (length >= 300 && gain >= 10 && ups >= steps * 0.75 && brightCentroid[j] > brightCentroid[i] * 1.2 && rmsDb[j] > silenceDb && !afterSilence) {
      const fall = j + 50 < n && bright[j + 50] < bright[j] - 0.8;
      const kind: AudioEventKind = length < 800 && fall ? "whoosh" : "riser";
      add({ kind, timeMs: toMs(i), endMs: toMs(j), strength: clamp(gain / 30), confidence: clamp(0.4 + (ups / Math.max(1, steps)) * 0.5), measured: { gainDb: Number(gain.toFixed(1)), durationMs: length, centroidRatio: Number((brightCentroid[j] / Math.max(1, brightCentroid[i])).toFixed(2)) } });
      i = j + 5;
    } else i = Math.max(i + 5, j);
  }

  for (const sweep of events.filter((e) => e.kind === "riser" || e.kind === "whoosh")) {
    const at = events.find(
      (e) =>
        ["kick", "onset", "bass_hit", "snare"].includes(e.kind) &&
        Math.abs(e.timeMs - (sweep.endMs ?? sweep.timeMs)) <= 200 &&
        Number(e.measured.flatness) >= FLAT_NOISE &&
        Number(e.measured.decayDbPerSecond) >= 0 &&
        Number(e.measured.decayDbPerSecond) <= 60 &&
        Number(e.measured.riseDb) >= 3 &&
        max(rmsDb, Math.round(e.timeMs / hop), Math.round(e.timeMs / hop) + 8) >= loud - 3,
    );
    if (at) {
      at.kind = "impact";
      at.confidence = 0.6;
      at.inferred = { ...at.inferred, onSweepClimax: true };
    }
  }
  // ---- Beats: dynamic programming over the onset envelope with a locally estimated period,
  // so tempo may drift or change. No regular grid is imposed where the audio has none.
  const ose = movingMean(novelty, 1),
    sd = Math.sqrt(mean(Float32Array.from(ose, (v) => v * v), 0, n) - mean(ose, 0, n) ** 2) || 0;
  const beats: AudioTimeline["beats"] = [],
    tempo: AudioTimeline["tempo"] = [];
  let beatConfidence = 0,
    downbeatConfidence = 0;
  if (sd > 1e-6 && n > 300) {
    const norm = Float32Array.from(ose, (v) => v / sd),
      minLag = Math.round(300 / hop),
      maxLag = Math.round(1000 / hop);
    const periodAt = (a: number, b: number) => {
      let best = 0,
        lag = Math.round(500 / hop);
      const acf = new Float64Array(maxLag + 1);
      for (let l = Math.floor(minLag / 2); l <= maxLag; l++) {
        let s = 0;
        for (let i = Math.max(a, 0); i < Math.min(b, n) - l; i++) s += norm[i] * norm[i + l];
        acf[l] = s;
      }
      for (let l = minLag; l <= maxLag; l++) {
        const prior = Math.exp(-0.5 * (Math.log2(l / (500 / hop)) / 1) ** 2);
        if (acf[l] * prior > best) {
          best = acf[l] * prior;
          lag = l;
        }
      }
      // A pattern accenting every other beat makes the doubled period strong too; prefer the
      // faster pulse when it is nearly as periodic.
      const half = Math.round(lag / 2);
      if (half >= minLag && Math.max(acf[half - 1], acf[half], acf[half + 1]) >= 0.6 * acf[lag]) lag = half;
      return lag;
    };
    const window = Math.round(6000 / hop),
      stride = Math.round(1000 / hop),
      periods = new Float32Array(n);
    const local: { at: number; period: number }[] = [];
    for (let c = 0; c < n; c += stride) local.push({ at: c, period: periodAt(c - window / 2, c + window / 2) });
    // Median over neighbours removes single-window octave slips.
    const smooth = local.map((_, k) => quantile(local.slice(Math.max(0, k - 2), k + 3).map((q) => q.period), 0.5));
    for (let i = 0; i < n; i++) periods[i] = smooth[Math.min(smooth.length - 1, Math.round(i / stride))];
    const score = new Float64Array(n),
      from = new Int32Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      const P = periods[t];
      let best = 0,
        arg = -1;
      for (let tau = Math.max(0, Math.round(t - 2 * P)); tau <= t - Math.round(P / 2); tau++) {
        const v = score[tau] - 100 * Math.log((t - tau) / P) ** 2;
        if (arg < 0 || v > best) {
          best = v;
          arg = tau;
        }
      }
      score[t] = norm[t] + (arg >= 0 ? Math.max(0, best) : 0);
      from[t] = arg >= 0 && best > 0 ? arg : -1;
    }
    let end = n - 1,
      top = -Infinity;
    for (let t = Math.max(0, n - Math.round(periods[n - 1])); t < n; t++)
      if (score[t] > top) {
        top = score[t];
        end = t;
      }
    let chain: number[] = [];
    for (let t = end; t >= 0; t = from[t]) chain.unshift(t);
    if (chain.length >= 8) {
      const at = (t: number) => max(norm, t - 2, t + 3);
      const parity = [0, 1].map((p) => chain.filter((_, j) => j % 2 === p).reduce((s, t) => s + at(t), 0) / Math.ceil((chain.length - p) / 2));
      const strong = parity[0] >= parity[1] ? 0 : 1,
        halfBpm = 60000 / (2 * hop * quantile(Float32Array.from(chain.slice(1).map((t, j) => t - chain[j])), 0.5));
      if (parity[1 - strong] < 0.55 * parity[strong] && halfBpm >= 70) chain = chain.filter((_, j) => j % 2 === strong);
    }
    const strongest = quantile(norm, 0.99) || 1;
    const onBeat = chain.reduce((s, t) => s + norm[t], 0) / Math.max(1, chain.length),
      overall = mean(norm, 0, n);
    beatConfidence = clamp((onBeat / Math.max(1e-6, overall) - 1) / 3);
    if (chain.length >= 4 && beatConfidence > 0.1) {
      // Downbeats: the bar phase whose beats carry the most low-band attack (4 beats assumed).
      const lowAt = (t: number) => mean(f.bandFlux.sub, t - 1, t + 2);
      const phases = [0, 1, 2, 3].map((k) => {
        const own = chain.filter((_, j) => j % 4 === k);
        return own.reduce((s, t) => s + lowAt(t), 0) / Math.max(1, own.length);
      });
      const phase = phases.indexOf(Math.max(...phases)),
        others = phases.filter((_, k) => k !== phase);
      downbeatConfidence = clamp((phases[phase] - Math.max(...others)) / Math.max(1e-6, phases[phase]));
      chain.forEach((t, j) => beats.push({ timeMs: toMs(t), strength: Number(clamp(norm[t] / strongest).toFixed(3)), downbeat: j % 4 === phase && downbeatConfidence >= 0.1 }));
      for (let j = 1; j < chain.length; j++) {
        const bpm = 60000 / ((chain[j] - chain[j - 1]) * hop);
        if (bpm >= 30 && bpm <= 300) tempo.push({ timeMs: toMs(chain[j]), bpm: Number(bpm.toFixed(2)) });
      }
    }
  }

  // ---- Sections: novelty between neighbouring stretches of band energy and loudness.
  const unitsMs = beats.length >= 8 ? beats.map((b) => b.timeMs) : Array.from({ length: Math.floor(f.durationMs / 500) }, (_, k) => k * 500);
  const vector = (a: number, b: number) => [...BANDS.map((band) => mean(f.bands[band.name], a, b)), mean(rmsDb, a, b) / 20];
  const units = unitsMs.map((t, k) => vector(Math.round(t / hop), Math.round((unitsMs[k + 1] ?? f.durationMs) / hop)));
  const span = 4,
    nov: number[] = units.map((_, k) => {
      if (k < span || k + span > units.length) return 0;
      const avg = (a: number, b: number) => units[0].map((_, d) => units.slice(a, b).reduce((s, v) => s + v[d], 0) / (b - a));
      const before = avg(k - span, k),
        after = avg(k, k + span);
      return Math.sqrt(before.reduce((s, v, d) => s + (v - after[d]) ** 2, 0));
    });
  const cut = quantile(nov.filter((v) => v > 0), 0.5) * 1.4;
  const boundaries: number[] = [];
  nov.forEach((v, k) => {
    if (v > cut && v > 0.3 && v >= (nov[k - 1] ?? 0) && v >= (nov[k + 1] ?? 0) && (!boundaries.length || k - boundaries[boundaries.length - 1] >= span)) boundaries.push(k);
  });
  const edges = [0, ...boundaries.map((k) => unitsMs[k]), f.durationMs];
  const sections: AudioTimeline["sections"] = [];
  for (let s = 0; s + 1 < edges.length; s++) {
    const a = Math.round(edges[s] / hop),
      b = Math.max(a + 1, Math.round(edges[s + 1] / hop));
    sections.push({
      startMs: edges[s],
      endMs: edges[s + 1],
      loudnessDb: Number(mean(rmsDb, a, b).toFixed(2)),
      lowEnergy: Number((mean(f.bands.sub, a, b) + mean(f.bands.low, a, b)).toFixed(3)),
      width: Number((mean(f.side, a, b) / Math.max(1e-6, mean(f.rms, a, b))).toFixed(3)),
    });
  }
  sections.slice(1).forEach((s, k) => {
    const before = sections[k],
      t = s.startMs,
      riser = events.some((e) => e.kind === "riser" && Math.abs((e.endMs ?? e.timeMs) - t) <= 500),
      lift = s.loudnessDb - before.loudnessDb,
      lowLift = (s.lowEnergy - before.lowEnergy) * 10;
    add({ kind: "section", timeMs: t, strength: clamp(nov[boundaries[k]] / 2), confidence: 0.6, measured: { novelty: Number(nov[boundaries[k]].toFixed(3)), loudnessChangeDb: Number(lift.toFixed(2)), lowChangeDb: Number(lowLift.toFixed(2)) } });
    if ((lift >= 3 && lowLift >= 4) || (riser && lift >= 2)) {
      // A drop lands on the strongest attack near the boundary, when one exists.
      const near = events.filter((e) => ["impact", "kick", "bass_hit", "onset"].includes(e.kind) && Math.abs(e.timeMs - t) <= 120).sort((a, b) => b.strength - a.strength)[0];
      add({ kind: "drop", timeMs: near?.timeMs ?? t, strength: clamp((lift + lowLift) / 20), confidence: clamp(0.4 + (riser ? 0.3 : 0) + lift / 20), measured: { loudnessChangeDb: Number(lift.toFixed(2)), lowChangeDb: Number(lowLift.toFixed(2)) }, inferred: { precededByRiser: riser } });
    }
    if (Math.abs(s.width - before.width) >= 0.15)
      add({ kind: "stereo_change", timeMs: t, strength: clamp(Math.abs(s.width - before.width)), confidence: 0.6, measured: { widthBefore: before.width, widthAfter: s.width } });
  });

  // ---- Filter sweeps: the smoothed centroid moves an octave or more, steadily, over at least a
  // second while loudness holds. Alternating drums move the centroid back and forth, not along.
  const logCentroid = movingMean(Float32Array.from(f.centroid, (v) => Math.log2(Math.max(20, v))), 25),
    level = movingMean(rmsDb, 25);
  for (let i = 0; i + 100 < n; ) {
    const j = i + 100,
      octaves = logCentroid[j] - logCentroid[i];
    let along = 0;
    for (let k = i; k + 10 <= j; k += 10) if (Math.sign(logCentroid[k + 10] - logCentroid[k]) === Math.sign(octaves)) along++;
    if (Math.abs(octaves) >= 1 && along >= 8 && Math.abs(level[j] - level[i]) < 4 && rmsDb[i] > silenceDb && rmsDb[j] > silenceDb) {
      add({ kind: "filter_sweep", timeMs: toMs(i), endMs: toMs(j), strength: clamp(Math.abs(octaves) / 3), confidence: 0.5, measured: { octaves: Number(octaves.toFixed(2)), levelChangeDb: Number(Math.abs(level[j] - level[i]).toFixed(1)) }, inferred: { direction: octaves > 0 ? "opening" : "closing" } });
      i = j;
    } else i += 10;
  }

  // ---- Level changes inside a section: deliberate volume automation rather than musical events.
  const smoothL = movingMean(Float32Array.from(L), 5);
  for (let k = 10; k < L.length; k += 5) {
    const change = smoothL[k] - smoothL[k - 10];
    const before = mean(smoothL, Math.max(0, k - 20), k - 10),
      after = mean(smoothL, k, Math.min(L.length, k + 10));
    const holds = k - 20 >= 0 && k + 10 <= L.length && Math.abs(before - smoothL[k - 10]) <= 4 && Math.abs(after - smoothL[k]) <= 4;
    if (Math.abs(change) >= 8 && holds && !events.some((e) => (e.kind === "silence" || e.kind === "drop" || e.kind === "fade_in" || e.kind === "fade_out") && Math.abs(e.timeMs - loudness[k].timeMs) < 1200))
      add({ kind: "level_change", timeMs: loudness[k - 10].timeMs, endMs: loudness[k].timeMs, strength: clamp(Math.abs(change) / 24), confidence: 0.5, measured: { changeDb: Number(change.toFixed(1)) } });
  }

  // ---- Words: from a transcript, with their timing measured by the speech model.
  for (const w of words)
    add({ kind: "word", timeMs: Math.max(0, Math.round(w.startMs)), endMs: Math.round(w.endMs), text: w.text.slice(0, 120), strength: 1, confidence: clamp(w.confidence ?? 0.5), measured: { durationMs: Math.round(w.endMs - w.startMs) } });

  const total = mean(f.rms, 0, n) || 1e-6;
  const lr = mean(f.rmsLeft, 0, n) + mean(f.rmsRight, 0, n) || 1e-6;
  return {
    version: 1,
    hopMs: hop,
    durationMs: f.durationMs,
    loudness,
    beats,
    tempo,
    beatConfidence: Number(beatConfidence.toFixed(3)),
    downbeatConfidence: Number(downbeatConfidence.toFixed(3)),
    sections,
    stereo: { width: Number((mean(f.side, 0, n) / total).toFixed(3)), balance: Number(clamp((mean(f.rmsLeft, 0, n) - mean(f.rmsRight, 0, n)) / lr, -1, 1).toFixed(3)) },
    events: events.sort((a, b) => a.timeMs - b.timeMs).slice(0, 40000),
    capabilities: {
      measured: ["onsets", "kicks, snares, hats (band shares)", "impacts and bass hits", "risers and whooshes", "silence", "fades", "loudness envelope", "beats with drifting tempo", "downbeats (4-beat bars assumed)", "sections and drops", "filter sweeps", "stereo width and balance", "level changes", "transcribed words"],
      notMeasured: ["reverb and delay", "distortion", "pitch changes", "reverse audio", "stutters and repeats", "EQ other than sweeps", "music/dialogue separation beyond transcribed words", "time signatures other than 4"],
    },
  };
}
