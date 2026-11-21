/** Recreating a reference's audio structure with different audio. The reference's event graph
 * says which visual events are triggered by which kinds of sound; the replacement music is
 * measured with the same analysis; the replacement is offset so its events land where the
 * reference's did, and each linked visual event is moved onto the corresponding replacement
 * event. Sounds the replacement lacks (an impact under a cut, a riser into a title) are planned
 * as locally generated effects. Every decision is recorded with its measured distance. */
import type { StyleDNA } from "./dna";
import { audioAnchors, type EventGraph } from "./event-graph";
import type { AudioTimeline } from "../audio/timeline";
import { synthesize, type SoundKind } from "../audio/synth";
import type { BeatMap } from "../media-analysis/model";

/** The measured audio timeline in the beat-map form Smart Adaptation and Creative Remix use. */
export function beatMapOf(audio: AudioTimeline): BeatMap {
  const cap = (t: number) => Math.max(0, Math.min(1_800_000, Math.round(t)));
  const bpms = audio.tempo.map((t) => t.bpm).sort((a, b) => a - b),
    bpm = bpms.length ? bpms[bpms.length >> 1] : null;
  return {
    bpm: bpm !== null && bpm >= 60 && bpm <= 200 ? Number(bpm.toFixed(2)) : null,
    confidence: audio.beatConfidence,
    beats: audio.beats.slice(0, 30000).map((b) => ({ timeMs: cap(b.timeMs), strength: b.strength })),
    downbeats: audio.beats.filter((b) => b.downbeat).slice(0, 30000).map((b) => cap(b.timeMs)),
    onsets: audio.events
      .filter((e) => ["onset", "kick", "snare", "hat", "impact", "bass_hit", "drop"].includes(e.kind))
      .slice(0, 30000)
      .map((e) => ({ timeMs: cap(e.timeMs), strength: e.strength })),
    energyCurve: audio.loudness.slice(0, 18001).map((l) => ({ timeMs: cap(l.timeMs), rmsDb: l.db })),
    method: "Local audio timeline: band spectral flux onsets, dynamic-programming beats with a locally estimated period.",
  };
}

/** Anchor kinds that can stand in for each other, strongest equivalence first. */
const families: Record<string, string[]> = {
  impact: ["impact", "drop", "bass_hit", "kick", "downbeat"],
  drop: ["drop", "impact", "bass_hit", "downbeat", "kick"],
  bass_hit: ["bass_hit", "impact", "kick", "downbeat"],
  kick: ["kick", "downbeat", "beat", "bass_hit"],
  snare: ["snare", "beat", "onset"],
  downbeat: ["downbeat", "kick", "beat", "impact"],
  beat: ["beat", "downbeat", "kick", "snare"],
  onset: ["onset", "kick", "snare", "beat", "downbeat"],
  section: ["section", "drop", "downbeat"],
  word: ["word"],
  word_match: ["word"],
};
const weightOf = (kind: string) => ({ impact: 1, drop: 1, bass_hit: 0.9, downbeat: 0.8, kick: 0.7, section: 0.7, snare: 0.6, beat: 0.5, onset: 0.4 })[kind] ?? 0;

export interface Alignment {
  offsetMs: number;
  score: number;
  /** For each linked visual event: where it moves, and why. */
  moves: { visualId: string; fromMs: number; toMs: number; anchor: string; replacement: string; distanceMs: number }[];
  /** Linked visual events left where they were, with the reason. */
  kept: { visualId: string; reason: string }[];
}

