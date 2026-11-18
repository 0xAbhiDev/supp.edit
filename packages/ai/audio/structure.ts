/** Musical structure from a measured audio timeline: labelled sections and beat/bar/phrase
 * coordinates. Labels are general descriptions of energy and function (intro, build, drop,
 * energetic, phrase, breakdown, outro, silence, dialogue), inferred from measured boundaries and
 * levels; they are not music-theory claims. Nothing here depends on a particular track. */
import type { AudioTimeline } from "./timeline";

export const segmentLabels = ["intro", "build", "drop", "energetic", "phrase", "breakdown", "outro", "silence", "dialogue"] as const;
export type SegmentLabel = (typeof segmentLabels)[number];
export interface Segment {
  startMs: number;
  endMs: number;
  label: SegmentLabel;
  /** What opens the segment: start, drop, silence_start, silence_end, sweep_peak, section, sweep_start. */
  opens: string;
  energyDb: number;
  /** Attacks per second. */
  density: number;
  confidence: number;
}

const opensRank: Record<string, number> = { start: 9, drop: 8, silence_start: 7, silence_end: 7, sweep_peak: 6, section: 4, sweep_start: 3, fade_out: 3 };

export function segmentsOf(a: AudioTimeline): Segment[] {
  const marks: { t: number; kind: string }[] = [{ t: 0, kind: "start" }];
  for (const e of a.events) {
    if (e.kind === "drop") marks.push({ t: e.timeMs, kind: "drop" });
    else if (e.kind === "section") marks.push({ t: e.timeMs, kind: "section" });
    else if (e.kind === "silence") {
      marks.push({ t: e.timeMs, kind: "silence_start" });
      if (e.endMs !== undefined) marks.push({ t: e.endMs, kind: "silence_end" });
    } else if (e.kind === "riser" || e.kind === "whoosh") {
      if (e.endMs !== undefined && e.endMs - e.timeMs >= 800) marks.push({ t: e.timeMs, kind: "sweep_start" });
      if (e.endMs !== undefined) marks.push({ t: e.endMs, kind: "sweep_peak" });
    } else if (e.kind === "fade_out") marks.push({ t: e.timeMs, kind: "fade_out" });
  }
  // Nearby boundaries collapse onto the most telling one.
  marks.sort((x, y) => x.t - y.t);
  const merged: typeof marks = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m.t - last.t < 600) {
      if ((opensRank[m.kind] ?? 0) > (opensRank[last.kind] ?? 0)) merged[merged.length - 1] = m;
    } else if (m.t < a.durationMs - 300) merged.push(m);
  }
  const level = (s: number, e: number) => {
    const pts = a.loudness.filter((p) => p.timeMs >= s && p.timeMs < e).map((p) => p.db);
    return pts.length ? pts.reduce((x, y) => x + y, 0) / pts.length : -120;
  };
  const attacks = a.events.filter((e) => ["kick", "snare", "hat", "onset", "impact", "bass_hit"].includes(e.kind)).map((e) => e.timeMs);
  const words = a.events.filter((e) => e.kind === "word");
  const silences = a.events.filter((e) => e.kind === "silence");
  const raw = merged.map((m, k) => {
    const endMs = merged[k + 1]?.t ?? a.durationMs;
    const dur = Math.max(1, endMs - m.t);
    const silent = silences.reduce((s, e) => s + Math.max(0, Math.min(endMs, e.endMs ?? e.timeMs) - Math.max(m.t, e.timeMs)), 0) / dur;
    const spoken = words.reduce((s, w) => s + Math.max(0, Math.min(endMs, w.endMs ?? w.timeMs) - Math.max(m.t, w.timeMs)), 0) / dur;
    return {
      startMs: m.t,
      endMs,
      opens: m.kind,
      energyDb: Number(level(m.t, endMs).toFixed(2)),
      density: Number(((attacks.filter((t) => t >= m.t && t < endMs).length * 1000) / dur).toFixed(2)),
      silent,
      spoken,
      sweepIntoEnd: a.events.some((e) => (e.kind === "riser" || e.kind === "whoosh") && e.endMs !== undefined && Math.abs(e.endMs - endMs) <= 600 && e.endMs - e.timeMs >= 300),
    };
  });
  const audible = raw.filter((r) => r.silent < 0.7).map((r) => r.energyDb).sort((x, y) => x - y);
  const median = audible.length ? audible[audible.length >> 1] : -30;
  return raw.map((r, k): Segment => {
    let label: SegmentLabel = "phrase",
      confidence = 0.5;
    if (r.silent >= 0.7) [label, confidence] = ["silence", 0.95];
    // Speech over sparse drums is dialogue; sung words over a groove are still music.
    else if (r.spoken >= 0.4 && r.density < 1.5) [label, confidence] = ["dialogue", 0.7];
    else if (r.opens === "drop") [label, confidence] = ["drop", 0.8];
    else if (r.sweepIntoEnd || r.opens === "sweep_start") [label, confidence] = ["build", 0.7];
    else if (k === 0 && raw.length > 1 && r.energyDb < median - 3) [label, confidence] = ["intro", 0.6];
    else if (k === raw.length - 1 && raw.length > 1 && (r.energyDb < median - 3 || r.opens === "fade_out")) [label, confidence] = ["outro", 0.6];
    else if (r.energyDb < median - 4) [label, confidence] = ["breakdown", 0.55];
    else if (r.energyDb >= median + 2) [label, confidence] = ["energetic", 0.55];
    return { startMs: r.startMs, endMs: r.endMs, label, opens: r.opens, energyDb: r.energyDb, density: r.density, confidence };
  });
}

