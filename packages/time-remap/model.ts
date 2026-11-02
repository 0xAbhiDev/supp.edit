import { z } from "zod";
export const speedKeySchema = z
  .object({
    frame: z.number().int().min(-2_000_000_000).max(2_000_000_000),
    speed: z.number().finite().min(0.25).max(4),
    easing: z.enum(["linear", "smooth"]),
  })
  .strict();
export const timeRemapSchema = z
  .object({
    // Fractional source position retained when a ramp is split or trimmed.
    sourceOffset: z.number().finite().min(0).lt(1),
    keys: z
      .array(speedKeySchema)
      .min(1)
      .max(128)
      .refine(
        (keys) => keys.every((k, i) => !i || k.frame > keys[i - 1].frame),
        "Speed keys must have strictly increasing times",
      ),
  })
  .strict();
export type TimeRemap = z.infer<typeof timeRemapSchema>;
export type SpeedKey = z.infer<typeof speedKeySchema>;
export interface TimedSource {
  sourceIn: number;
  timeRemap?: TimeRemap;
}
function primitive(map: TimeRemap, time: number) {
  const keys = map.keys,
    first = keys[0];
  if (time <= first.frame) return (time - first.frame) * first.speed;
  let total = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1],
      width = b.frame - a.frame,
      u = Math.min(1, (time - a.frame) / width);
    // Analytic integral of linear speed or smoothstep speed. No numerical drift.
    const area =
      a.easing === "smooth" ? u * u * u - 0.5 * u * u * u * u : (u * u) / 2;
    total += width * (a.speed * u + (b.speed - a.speed) * area);
    if (time <= b.frame) return total;
  }
  const last = keys[keys.length - 1];
  return total + (time - last.frame) * last.speed;
}
/** Frame units belong to the containing sequence, even if the source has a different FPS. */
export function sourceFrameAt(source: TimedSource, localFrame: number): number {
  const map = source.timeRemap;
  return (
    source.sourceIn +
    (map
      ? map.sourceOffset + primitive(map, localFrame) - primitive(map, 0)
      : localFrame)
  );
}
export function speedAt(source: TimedSource, localFrame: number): number {
  const keys = source.timeRemap?.keys;
  if (!keys) return 1;
  if (localFrame <= keys[0].frame) return keys[0].speed;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (localFrame <= b.frame) {
      const t = (localFrame - a.frame) / (b.frame - a.frame),
        u = a.easing === "smooth" ? t * t * (3 - 2 * t) : t;
      return a.speed + (b.speed - a.speed) * u;
    }
  }
  return keys[keys.length - 1].speed;
}
/** Inverse is unique because supported speed is strictly positive. */
export function timelineFrameAt(
  source: TimedSource,
  sourceFrame: number,
): number {
  if (!source.timeRemap) return sourceFrame - source.sourceIn;
  const delta = sourceFrame - sourceFrameAt(source, 0);
  let lo = Math.min(delta / 0.25, delta / 4),
    hi = Math.max(delta / 0.25, delta / 4);
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    if (sourceFrameAt(source, mid) < sourceFrame) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Preserve the entire curve outside the visible interval so trims can be extended again. */
export function offsetSource(source: TimedSource, delta: number) {
  if (!source.timeRemap) {
    source.sourceIn += delta;
    return;
  }
  const at = sourceFrameAt(source, delta),
    integer = Math.floor(at + 1e-10);
  source.timeRemap.sourceOffset = Math.max(0, at - integer);
  source.sourceIn = integer;
  source.timeRemap.keys = source.timeRemap.keys.map((k) => ({
    ...k,
    frame: k.frame - delta,
  }));
}
