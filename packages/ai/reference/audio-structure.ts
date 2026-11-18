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
  /** Clip gain that reproduces the reference's level relative to its music. */
  gainDb: number;
  /** Measured in the reference: effect peak over the music just before it. */
  relativeGainDb: number;
  attackMs: number;
  releaseMs: number;
  balance?: { low: number; mid: number; high: number };
  reason: string;
}

/** Peak 100 ms RMS level (dBFS) of a synthesised effect, as `generatedSound` renders it. */
const synthPeaks = new Map<SoundKind, number>();
export function synthPeakDb(kind: SoundKind) {
  if (!synthPeaks.has(kind)) {
    const rate = 22050,
      x = synthesize(kind, rate, 1, kind === "riser" ? 4000 : kind === "whoosh" ? 1000 : undefined),
      w = Math.round(rate / 10);
    let peak = 0;
    for (let i = 0; i + w <= x.length; i += w >> 1) {
      let s = 0;
      for (let k = i; k < i + w; k++) s += x[k] * x[k];
      peak = Math.max(peak, Math.sqrt(s / w));
    }
    synthPeaks.set(kind, 20 * Math.log10(Math.max(peak, 1e-6)));
  }
  return synthPeaks.get(kind)!;
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
    const at = rising ? (e.endMs ?? e.timeMs) : e.timeMs;
    if (at < intervalStartMs) continue;
    const there = alignment ? alignment.map(at) : at - intervalStartMs;
    const covered = target.some((a) => (kind === "impact" || kind === "bass_hit" ? ["impact", "drop", "bass_hit"] : [kind + "_end"]).includes(a.kind) && Math.abs(a.timeMs - there) <= 60);
    if (covered) continue;
    // Measured in the reference: the effect's peak over the music bed just before it.
    const peak = Math.max(...levels(reference, at - 100, at + 400), -120);
    const bed = median(levels(reference, at - 2000, at - 300).filter((v) => v > peak - 60)) ?? median(levels(reference, at + 1500, at + 3000)) ?? peak - 12;
    const relativeGainDb = Math.max(-12, Math.min(30, peak - bed));
    const peakAt = reference.loudness.filter((p) => p.timeMs >= at - 100 && p.timeMs <= at + 400).sort((a, b) => b.db - a.db)[0]?.timeMs ?? at;
    const fallen = reference.loudness.find((p) => p.timeMs > peakAt && p.db <= peak - 20);
    const releaseMs = Math.max(80, Math.min(3000, (fallen?.timeMs ?? peakAt + 1500) - peakAt));
    const attackMs = rising ? Math.max(150, (e.endMs ?? e.timeMs) - e.timeMs) : Math.max(5, Math.min(200, peakAt - at));
    const shares = e.measured as Record<string, number>;
    const durationMs = rising ? Math.max(150, (e.endMs ?? e.timeMs) - e.timeMs) : Math.min(kind === "impact" ? 1400 : 900, releaseMs + attackMs);
    // In the replacement: the same relation to its music bed at the mapped time, never above −3 dBFS.
    const repBed = (replacement ? median(levels(replacement, there - 2000, there - 300)) : undefined) ?? -20;
    const targetPeak = Math.min(-3, repBed + musicGainDb + relativeGainDb);
    const gainDb = Math.max(-60, Math.min(12, targetPeak - synthPeakDb(kind as SoundKind)));
    out.push({
      kind: kind as SoundKind,
      startMs: Math.max(0, rising ? at - durationMs : at),
      durationMs,
      gainDb: Number(gainDb.toFixed(1)),
      relativeGainDb: Number(relativeGainDb.toFixed(1)),
      attackMs: Math.round(attackMs),
      releaseMs: Math.round(releaseMs),
      ...(shares.lowShare !== undefined ? { balance: { low: shares.lowShare, mid: shares.midShare ?? 0, high: shares.highShare ?? 0 } } : {}),
      reason: `${e.kind} at ${(e.timeMs / 1000).toFixed(3)} s${linked ? " triggers a visual event" : ""}; the replacement has none there; reference level ${relativeGainDb >= 0 ? "+" : ""}${relativeGainDb.toFixed(1)} dB over its music`,
    });
  }
  return out;
}
