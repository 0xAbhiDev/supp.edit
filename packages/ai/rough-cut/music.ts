import type { BeatMap } from "../media-analysis/model";
import { strongEvents } from "./beats";
export type MusicEventKind =
  | "beat"
  | "strong-onset"
  | "energy-rise"
  | "energy-fall"
  | "section-change"
  | "possible-drop";
export interface MusicEvent {
  kind: MusicEventKind;
  timeMs: number;
  strength: number;
  /** Heuristic evidence confidence, not a calibrated musical classifier probability. */
  confidence: number;
  evidence: string;
}
const unit = (x: number) => Math.max(0, Math.min(1, x));
/** Derives events from actual onsets and energy samples; never synthesizes a beat grid/downbeats. */
export function musicEvents(map: BeatMap, endMs = Infinity): MusicEvent[] {
  const out: MusicEvent[] = map.beats
    .filter((b) => b.timeMs < endMs)
    .map((b) => ({
      kind: "beat",
      ...b,
      confidence: map.confidence,
      evidence: "Measured beat candidate",
    }));
  const strong = strongEvents(map).filter((e) => e.timeMs < endMs);
  out.push(
    ...strong.map((e) => ({
      kind: "strong-onset" as const,
      ...e,
      confidence: 0.65,
      evidence: "Upper-strength measured onset/beat candidate",
    })),
  );
  const energy = [...map.energyCurve].sort((a, b) => a.timeMs - b.timeMs);
  const average = (from: number, to: number) => {
    const values = energy.filter((e) => e.timeMs >= from && e.timeMs < to);
    if (
      values.length < 3 ||
      values[0].timeMs > from + 250 ||
      values.at(-1)!.timeMs < to - 250 ||
      values.some((e, i) => i && e.timeMs - values[i - 1].timeMs > 300)
    )
      return null;
    // Average power, not logarithmic dB values.
    return (
      10 *
      Math.log10(
        values.reduce((n, e) => n + 10 ** (e.rmsDb / 10), 0) / values.length,
      )
    );
  };
  const last = new Map<MusicEventKind, number>();
  const add = (event: MusicEvent) => {
    if (event.timeMs - (last.get(event.kind) ?? -Infinity) >= 2500) {
      out.push(event);
      last.set(event.kind, event.timeMs);
    }
  };
  const end = Math.min(endMs, energy.at(-1)?.timeMs ?? 0);
  for (let time = 1500; time + 1500 < end; time += 500) {
    const before = average(time - 1500, time),
      after = average(time, time + 1500);
    if (before === null || after === null || Math.max(before, after) < -65)
      continue;
    const delta = after - before;
    if (Math.abs(delta) < 4) continue;
    const strength = unit(Math.abs(delta) / 12),
      confidence = unit(0.45 + Math.abs(delta) / 30);
    add({
      kind: delta > 0 ? "energy-rise" : "energy-fall",
      timeMs: time,
      strength,
      confidence,
      evidence: `Measured 1.5s mean-power change ${delta.toFixed(1)} dB`,
    });
    const previous = average(time - 3000, time),
      next = average(time, time + 3000);
    if (previous !== null && next !== null && Math.abs(next - previous) >= 4) {
      add({
        kind: "section-change",
        timeMs: time,
        strength,
        confidence: confidence * 0.85,
        evidence: `Sustained 3s energy change ${(next - previous).toFixed(1)} dB; possible musical boundary`,
      });
      const onset = strong
        .filter((e) => Math.abs(e.timeMs - time) <= 250)
        .sort((a, b) => b.strength - a.strength)[0];
      if (delta >= 6 && next - previous >= 5 && onset)
        add({
          kind: "possible-drop",
          timeMs: onset.timeMs,
          strength: unit((strength + onset.strength) / 2),
          confidence: confidence * 0.8,
          evidence: `Strong measured onset plus sustained ${delta.toFixed(1)} dB energy rise; not a verified downbeat`,
        });
    }
  }
  return out.sort(
    (a, b) => a.timeMs - b.timeMs || a.kind.localeCompare(b.kind),
  );
}
export function eventImpact(
  events: readonly MusicEvent[],
  timeMs: number,
  windowMs = 400,
) {
  return events
    .filter((e) => Math.abs(e.timeMs - timeMs) <= windowMs)
    .reduce(
      (n, e) =>
        Math.max(
          n,
          e.strength *
            e.confidence *
            {
              beat: 0.45,
              "strong-onset": 0.8,
              "energy-rise": 0.7,
              "energy-fall": 0.4,
              "section-change": 0.8,
              "possible-drop": 1,
            }[e.kind],
        ),
      0,
    );
}
