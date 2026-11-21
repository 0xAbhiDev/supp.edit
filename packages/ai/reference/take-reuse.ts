/** Whether an alternative take would show a moment another shot of the edit already shows.
 *
 * Intervals are compared on the source asset's clock after trims and speed changes: a layer plays
 * from `sourceFrameAt(layer, 0)` to `sourceFrameAt(layer, duration)`. A take "materially overlaps"
 * another shot when they share at least 250 ms of the same asset, or at least 30% of the shorter
 * of the two; touching or separate moments of one long clip do not count. Deliberate reuse stays
 * possible — this only names the shot it would repeat. */
import type { Project } from "../../project-schema";
import { compositionView } from "../../commands/compositions";
import { sourceFrameAt } from "../../time-remap/model";

export interface PlayedInterval {
  clipId: string;
  sourceId: string;
  inMs: number;
  outMs: number;
}
export interface Reuse {
  clipId: string;
  overlapMs: number;
  /** Overlap as a share of the shorter interval. */
  share: number;
}

export const REUSE_MIN_MS = 250;
export const REUSE_MIN_SHARE = 0.3;

/** The source interval each listed layer of a composition actually plays, as it is now. */
export function playedIntervals(project: Project, compositionId: string, clipIds: ReadonlySet<string>): PlayedInterval[] {
  const view = compositionView(project, compositionId);
  const rate = view.settings.fps.num / view.settings.fps.den;
  return view.clips
    .filter((l) => clipIds.has(l.id) && l.kind === "media" && !!l.assetId)
    .map((l) => {
      const a = sourceFrameAt(l, 0),
        b = sourceFrameAt(l, l.duration);
      return { clipId: l.id, sourceId: l.assetId!, inMs: (Math.min(a, b) * 1000) / rate, outMs: (Math.max(a, b) * 1000) / rate };
    });
}

/** The other shots a take would repeat (material overlap only), largest overlap first. */
export function reuseOf(take: { sourceId: string; inMs: number; outMs: number }, others: readonly PlayedInterval[]): Reuse[] {
  return others
    .filter((o) => o.sourceId === take.sourceId)
    .map((o) => {
      const overlapMs = Math.min(o.outMs, take.outMs) - Math.max(o.inMs, take.inMs);
      const shorter = Math.max(1, Math.min(o.outMs - o.inMs, take.outMs - take.inMs));
      return { clipId: o.clipId, overlapMs, share: overlapMs / shorter };
    })
    .filter((r) => r.overlapMs > 0 && (r.overlapMs >= REUSE_MIN_MS || r.share >= REUSE_MIN_SHARE))
    .sort((a, b) => b.overlapMs - a.overlapMs);
}