export function alignReplacement(graph: EventGraph, replacement: AudioTimeline, durationMs: number, intervalStartMs = 0): Alignment {
  const anchors = new Map(graph.anchors.map((a) => [a.id, a])),
    visual = new Map(graph.visual.map((v) => [v.id, v])),
    target = audioAnchors(replacement);
  const byKind = new Map<string, number[]>();
  for (const a of target) {
    const list = byKind.get(a.kind) ?? [];
    list.push(a.timeMs);
    byKind.set(a.kind, list);
  }
  const nearest = (list: number[] | undefined, t: number) => {
    if (!list?.length) return undefined;
    let lo = 0,
      hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const a = list[lo],
      b = list[Math.max(0, lo - 1)];
    return Math.abs(a - t) <= Math.abs(b - t) ? a : b;
  };
  const linked = graph.links
    .filter((l) => l.anchorId && l.relation !== "unanchored")
    .map((l) => ({ link: l, anchor: anchors.get(l.anchorId!)!, kind: String(l.inferred.anchor) }))
    .filter((l) => l.anchor && weightOf(l.kind === "word_match" ? "onset" : l.kind) > 0);
  const scoreAt = (offset: number) => {
    let s = 0;
    for (const { anchor, kind, link } of linked) {
      const want = anchor.timeMs - intervalStartMs + offset;
      // The best stand-in, not the first: an exact kick can beat a late impact, but an equivalent
      // event of the same kind is preferred by a clear margin.
      let best = 0;
      for (const [rank, k] of (families[kind] ?? [kind]).entries()) {
        const t = nearest(byKind.get(k), want);
        if (t !== undefined && Math.abs(t - want) <= 60) best = Math.max(best, Math.exp(-Math.abs(t - want) / 30) * Math.max(0.1, 1 - rank * 0.2));
      }
      s += weightOf(kind) * (0.4 + 0.6 * link.confidence) * best;
    }
    return s;
  };
  let best = { offsetMs: 0, score: -1 };
  const room = Math.max(0, replacement.durationMs - durationMs);
  for (let o = 0; o <= room; o += 10) {
    const s = scoreAt(o);
    if (s > best.score + 1e-9) best = { offsetMs: o, score: s };
  }
  const moves: Alignment["moves"] = [],
    kept: Alignment["kept"] = [];
  for (const { link, anchor, kind } of linked) {
    const v = visual.get(link.visualId);
    if (!v) continue;
    const period = link.measured.beatPeriodMs ?? 500,
      want = anchor.timeMs - intervalStartMs + best.offsetMs;
    let found: { t: number; k: string } | undefined;
    for (const k of families[kind] ?? [kind]) {
      const t = nearest(byKind.get(k), want);
      if (t !== undefined && Math.abs(t - want) <= Math.min(150, period * 0.5)) {
        found = { t, k };
        break;
      }
    }
    if (!found) {
      kept.push({ visualId: v.id, reason: `replacement has no ${kind}-like event within half a beat` });
      continue;
    }
    // The visual keeps its measured offset from its trigger.
    const toMs = found.t - best.offsetMs + intervalStartMs + link.offsetMs;
    moves.push({ visualId: v.id, fromMs: v.timeMs, toMs, anchor: kind, replacement: found.k, distanceMs: Math.round(found.t - want) });
  }
  return { offsetMs: best.offsetMs, score: Number(best.score.toFixed(3)), moves, kept };
}

/** Piecewise-linear retiming through the moved events, kept monotonic. `fixedMs` (the start of
 * the reconstructed interval) never moves, so the edit and the aligned music start together. */
export function retimer(moves: Alignment["moves"], minGapMs = 34, fixedMs?: number) {
  const points = [...(fixedMs === undefined ? [] : [{ fromMs: fixedMs, toMs: fixedMs }]), ...moves.filter((m) => fixedMs === undefined || m.fromMs > fixedMs + minGapMs)]
    .map((m) => [m.fromMs, m.toMs] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0]);
  const kept: [number, number][] = [];
  for (const p of points) if (!kept.length || (p[1] > kept[kept.length - 1][1] + minGapMs && p[0] > kept[kept.length - 1][0])) kept.push(p);
  return (t: number) => {
    if (!kept.length) return t;
    if (t <= kept[0][0]) return t + (kept[0][1] - kept[0][0]);
    for (let i = 1; i < kept.length; i++) {
      const [a, A] = kept[i - 1],
        [b, B] = kept[i];
      if (t <= b) return A + ((t - a) * (B - A)) / Math.max(1, b - a);
    }
    const last = kept[kept.length - 1];
    return t + (last[1] - last[0]);
  };
}

