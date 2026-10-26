import { evaluate } from "../animation";
import { type BezierMask, type MaskVertex, maskRanges } from "./model";
export function maskVertices(mask: BezierMask, frame: number): MaskVertex[] {
  const keys = [...mask.pathKeys].sort((a, b) => a.frame - b.frame);
  if (!keys.length) return mask.vertices;
  if (frame <= keys[0].frame) return keys[0].vertices;
  const right = keys.findIndex((k) => k.frame > frame);
  if (right < 0) return keys[keys.length - 1].vertices;
  const a = keys[right - 1],
    b = keys[right];
  const t = a.easing === "hold" ? 0 : (frame - a.frame) / (b.frame - a.frame);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return a.vertices.map((v, i) => ({
    id: v.id,
    x: mix(v.x, b.vertices[i].x),
    y: mix(v.y, b.vertices[i].y),
    in: {
      x: mix(v.in.x, b.vertices[i].in.x),
      y: mix(v.in.y, b.vertices[i].in.y),
    },
    out: {
      x: mix(v.out.x, b.vertices[i].out.x),
      y: mix(v.out.y, b.vertices[i].out.y),
    },
  }));
}
export function resolveMask(mask: BezierMask, frame: number) {
  const result = { ...mask, vertices: maskVertices(mask, frame) };
  for (const key of ["opacity", "feather", "expansion"] as const) {
    const [min, max] = maskRanges[key];
    result[key] = Math.max(
      min,
      Math.min(max, evaluate(mask.keyframes[key], frame, mask[key])),
    );
  }
  return result;
}
/** Coordinates are normalized to the containing composition, before the layer transform. */
export function maskPath(
  vertices: MaskVertex[],
  width: number,
  height: number,
  centered = false,
): string {
  if (!vertices.length) return "";
  const ox = centered ? width / 2 : 0,
    oy = centered ? height / 2 : 0;
  const xy = (x: number, y: number) => `${x * width - ox},${y * height - oy}`;
  let d = "M" + xy(vertices[0].x, vertices[0].y);
  vertices.forEach((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    d +=
      " C" +
      xy(a.x + a.out.x, a.y + a.out.y) +
      " " +
      xy(b.x + b.in.x, b.y + b.in.y) +
      " " +
      xy(b.x, b.y);
  });
  return d + " Z";
}
