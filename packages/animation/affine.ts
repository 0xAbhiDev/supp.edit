import type { Clip, Project } from "../project-schema";
import { resolveClip } from "./index";

/** Canvas affine convention: [a,b,c,d,e,f], acting on column vectors. */
export type Affine = [number, number, number, number, number, number];
export const identity = (): Affine => [1, 0, 0, 1, 0, 0];
export function multiply(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverse(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw new Error("Transform is too close to singular to edit safely");
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}
export function point(m: Affine, x: number, y: number) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
export function localMatrix(clip: Clip, frame: number): Affine {
  const t = resolveClip(clip, frame).transform,
    r = (t.rotation * Math.PI) / 180,
    a = Math.cos(r) * t.scale * t.scaleX,
    b = Math.sin(r) * t.scale * t.scaleX,
    c = -Math.sin(r) * t.scale * t.scaleY,
    d = Math.cos(r) * t.scale * t.scaleY;
  return [
    a,
    b,
    c,
    d,
    t.x - a * t.anchorX - c * t.anchorY,
    t.y - b * t.anchorX - d * t.anchorY,
  ];
}
/** Parents are evaluated at composition time even outside their visible interval.
 * Visibility, opacity, effects and source pixels are not inherited. */
export function layerTransforms(project: Project, frame: number) {
  const clips = new Map(project.clips.map((c) => [c.id, c])),
    memo = new Map<string, Affine>(),
    visiting = new Set<string>();
  const world = (id: string): Affine => {
    const cached = memo.get(id);
    if (cached) return cached;
    const clip = clips.get(id);
    if (!clip) throw new Error("Parent layer no longer exists");
    if (visiting.has(id) || visiting.size > 64)
      throw new Error("Invalid parenting hierarchy");
    visiting.add(id);
    const parent = clip.parentId ? world(clip.parentId) : identity();
    const matrix = multiply(
      multiply(parent, clip.parentOffset),
      localMatrix(clip, frame),
    );
    visiting.delete(id);
    if (matrix.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e12))
      throw new Error("Parenting transform exceeds the render range");
    memo.set(id, matrix);
    return matrix;
  };
  return {
    world,
    basis: (id: string): Affine => {
      const c = clips.get(id);
      if (!c) throw new Error("Layer no longer exists");
      return multiply(
        c.parentId ? world(c.parentId) : identity(),
        c.parentOffset,
      );
    },
  };
}
export const canvasMatrix = (project: Project, world: Affine): Affine =>
  multiply(
    [1, 0, 0, 1, project.settings.width / 2, project.settings.height / 2],
    world,
  );
export const matrix3 = (m: Affine) =>
  new Float32Array([m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
