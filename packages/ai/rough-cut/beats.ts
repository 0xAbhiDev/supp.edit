import { type BeatMap } from "../media-analysis/model";
export interface MusicalEvent {
  timeMs: number;
  strength: number;
}
/** Strong means a measured onset in the upper strength quartile, not an inferred downbeat. */
export function strongEvents(map: BeatMap): MusicalEvent[] {
  const byTime = new Map<number, MusicalEvent>();
  for (const b of [...map.beats, ...map.onsets])
    if (b.strength > (byTime.get(b.timeMs)?.strength ?? -1))
      byTime.set(b.timeMs, b);
  const all = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
  const strengths = all.map((b) => b.strength).sort((a, b) => a - b);
  const threshold = Math.max(
    0.35,
    strengths[Math.floor(strengths.length * 0.65)] ?? 1,
  );
  return all.filter((b) => b.strength >= threshold);
}
export function nearestStrongBeat(
  map: BeatMap,
  timeMs: number,
  toleranceMs: number,
) {
  return (
    strongEvents(map)
      .filter((b) => Math.abs(b.timeMs - timeMs) <= toleranceMs)
      .sort(
        (a, b) =>
          Math.abs(a.timeMs - timeMs) - Math.abs(b.timeMs - timeMs) ||
          b.strength - a.strength,
      )[0] ?? null
  );
}
export function nextStrongBeat(map: BeatMap, timeMs: number) {
  return strongEvents(map).find((b) => b.timeMs > timeMs) ?? null;
}