/** The reference's visual timing carried onto the replacement's events. */
export function retimeDna(dna: StyleDNA, retime: (t: number) => number): StyleDNA {
  const r = (t: number) => Math.max(0, Math.round(retime(t)));
  const shots = dna.shots.map((s) => ({ ...s, startMs: r(s.startMs), endMs: r(s.endMs) }));
  for (let i = 1; i < shots.length; i++) if (shots[i].startMs <= shots[i - 1].startMs) shots[i].startMs = shots[i - 1].startMs + 34;
  shots.forEach((s, i) => {
    s.endMs = Math.max(s.startMs + 34, shots[i + 1]?.startMs ?? s.endMs);
  });
  return {
    ...dna,
    shots,
    transitions: dna.transitions.map((t) => ({ ...t, startMs: Math.min(r(t.startMs), r(t.cutMs)), cutMs: r(t.cutMs), endMs: Math.max(r(t.endMs), r(t.cutMs)) })),
    text:
      dna.text?.map((t) => ({
        ...t,
        startMs: r(t.startMs),
        endMs: Math.max(r(t.startMs) + 1, r(t.endMs)),
        ...(t.geometry ? { geometry: t.geometry.map((g) => ({ ...g, timeMs: r(g.timeMs) })) } : {}),
        ...(t.evidence ? { evidence: { ...t.evidence, wordStartsMs: t.evidence.wordStartsMs.map(r) } } : {}),
      })) ?? null,
    colorPulses: dna.colorPulses.map((p) => ({ ...p, startMs: r(p.startMs), endMs: Math.max(r(p.startMs) + 1, r(p.endMs)) })),
    ...(dna.personFlashes ? { personFlashes: dna.personFlashes.map((p) => ({ ...p, startMs: r(p.startMs), endMs: Math.max(r(p.startMs) + 1, r(p.endMs)) })) } : {}),
  };
}

export interface PlannedSound {
  kind: SoundKind;
  /** Reference-clock time the sound starts. */
  startMs: number;
  durationMs: number;
  /** Where in the generated asset playback starts (ms): a rising sound plays its own lead-in up to
   * its envelope peak, which lands on the reference's landing moment. */
  sourceInMs?: number;
  /** Reference-clock moment the effect lands (a rising sound's peak, a hit's onset). */
  landingMs?: number;
  /** Gain at the start of a rising sound's lead-in, when the reference rose further than the
   * generated sound does over that part (ramps linearly to gainDb at the landing). */
  startGainDb?: number;
  /** Clip gain that reproduces the reference's level relative to its music. */
  gainDb: number;
  /** Measured in the reference: effect peak over the music just before it. */
  relativeGainDb: number;
  attackMs: number;
  releaseMs: number;
  balance?: { low: number; mid: number; high: number };
  reason: string;
}

/** Length (ms) of each generated effect asset as `generatedSound` renders it. */
export const GENERATED_MS: Partial<Record<SoundKind, number>> = { riser: 4000, whoosh: 1000 };
const shapes = new Map<SoundKind, { lengthMs: number; peakMs: number; peakDb: number; envelope: number[] }>();
/** Rate `generatedSound` renders effects at. */
export const GENERATED_RATE = 44100;
/** A 44.1 kHz signal in the audio-analysis domain (22.05 kHz): a windowed-sinc low-pass at the new
 * Nyquist, then every second sample, as decoding for analysis band-limits it. */
