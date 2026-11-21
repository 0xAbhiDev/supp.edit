/** Body shape of the measured subject, for choosing raw footage whose person stands, crouches
 * or lies the way the reference's does. A contour is drawn into its own bounding box on a small
 * grid, so position and scale (which framing can change) do not count; pose and proportions do. */
import { z } from "zod";
import type { PersonSample } from "./subject-mask";

const GW = 12,
  GH = 24;
export const subjectShapeSchema = z
  .object({
    /** Bounding-box width over height in real pixels. */
    aspect: z.number().finite().positive().max(20),
    /** GH rows of GW-bit occupancy, top to bottom. */
    rows: z.array(z.number().int().min(0).max(2 ** GW - 1)).length(GH),
    /** Bounding-box height as a fraction of the frame. */
    height: z.number().min(0).max(1),
  })
  .strict();
export type SubjectShape = z.infer<typeof subjectShapeSchema>;

function inside(x: number, y: number, points: PersonSample["points"]) {
  let c = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

const drawn = new WeakMap<PersonSample["points"], Map<number, SubjectShape | undefined>>();
/** Shape of one contour, or undefined for an empty or degenerate one (memoised per contour:
 * the same measured sample is compared against many reference shots). */
export function silhouette(points: PersonSample["points"], frameAspect: number): SubjectShape | undefined {
  let byAspect = drawn.get(points);
  if (!byAspect) drawn.set(points, (byAspect = new Map()));
  if (byAspect.has(frameAspect)) return byAspect.get(frameAspect);
  const shape = draw(points, frameAspect);
  byAspect.set(frameAspect, shape);
  return shape;
}
function draw(points: PersonSample["points"], frameAspect: number): SubjectShape | undefined {
  if (points.length < 3) return;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  if (right - left < 0.01 || bottom - top < 0.01) return;
  const rows: number[] = [];
  for (let gy = 0; gy < GH; gy++) {
    let bits = 0;
    for (let gx = 0; gx < GW; gx++) {
      const x = left + ((gx + 0.5) / GW) * (right - left),
        y = top + ((gy + 0.5) / GH) * (bottom - top);
      if (inside(x, y, points)) bits |= 1 << gx;
    }
    rows.push(bits);
  }
  return { aspect: ((right - left) * frameAspect) / (bottom - top), rows, height: bottom - top };
}

/** Typical shape over a stretch of samples: majority occupancy, median proportions. */
export function typicalShape(shapes: SubjectShape[]): SubjectShape | undefined {
  if (!shapes.length) return;
  const mid = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
  const rows = Array.from({ length: GH }, (_, y) => {
    let bits = 0;
    for (let x = 0; x < GW; x++)
      if (shapes.filter((s) => s.rows[y] & (1 << x)).length * 2 >= shapes.length) bits |= 1 << x;
    return bits;
  });
  return { aspect: mid(shapes.map((s) => s.aspect)), rows, height: mid(shapes.map((s) => s.height)) };
}

export function shapeOver(samples: PersonSample[] | undefined, startMs: number, endMs: number, frameAspect: number) {
  return typicalShape(
    (samples ?? [])
      .filter((s) => s.timeMs >= startMs && s.timeMs < endMs)
      .flatMap((s) => silhouette(s.points, frameAspect) ?? []),
  );
}

const pop = (n: number) => {
  let c = 0;
  for (let v = n; v; v &= v - 1) c++;
  return c;
};
/** 0–1: occupancy overlap within the boxes, discounted by any difference in proportions. */
export function shapeFit(a: SubjectShape, b: SubjectShape) {
  let both = 0,
    any = 0;
  for (let y = 0; y < GH; y++) {
    both += pop(a.rows[y] & b.rows[y]);
    any += pop(a.rows[y] | b.rows[y]);
  }
  return (both / Math.max(1, any)) * Math.exp(-0.8 * Math.abs(Math.log(a.aspect / b.aspect)));
}

/** Person segmentation measured [start, end) and outlined nobody there (samples the object
 * detector contradicted arrive emptied, person-evidence.ts). Unmeasured is not absent. */
export function personAbsent(samples: readonly PersonSample[] | undefined, startMs: number, endMs: number) {
  const inside = (samples ?? []).filter((s) => s.timeMs >= startMs && s.timeMs < endMs);
  return inside.length >= 2 && inside.every((s) => s.points.length < 3);
}

/** Record the reference subject's typical shape on each shot that shows a person, and mark the
 * shots measured with nobody in them. */
export function annotateSubjects(
  dna: { shots: { startMs: number; endMs: number; subjectShape?: SubjectShape; subjectPath?: (SubjectShape | null)[]; subjectAbsent?: true }[] },
  people: PersonSample[],
  frameAspect: number,
) {
  for (const shot of dna.shots) {
    const shape = shapeOver(people, shot.startMs, shot.endMs, frameAspect);
    if (shape) shot.subjectShape = shape;
    else if (personAbsent(people, shot.startMs, shot.endMs)) shot.subjectAbsent = true;
    const path = shapePath(people, shot.startMs, shot.endMs, frameAspect);
    if (path.filter(Boolean).length * 2 >= path.length) shot.subjectPath = path.map((p) => p ?? null);
  }
}

/** The subject's outline at `steps` moments across [start, end): a pose trajectory. Each step is
 * the sample nearest its moment (undefined where no person is measured within 150 ms). */
export function shapePath(samples: PersonSample[] | undefined, startMs: number, endMs: number, frameAspect: number, steps = 8): (SubjectShape | undefined)[] {
  const inside = (samples ?? []).filter((s) => s.timeMs >= startMs - 150 && s.timeMs < endMs + 150 && s.points.length >= 3);
  return Array.from({ length: steps }, (_, k) => {
    const t = startMs + ((k + 0.5) / steps) * (endMs - startMs);
    let best: PersonSample | undefined;
    for (const s of inside) if (!best || Math.abs(s.timeMs - t) < Math.abs(best.timeMs - t)) best = s;
    return best && Math.abs(best.timeMs - t) <= 150 ? silhouette(best.points, frameAspect) : undefined;
  });
}

/** 0–1: how alike two pose trajectories are, aligned in time by dynamic time warping within a
 * band of two steps (the same movement performed a little faster or later still matches).
 * Undefined when either side measured a person at fewer than half the steps. */
export function pathFit(a: (SubjectShape | undefined)[], b: (SubjectShape | undefined)[]) {
  if (a.filter(Boolean).length * 2 < a.length || b.filter(Boolean).length * 2 < b.length) return undefined;
  const n = a.length,
    m = b.length,
    band = 2;
  const cost = (i: number, j: number) => (a[i] && b[j] ? 1 - shapeFit(a[i]!, b[j]!) : 0.6);
  const d = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => Infinity));
  const len = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  d[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      const options: [number, number][] = [
        [d[i - 1][j - 1], len[i - 1][j - 1]],
        [d[i - 1][j], len[i - 1][j]],
        [d[i][j - 1], len[i][j - 1]],
      ];
      const [best, steps] = options.reduce((x, y) => (y[0] < x[0] ? y : x));
      d[i][j] = best + cost(i - 1, j - 1);
      len[i][j] = steps + 1;
    }
  return Number.isFinite(d[n][m]) ? Math.max(0, 1 - d[n][m] / Math.max(1, len[n][m])) : undefined;
}
