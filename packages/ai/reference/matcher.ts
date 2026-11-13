import type { Shot, RecreationMode } from "./dna";
import {
  averageEmbedding,
  embeddingSimilarity,
  measuredLayout,
  layoutSimilarity,
} from "./visual";
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
  longestLater = 0,
) {
  let best:
    | {
        range: Range;
        first: number;
        length: number;
        score: number;
        timingCoverage: number;
        motion: number | null;
      }
    | undefined;
  // An early trim can split the only take long enough for a later hold.
  let largest: Range | undefined,
    secondCapacity = 0;
  if (longestLater > 0) {
    for (const range of pool) {
      const capacity = range.end - range.first;
      if (!largest || capacity > largest.end - largest.first) {
        secondCapacity = largest ? largest.end - largest.first : 0;
        largest = range;
      } else secondCapacity = Math.max(secondCapacity, capacity);
    }
  }
  for (const range of pool) {
    const { source, shot, first, end } = range;
    const otherCapacity =
      largest && largest !== range
        ? largest.end - largest.first
        : secondCapacity;
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
      const comparable = observations.length
        ? observations
        : (source.analysis.vision?.frames.filter(
            (f) => f.sceneStartMs === shot.startMs,
          ) ?? []);
      const visualFit = embeddingSimilarity(
        ref.embedding,
        averageEmbedding(comparable.map((f) => f.embedding)),
      );
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
      const timingCoverage =
        mode === "Close Match"
          ? length + Math.min(longestLater, Math.max(otherCapacity, remaining))
          : 0;
      const reserve = nextWanted > 0 ? Math.min(1, remaining / nextWanted) : 1;
      const sameSubject =
        ref.subject &&
        observations.some((f) => f.subject?.label === ref.subject);
      const compositionFit = layoutSimilarity(
        ref.layout,
        measuredLayout(source.visual ?? [], t0, t1),
      );
      const score =
        (4 * length) / target +
        visibility * 0.8 +
        (visualFit === null ? 0.5 : (visualFit + 1) / 2) *
          (mode === "Creative Remix" ? 0.3 : 1.2) +
        (compositionFit ?? 0.5) * (mode === "Creative Remix" ? 0.25 : 0.8) +
        (framing && ref.framing === framing ? 0.55 : 0) +
        (sameSubject ? 0.3 : 0) +
        motionFit * (mode === "Creative Remix" ? 0.2 : 0.9) +
        (mode === "Creative Remix" ? action * 1.7 : 0) +
        reserve * 0.8 -
        (repeat ? 0.42 : 0) -
        (continuous && !chronological ? 0.8 : 0);
      if (
        !best ||
        timingCoverage > best.timingCoverage ||
        (timingCoverage === best.timingCoverage && score > best.score)
      )
        best = { range, first: start, length, score, timingCoverage, motion };
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
