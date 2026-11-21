/** CameraSignature: how the camera itself moves over a window, from the per-frame global flow
 * (sub-pixel `fineX/fineY/fineZoom` when measured, the whole-pixel estimate otherwise), shared by
 * reference analysis and source matching.
 *
 * Units: translation in frame widths/heights (x right, y down), scale as relative size change,
 * speeds per second; curves are resampled to 16 points over normalized shot time. Block flow
 * cannot separate an orbit (parallax) from a pan, so orbits are never claimed; with little
 * confident flow the interpretation is "uncertain", never a forced label. */
import { z } from "zod";
import type { VisualFrame } from "./visual";

export const cameraKinds = ["static", "pan", "tilt", "push-in", "pull-out", "handheld", "uncertain"] as const;
const curve = z.array(z.number().finite()).length(16);
export const cameraSignatureSchema = z
  .object({
    translationX: curve,
    translationY: curve,
    scale: curve,
    velocity: curve,
    acceleration: curve,
    /** Net movement over the window (frame fractions) and its direction (radians, y down). */
    netX: z.number().finite(),
    netY: z.number().finite(),
    netScale: z.number().finite(),
    /** Distance travelled per second (frame fractions), whatever the direction. */
    speed: z.number().nonnegative(),
    /** 1 = steady glide; low = jittery (handheld) relative to the distance travelled. */
    smoothness: z.number().min(0).max(1),
    kind: z.enum(cameraKinds),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type CameraSignature = z.infer<typeof cameraSignatureSchema>;

const resample = (xs: number[], n = 16) => Array.from({ length: n }, (_, i) => (xs.length ? xs[Math.min(xs.length - 1, Math.round((i * (xs.length - 1)) / (n - 1)))] : 0));
const r4 = (v: number) => Number(v.toFixed(4));

export function cameraSignature(frames: readonly VisualFrame[], startMs: number, endMs: number): CameraSignature | undefined {
  const inside = frames.filter((f) => f.timeMs > startMs && f.timeMs <= endMs);
  if (inside.length < 4) return undefined;
  const step = (inside.at(-1)!.timeMs - inside[0].timeMs) / Math.max(1, inside.length - 1) || 33;
  const fps = 1000 / step;
  const confident = inside.filter((f) => f.flow && f.flow.confidence >= 0.5);
  const per = inside.map((f) => {
    const flow = f.flow && f.flow.confidence >= 0.5 ? f.flow : undefined;
    return {
      dx: flow ? (flow.fineX ?? flow.panX) / 96 : 0,
      dy: flow ? (flow.fineY ?? flow.panY) / 54 : 0,
      ds: flow ? (flow.fineZoom ?? flow.expansion) : 0,
    };
  });
  let x = 0,
    y = 0,
    s = 0;
  const tx: number[] = [],
    ty: number[] = [],
    sc: number[] = [],
    vel: number[] = [];
  for (const p of per) {
    x += p.dx;
    y += p.dy;
    s += p.ds;
    tx.push(x);
    ty.push(y);
    sc.push(s);
    vel.push(Math.hypot(p.dx, p.dy) * fps);
  }
  const acc = vel.map((v, i) => (i ? (v - vel[i - 1]) * fps : 0));
  const seconds = (inside.length * step) / 1000;
  const path = per.reduce((a, p) => a + Math.hypot(p.dx, p.dy), 0);
  const jitter = per.reduce((a, p, i) => (i ? a + Math.hypot(p.dx - per[i - 1].dx, p.dy - per[i - 1].dy) : a), 0);
  const smoothness = path > 1e-6 ? Math.max(0, Math.min(1, 1 - jitter / (2 * path))) : 1;
  const confidence = Math.min(1, (confident.length / inside.length) * (confident.reduce((a, f) => a + f.flow!.confidence, 0) / Math.max(1, confident.length)));
  const net = Math.hypot(x, y);
  let kind: CameraSignature["kind"];
  if (confidence < 0.35) kind = "uncertain";
  else if (path < 0.02 && Math.abs(s) < 0.03) kind = "static";
  else if (Math.abs(s) >= 0.03 && Math.abs(s) > 1.5 * net) kind = s > 0 ? "push-in" : "pull-out";
  else if (net < 0.35 * path && smoothness < 0.6) kind = "handheld";
  else kind = Math.abs(x) >= Math.abs(y) ? "pan" : "tilt";
  return {
    translationX: resample(tx).map(r4),
    translationY: resample(ty).map(r4),
    scale: resample(sc).map(r4),
    velocity: resample(vel).map(r4),
    acceleration: resample(acc).map(r4),
    netX: r4(x),
    netY: r4(y),
    netScale: r4(s),
    speed: r4(path / Math.max(0.05, seconds)),
    smoothness: r4(smoothness),
    kind,
    confidence: r4(confidence),
  };
}

const moving = (c: CameraSignature) => c.kind !== "static" && c.kind !== "uncertain";
const shape = (a: number[], b: number[]) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length,
    mb = b.reduce((s, v) => s + v, 0) / b.length;
  let n = 0,
    da = 0,
    db = 0;
  a.forEach((v, i) => {
    n += (v - ma) * (b[i] - mb);
    da += (v - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return da > 1e-12 && db > 1e-12 ? (1 + n / Math.sqrt(da * db)) / 2 : 0.75;
};

/** How alike two camera movements are (0–1): kind, direction, speed, scale change, velocity
 * shape and smoothness. A moving camera against a still one is far apart. An uncertain side
 * gives a neutral 0.5 (missing evidence is not agreement). */
export function cameraSimilarity(a: CameraSignature, b: CameraSignature) {
  if (a.kind === "uncertain" || b.kind === "uncertain") return 0.5;
  if (!moving(a) && !moving(b)) return 1;
  if (moving(a) !== moving(b)) return 0.1;
  const na = Math.hypot(a.netX, a.netY),
    nb = Math.hypot(b.netX, b.netY);
  const direction = na > 1e-4 && nb > 1e-4 ? Math.max(0, (a.netX * b.netX + a.netY * b.netY) / (na * nb)) : 0.5;
  const zoom = Math.sign(a.netScale) === Math.sign(b.netScale) || (Math.abs(a.netScale) < 0.03 && Math.abs(b.netScale) < 0.03) ? 1 : 0;
  const speed = Math.exp(-Math.abs(Math.log((a.speed + 0.005) / (b.speed + 0.005))) / 0.7);
  const kind = a.kind === b.kind ? 1 : (a.kind === "pan" && b.kind === "tilt") || (a.kind === "tilt" && b.kind === "pan") ? 0.4 : 0.2;
  const form = shape(a.velocity, b.velocity);
  const steady = 1 - Math.abs(a.smoothness - b.smoothness);
  return Number((0.25 * kind + 0.25 * direction + 0.15 * zoom + 0.15 * speed + 0.1 * form + 0.1 * steady).toFixed(3));
}
