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

/** Shape of one contour, or undefined for an empty or degenerate one. */
export function silhouette(points: PersonSample["points"], frameAspect: number): SubjectShape | undefined {
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

/** Record the reference subject's typical shape on each shot that shows a person. */
export function annotateSubjects(
  dna: { shots: { startMs: number; endMs: number; subjectShape?: SubjectShape }[] },
  people: PersonSample[],
  frameAspect: number,
) {
  for (const shot of dna.shots) {
    const shape = shapeOver(people, shot.startMs, shot.endMs, frameAspect);
    if (shape) shot.subjectShape = shape;
  }
}