export function analysisBand(x: Float32Array) {
  const taps = 63,
    half = (taps - 1) / 2,
    h = new Float32Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const n = k - half,
      sinc = n === 0 ? 0.5 : Math.sin(Math.PI * 0.5 * n) / (Math.PI * n),
      w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = sinc * w;
    sum += h[k];
  }
  const y = new Float32Array(Math.floor(x.length / 2));
  for (let i = 0; i < y.length; i++) {
    let v = 0;
    for (let k = 0; k < taps; k++) {
      const j = 2 * i + k - half;
      if (j >= 0 && j < x.length) v += x[j] * h[k];
    }
    y[i] = v / sum;
  }
  return y;
}
/** A generated effect's own shape, measured as the app plays it: synthesised at the rate
 * `generatedSound` renders (44.1 kHz), band-limited to the analysis domain (22.05 kHz), 100 ms
 * RMS dBFS on a 10 ms hop: its length, where its envelope peaks (a riser at its end, a whoosh in
 * its middle, a hit near its start) and that peak level. Measuring the 22.05 kHz synthesis
 * instead overstated bright noise effects (a whoosh by ~4.7 dB in the app measurement), since the
 * synth's filters scale with the sample rate. */
export function synthShape(kind: SoundKind) {
  if (!shapes.has(kind)) {
    const rate = 22050,
      x = analysisBand(synthesize(kind, GENERATED_RATE, 1, GENERATED_MS[kind])),
      w = Math.round(rate / 10),
      hop = Math.round(rate / 100);
    let peak = 0,
      at = 0;
    const envelope: number[] = [];
    for (let i = 0; i + w <= x.length; i += hop) {
      let e = 0;
      for (let k = i; k < i + w; k++) e += x[k] * x[k];
      const r = Math.sqrt(e / w);
      envelope.push(20 * Math.log10(Math.max(r, 1e-6)));
      if (r > peak) {
        peak = r;
        at = i + w / 2;
      }
    }
    shapes.set(kind, { lengthMs: Math.round((x.length * 1000) / rate), peakMs: Math.round((at * 1000) / rate), peakDb: 20 * Math.log10(Math.max(peak, 1e-6)), envelope });
  }
  return shapes.get(kind)!;
}
/** The generated effect's own level (dBFS, 100 ms RMS) `ms` into the asset. */
export function synthLevelAt(kind: SoundKind, ms: number) {
  const e = synthShape(kind).envelope;
  return e[Math.max(0, Math.min(e.length - 1, Math.round((ms - 50) / 10)))];
}
/** Peak 100 ms RMS level (dBFS) of a synthesised effect, as `generatedSound` renders it. */
export function synthPeakDb(kind: SoundKind) {
  return synthShape(kind).peakDb;
}

/** Where an effect's level is read, shared by the reference, the replacement music and the export
 * (milliseconds on one clock): the peak window and the music-bed window. A rising sound (riser,
 * whoosh) peaks where it lands and its bed is read before it starts to rise (a bed read across the
 * rise would include the effect itself); a hit peaks just after it lands, its bed just before. */
export function effectWindows(rising: boolean, onsetMs: number, landingMs: number): { peak: [number, number]; bed: [number, number] } {
  return rising ? { peak: [landingMs - 250, landingMs + 50], bed: [onsetMs - 2000, onsetMs - 100] } : { peak: [landingMs - 100, landingMs + 400], bed: [landingMs - 2000, landingMs - 300] };
}

/** The level (100 ms RMS dBFS) the effect alone needs to stand over the replacement's music bed as
 * the reference's effect stood over its own bed.
 *
 * `relativeDb` is read from the finished reference mix (mix peak over bed, shared windows); the
 * bed's own share of that peak is removed, so the effect's own relation is reproduced, not the mix
 * peak's. The replacement's music is not subtracted where the effect lands: a beat of its own
 * there belongs to the music, and lowering the effect for it left impacts and risers 3–6 dB under
 * the reference in the controlled measurement (scripts/measure-effect-placement.mjs). When that
 * music is louder than the effect where it lands, the note says so (masking risk).
 * Fallback: no measurable bed (silence or no replacement) uses −20 dBFS of music. */
