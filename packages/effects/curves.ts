/** Per-channel tone curves. Shared by the canvas and WebGL paths so both evaluate the same
 * monotone cubic (Fritsch–Carlson) through the same points. Levels are 0–1. */
export type CurvePoint = [number, number];
export interface CurveSet {
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}
export const CURVE_CHANNELS = ["red", "green", "blue"] as const;
export const MAX_CURVE_POINTS = 8;
export const identityCurves = (): CurveSet => ({
  red: [
    [0, 0],
    [1, 1],
  ],
  green: [
    [0, 0],
    [1, 1],
  ],
  blue: [
    [0, 0],
    [1, 1],
  ],
});

/** Tangents that keep each segment monotone wherever the points are. */
export function curveTangents(points: readonly CurvePoint[]) {
  const n = points.length,
    slopes: number[] = [],
    m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++)
    slopes.push((points[i + 1][1] - points[i][1]) / Math.max(1e-6, points[i + 1][0] - points[i][0]));
  if (n === 2) return [slopes[0], slopes[0]];
  m[0] = slopes[0];
  m[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++)
    m[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slopes[i],
      b = m[i + 1] / slopes[i],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slopes[i];
      m[i + 1] = t * b * slopes[i];
    }
  }
  return m;
}

/** Curve value at x. Outside the first and last points the end tangents continue linearly. */
export function curveAt(points: readonly CurvePoint[], tangents: readonly number[], x: number) {
  const n = points.length;
  let y: number;
  if (x <= points[0][0]) y = points[0][1] + tangents[0] * (x - points[0][0]);
  else if (x >= points[n - 1][0]) y = points[n - 1][1] + tangents[n - 1] * (x - points[n - 1][0]);
  else {
    let i = 0;
    while (x > points[i + 1][0]) i++;
    const [x0, y0] = points[i],
      [x1, y1] = points[i + 1],
      h = x1 - x0,
      t = (x - x0) / h,
      t2 = t * t,
      t3 = t2 * t;
    y =
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * h * tangents[i] +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * h * tangents[i + 1];
  }
  return Math.min(1, Math.max(0, y));
}

/** 256-entry lookup per channel, mixed with the identity by `strength`. */
export function curveTables(curves: CurveSet, strength = 1) {
  return CURVE_CHANNELS.map((channel) => {
    const points = curves[channel],
      tangents = curveTangents(points),
      table = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      const x = v / 255;
      table[v] = x + (curveAt(points, tangents, x) - x) * strength;
    }
    return table;
  });
}

/** x, y and tangent per point, eight per channel, for the shader's uniform array. */
export function curveUniforms(curves: CurveSet) {
  const data = new Float32Array(3 * MAX_CURVE_POINTS * 3),
    counts: number[] = [];
  CURVE_CHANNELS.forEach((channel, c) => {
    const points = curves[channel],
      tangents = curveTangents(points);
    counts.push(points.length);
    points.forEach(([x, y], i) => data.set([x, y, tangents[i]], (c * MAX_CURVE_POINTS + i) * 3));
  });
  return { data, counts };
}

/** Curve whose output matches `target` levels where the input has `source` levels.
 * Equal inputs are merged; the ends continue the nearest measured slope, bounded so black and
 * white stay reachable. */
export function matchingCurve(source: readonly number[], target: readonly number[]): CurvePoint[] {
  const pairs: CurvePoint[] = [];
  source.forEach((s, i) => {
    const x = s / 255,
      y = target[i] / 255,
      last = pairs.at(-1);
    if (last && x - last[0] < 2 / 255) last[1] = Math.max(last[1], y);
    else pairs.push([x, Math.max(y, last?.[1] ?? 0)]);
  });
  if (pairs.length < 2) return [
    [0, 0],
    [1, 1],
  ];
  const slope = (a: CurvePoint, b: CurvePoint) => (b[1] - a[1]) / Math.max(1e-6, b[0] - a[0]);
  const first = pairs[0],
    last = pairs[pairs.length - 1];
  if (first[0] > 1 / 255) {
    const s = Math.min(slope(first, pairs[1]), first[1] / first[0] + 4);
    pairs.unshift([0, Math.max(0, Math.min(first[1], first[1] - s * first[0]))]);
  }
  if (last[0] < 254 / 255) {
    // Above the brightest measured level nothing says how far to stretch. Continue at no more
    // than the identity slope so lights and labels in the raw footage are not blown out.
    const before = pairs[pairs.length - 2],
      s = Math.min(1, slope(before, last));
    pairs.push([1, Math.min(1, Math.max(last[1], last[1] + s * (1 - last[0])))]);
  }
  return pairs.slice(0, MAX_CURVE_POINTS).map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]);
}
