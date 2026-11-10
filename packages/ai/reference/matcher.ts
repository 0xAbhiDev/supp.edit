import type { Shot, RecreationMode } from "./dna";
import type { SourceEvidence } from "./planner";
import { describeShots } from "./dna";

interface Range {
  source: SourceEvidence;
  shot: Shot;
  first: number;
  end: number;
}
export function availableRanges(sources: SourceEvidence[], rate: number) {
  return sources.flatMap((source) =>
    describeShots(source.asset, source.analysis)
      .map((shot) => ({
        source,
        shot,
        first: Math.ceil((shot.startMs * rate) / 1000),
        end: Math.floor((shot.endMs * rate) / 1000),
      }))
      .filter((r) => r.end - r.first >= 2),
  );
}
const bound = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Rank disjoint windows within real source scenes. Measure both trim points before committing either. */
export function matchRange(
  pool: Range[],
  ref: Shot,
  wanted: number,
  rate: number,
  mode: RecreationMode,
  previous: { source: string; sourceIn: number; duration: number } | undefined,
  nextWanted: number,
  chronological: boolean,
) {
  let best:
    | {
        range: Range;
        first: number;
        length: number;
        score: number;
        motion: number | null;
      }
    | undefined;
  for (const range of pool) {
    const { source, shot, first, end } = range;
    const relativeMotion =
      ref.motion !== null && shot.motion !== null
        ? bound(
            ((0.008 + ref.motion) / (0.008 + shot.motion)) ** 0.22,
            0.84,
            1.2,
          )
        : 1;
    // A slower-moving source needs a longer hold to convey a similar amount of action.
    const target = Math.max(
      2,
      Math.round(wanted * (mode === "Smart Adaptation" ? relativeMotion : 1)),
    );
    const length = Math.min(target, end - first);
    if (length < 2) continue;
    const last = end - length,
      stride = Math.max(Math.round(rate / 3), Math.ceil((last - first) / 16));
    const starts = new Set([first, last]);
    for (let frame = first + stride; frame < last; frame += stride)
      starts.add(frame);
    for (const start of starts) {
      if (
        chronological &&
        previous?.source === source.asset.id &&
        start < previous.sourceIn + previous.duration
      )
        continue;
      const t0 = (start * 1000) / rate,
        t1 = ((start + length) * 1000) / rate;
      const quality = source.analysis.video!.quality.filter(
        (f) => f.timeMs >= t0 && f.timeMs < t1,
      );
      const motion = quality.length
        ? quality.reduce((v, f) => v + f.frameDifference, 0) / quality.length
        : shot.motion;
      const visibility = quality.length
        ? quality.filter(
            (f) =>
              f.meanLuma > 0.045 &&
              f.meanLuma < 0.95 &&
              f.laplacianVariance > 4,
          ).length / quality.length
        : 0.5;
      if (quality.length && visibility === 0) continue;
      const observations =
        source.analysis.vision?.frames.filter(
          (f) => f.timeMs >= t0 && f.timeMs < t1,
        ) ?? [];
      const framing = observations[0]?.shotScale ?? shot.framing;
      const motionFit =
        motion !== null && ref.motion !== null
          ? Math.exp(
              -Math.abs(Math.log((0.008 + motion) / (0.008 + ref.motion))),
            )
          : 0.5;
      const action = motion === null ? 0 : motion / (motion + 0.03);
      const repeat = previous?.source === source.asset.id;
      const continuous =
        repeat &&
        Math.abs(start - (previous.sourceIn + previous.duration)) < rate * 0.24;
      const remaining = Math.max(start - first, end - start - length);
      const reserve = nextWanted > 0 ? Math.min(1, remaining / nextWanted) : 1;
      const sameSubject =
        ref.subject &&
        observations.some((f) => f.subject?.label === ref.subject);
      const score =
        (4 * length) / target +
        visibility * 0.8 +
        (framing && ref.framing === framing ? 0.55 : 0) +
        (sameSubject ? 0.3 : 0) +
        motionFit * (mode === "Creative Remix" ? 0.2 : 0.9) +
        (mode === "Creative Remix" ? action * 1.7 : 0) +
        reserve * 0.8 -
        (repeat ? 0.42 : 0) -
        (continuous && !chronological ? 0.8 : 0);
      if (!best || score > best.score)
        best = { range, first: start, length, score, motion };
    }
  }
  return best;
}

export function consumeRange(
  pool: Range[],
  range: Range,
  start: number,
  length: number,
) {
  const tails = [
    { ...range, end: start },
    { ...range, first: start + length },
  ].filter((r) => r.end - r.first >= 2);
  pool.splice(pool.indexOf(range), 1, ...tails);
}