/** Labels that can stand in for each other when sections are aligned. */
export function labelCost(a: SegmentLabel, b: SegmentLabel) {
  if (a === b) return 0;
  const high = ["drop", "energetic"],
    mid = ["phrase", "intro", "outro", "breakdown"];
  if (high.includes(a) && high.includes(b)) return 0.25;
  if (mid.includes(a) && mid.includes(b)) return 0.35;
  if ((a === "build" && b === "phrase") || (a === "phrase" && b === "build")) return 0.5;
  return 1;
}

/** Fractional beat index at a time (beats extrapolated at the edge period), and its inverse. */
export function beatClock(a: AudioTimeline) {
  // Regularised: a gap of about k median beats (a quiet bar, a missed beat) gets k−1 evenly
  // spaced beats, so beat counting stays musical across it. Downbeats keep their times.
  const raw = a.beats.map((b) => b.timeMs);
  const ibis = raw.slice(1).map((v, i) => v - raw[i]).sort((x, y) => x - y);
  const medianIbi = ibis.length ? ibis[ibis.length >> 1] : 500;
  const t: number[] = [];
  raw.forEach((v, i) => {
    if (i) {
      const gap = v - raw[i - 1],
        k = Math.round(gap / medianIbi);
      if (gap > 1.5 * medianIbi) for (let j = 1; j < k; j++) t.push(raw[i - 1] + (gap * j) / k);
    }
    t.push(v);
  });
  const ok = t.length >= 2;
  const period = (i: number) => (ok ? t[Math.min(t.length - 1, Math.max(1, i))] - t[Math.min(t.length - 2, Math.max(0, i - 1))] : 500);
  const position = (ms: number) => {
    if (!ok) return ms / 500;
    if (ms <= t[0]) return (ms - t[0]) / period(1);
    if (ms >= t[t.length - 1]) return t.length - 1 + (ms - t[t.length - 1]) / period(t.length - 1);
    let lo = 0,
      hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= ms) lo = mid;
      else hi = mid;
    }
    return lo + (ms - t[lo]) / Math.max(1, t[hi] - t[lo]);
  };
  const time = (beat: number) => {
    if (!ok) return beat * 500;
    if (beat <= 0) return t[0] + beat * period(1);
    if (beat >= t.length - 1) return t[t.length - 1] + (beat - (t.length - 1)) * period(t.length - 1);
    const i = Math.floor(beat);
    return t[i] + (beat - i) * (t[i + 1] - t[i]);
  };
  // Bar phase: beats since the nearest preceding downbeat (only when downbeats were measured).
  const downbeats = a.beats.filter((b) => b.downbeat).map((b) => t.indexOf(b.timeMs)).filter((i) => i >= 0);
  const barPosition = (beat: number) => {
    if (!downbeats.length) return undefined;
    const first = downbeats[0];
    const inBar = (((beat - first) % 4) + 4) % 4;
    const bar = Math.floor((beat - first) / 4);
    return { bar, beatInBar: inBar, phrase: Math.floor(bar / 4), phraseProgress: ((((bar % 4) + 4) % 4) * 4 + inBar) / 16 };
  };
  return { position, time, barPosition, periodAt: (ms: number) => period(Math.round(position(ms))), medianPeriod: medianIbi, reliable: ok && a.beatConfidence >= 0.2 };
}

export function segmentAt(segments: Segment[], ms: number) {
  return segments.find((s) => ms >= s.startMs && ms < s.endMs) ?? segments[segments.length - 1];
}