export function effectLevel(x: { bedDb?: number; musicAtEventDb?: number; relativeDb: number; musicGainDb: number }) {
  let note: string | undefined;
  let bed = x.bedDb;
  if (bed === undefined || bed < -60) {
    note = "no measurable music bed; level set against −20 dBFS music";
    bed = -20;
  }
  const own = ownRelation(x.relativeDb);
  const target = Math.min(-3, bed + x.musicGainDb + own);
  const music = x.musicAtEventDb === undefined || x.musicAtEventDb < -60 ? -120 : x.musicAtEventDb + x.musicGainDb;
  if (music > target + 1) note = (note ? note + "; " : "") + `the replacement music is ${(music - target).toFixed(1)} dB louder than the effect where it lands (it may mask it)`;
  return { effectDb: Number(target.toFixed(2)), targetDb: Number(target.toFixed(2)), note };
}

/** The effect's own level over its bed, from a mix peak over that bed: the bed contributes its own
 * power to the peak (dB in, dB out; never below -12). */
export function ownRelation(mixOverBedDb: number) {
  const p = 10 ** (mixOverBedDb / 10) - 1;
  return Math.max(-12, p > 0 ? 10 * Math.log10(p) : -12);
}

/** Where a planned effect goes on the timeline: start frame, the part of the generated asset it
 * plays (source in), its length and its gain keys (frame, dB). `toFrame` maps reference-clock
 * milliseconds to timeline frames; `cursor` is the timeline's end. */
export function placeSound(sound: PlannedSound, assetMs: number, rate: number, toFrame: (refMs: number) => number, cursor: number) {
  const rising = sound.kind === "whoosh" || sound.kind === "riser",
    assetFrames = Math.floor((assetMs * rate) / 1000),
    // The edit's clock can be warped onto the timeline (recreated audio follows the new music's
    // structure), but a generated sound plays at its own speed: it is anchored where it lands and
    // keeps its real length. Mapping its start and end separately stretched a riser's 0.4 s lead-in
    // to 1 s of timeline, so it ran out 0.5 s before its landing (reel 55, measured in the app).
    landingAt = toFrame(sound.landingMs ?? sound.startMs),
    leadFrames = Math.round((((sound.landingMs ?? sound.startMs) - sound.startMs) * rate) / 1000);
  let sourceIn = Math.round(((sound.sourceInMs ?? 0) * rate) / 1000),
    at = landingAt - leadFrames,
    duration = Math.min(Math.max(1, Math.round((sound.durationMs * rate) / 1000)), assetFrames - sourceIn);
  if (at < 0) {
    sourceIn -= at;
    duration += at;
    at = 0;
  }
  duration = Math.min(duration, cursor - at);
  if (duration < 1) return null;
  let keys: [number, number][];
  if (rising) {
    // The generated rise and fall are the envelope: no fade before the peak. Only a tail cut short
    // of the asset's own end fades out over its last two frames (no click).
    const truncated = sourceIn + duration < assetFrames - 1;
    const landing = Math.min(at + duration - 1, Math.max(at, sound.landingMs !== undefined ? toFrame(sound.landingMs) : at + duration - 1));
    keys = [
      ...(sound.startGainDb !== undefined && landing > at ? ([[at, sound.startGainDb], [landing, sound.gainDb]] as [number, number][]) : []),
      ...(truncated && duration > 3 ? ([[Math.max(landing, at + duration - 3), sound.gainDb], [at + duration - 1, -40]] as [number, number][]) : []),
    ];
  } else {
    // Measured attack and release as ordinary gain keys.
    const attack = Math.max(1, Math.min(Math.floor(duration / 3), Math.round((sound.attackMs * rate) / 1000))),
      release = Math.max(1, Math.min(Math.floor(duration / 2), Math.round((sound.releaseMs * rate) / 1000)));
    keys = [
      [at, -40],
      [at + attack, sound.gainDb],
      [Math.max(at + attack, at + duration - release), sound.gainDb],
      [at + duration - 1, -40],
    ];
  }
  return { at, duration, sourceIn, keys: keys.filter((k, i, all) => i === 0 || k[0] > all[i - 1][0]) };
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : undefined);
const levels = (a: AudioTimeline, from: number, to: number) => a.loudness.filter((p) => p.timeMs >= from && p.timeMs < to).map((p) => p.db);

/** Effects to generate: sounds the reference ties to visual events that the replacement lacks,
 * at the reference's measured level relative to its music, with its attack and release. */
export function plannedSounds(
  graph: EventGraph,
  reference: AudioTimeline,
  replacement: AudioTimeline | undefined,
  alignment: { map: (refMs: number) => number } | undefined,
  intervalStartMs = 0,
  musicGainDb = -12,
): PlannedSound[] {
  const target = replacement ? audioAnchors(replacement) : [];
  const linkedAnchors = new Set(graph.links.filter((l) => l.anchorId).map((l) => l.anchorId!));
  const out: PlannedSound[] = [];
  for (const e of reference.events) {
    const kind = e.kind === "drop" ? "impact" : e.kind;
    if (!["impact", "bass_hit", "whoosh", "riser"].includes(kind)) continue;
    const rising = e.kind === "whoosh" || e.kind === "riser";
    const anchorId = rising ? e.id + "_end" : e.id;
    const linked = linkedAnchors.has(anchorId);
    if (!linked && e.confidence < 0.7) continue;
    // Where it lands: the detector reports a rising sound's climax (a riser's top, a whoosh's
    // peak) as its end; a hit lands at its onset.
    const at = rising ? (e.endMs ?? e.timeMs) : e.timeMs;
    if (at < intervalStartMs) continue;
    const there = alignment ? alignment.map(at) : at - intervalStartMs;
    const thereOnset = alignment ? alignment.map(e.timeMs) : e.timeMs - intervalStartMs;
    const covered = target.some((a) => (kind === "impact" || kind === "bass_hit" ? ["impact", "drop", "bass_hit"] : [kind + "_end"]).includes(a.kind) && Math.abs(a.timeMs - there) <= 60);
    if (covered) continue;
    // Measured in the reference: the effect's peak over the music bed before it (shared windows).
    const win = effectWindows(rising, e.timeMs, at);
    const peak = Math.max(...levels(reference, ...win.peak), -120);
    const bed = median(levels(reference, ...win.bed).filter((v) => v > peak - 60)) ?? median(levels(reference, at + 1500, at + 3000)) ?? peak - 12;
    const relativeGainDb = Math.max(-12, Math.min(30, peak - bed));
    const peakAt = reference.loudness.filter((p) => p.timeMs >= at - 100 && p.timeMs <= at + 400).sort((a, b) => b.db - a.db)[0]?.timeMs ?? at;
    const fallen = reference.loudness.find((p) => p.timeMs > peakAt && p.db <= peak - 20);
    const releaseMs = Math.max(80, Math.min(3000, (fallen?.timeMs ?? peakAt + 1500) - peakAt));
    const attackMs = rising ? Math.max(150, (e.endMs ?? e.timeMs) - e.timeMs) : Math.max(5, Math.min(200, peakAt - at));
    const shares = e.measured as Record<string, number>;
    // A rising sound: the generated sound's own envelope peak lands on the reference's landing
    // moment, with the reference's lead-in before it (as much of the generated rise as exists) and
    // the reference's fall after it (as much of the generated tail as exists). A hit starts on it.
    const shape = synthShape(kind as SoundKind);
    // The audible rise, measured in the reference: back from the landing while the mix stays 3 dB
    // over its bed (the detector's onset can sit well before a short swell becomes audible).
    let riseFrom = at;
    for (const p of [...reference.loudness].filter((q) => q.timeMs >= e.timeMs - 100 && q.timeMs <= at).reverse()) {
      if (p.db < bed + 3) break;
      riseFrom = p.timeMs;
    }
    // How long the reference effect was really rising: the visible part of its rise (over the bed)
    // against how long the generated sound would stay visible at the same peak over its bed gives
    // their rate; the generated sound's whole audible rise (from 20 dB under its peak) scaled by it
    // is the reference's. Bounded by the detector's span and by the generated sound's own rise.
    const visibleMs = at - riseFrom + 100;
    const own = ownRelation(relativeGainDb);
    const before = (dropDb: number) => {
      // ms before the generated peak where it is dropDb under its peak (walking back).
      const e = shape.envelope,
        top = Math.round((shape.peakMs - 50) / 10);
      let k = top;
      while (k > 0 && e[k] > e[top] - dropDb) k--;
      return (top - k) * 10;
    };
    const generatedVisible = Math.max(10, before(Math.max(1, own - 3)));
    const audibleRise = Math.round((before(20) * visibleMs) / generatedVisible);
    const leadInMs = rising ? Math.max(100, Math.min(shape.peakMs, at - e.timeMs + 100, audibleRise)) : 0;
    const fallMs = rising ? Math.max(0, Math.min(shape.lengthMs - shape.peakMs, (fallen?.timeMs ?? at + shape.lengthMs) - at)) : 0;
    const durationMs = rising ? leadInMs + fallMs : Math.min(kind === "impact" ? 1400 : 900, releaseMs + attackMs);
    // In the replacement: the same relation of the mix to its music bed at the mapped time. The
    // effect sums with the replacement's own music where it plays, so that music's power there
    // is subtracted (one domain throughout: 100 ms RMS, dBFS).
    const repWin = effectWindows(rising, thereOnset, there);
    const repBed = replacement ? median(levels(replacement, ...repWin.bed)) : undefined;
    const repAtEvent = replacement ? Math.max(...levels(replacement, ...repWin.peak), -120) : undefined;
    const level = effectLevel({ bedDb: repBed, musicAtEventDb: repAtEvent, relativeDb: relativeGainDb, musicGainDb });
    const gainDb = Math.max(-60, Math.min(12, level.effectDb - synthPeakDb(kind as SoundKind)));
    // Across the rise: how far the reference effect itself rose from its onset to its landing (its
    // own level over the bed, the bed's share removed), against how far the generated sound rises
    // over the part that plays. The shortfall becomes a gain ramp into the landing.
    let startGainDb: number | undefined;
    if (rising) {
      const onsetMix = Math.max(...levels(reference, e.timeMs, e.timeMs + 100), -120);
      const refRise = ownRelation(relativeGainDb) - ownRelation(onsetMix - bed);
      const sourceIn = Math.max(0, shape.peakMs - leadInMs);
      const generatedRise = synthLevelAt(kind as SoundKind, shape.peakMs) - synthLevelAt(kind as SoundKind, sourceIn + 50);
      const extra = Math.min(36, Math.max(0, refRise - generatedRise));
      if (extra >= 1) startGainDb = Number((gainDb - extra).toFixed(1));
    }
    out.push({
      kind: kind as SoundKind,
      startMs: Math.max(0, rising ? at - leadInMs : at),
      durationMs,
      sourceInMs: rising ? Math.max(0, shape.peakMs - leadInMs) : 0,
      landingMs: at,
      ...(startGainDb !== undefined ? { startGainDb } : {}),
      gainDb: Number(gainDb.toFixed(1)),
      relativeGainDb: Number(relativeGainDb.toFixed(1)),
      attackMs: Math.round(attackMs),
      releaseMs: Math.round(releaseMs),
      ...(shares.lowShare !== undefined ? { balance: { low: shares.lowShare, mid: shares.midShare ?? 0, high: shares.highShare ?? 0 } } : {}),
      reason: `${e.kind} at ${(e.timeMs / 1000).toFixed(3)} s${linked ? " triggers a visual event" : ""}; the replacement has none there; reference level ${relativeGainDb >= 0 ? "+" : ""}${relativeGainDb.toFixed(1)} dB over its music${level.note ? "; " + level.note : ""}`,
    });
  }
  return out;
}
