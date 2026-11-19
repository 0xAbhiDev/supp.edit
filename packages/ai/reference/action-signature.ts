/** Temporal action signature: how a stretch of footage moves, measured as geometry, never named.
 *
 * Two lifts, a pour and a stir, a walk and a vehicle pass can look alike in a single frame (same
 * room, same palette, same framing) and still be different actions. What separates them is the
 * movement itself over time:
 *  - energy: how much the picture changes, as a curve over the stretch (rises, holds, repeats);
 *  - regions: where in the frame the change happens (a 4×4 grid);
 *  - camera: global pan and zoom, separated from movement inside the frame;
 *  - rhythm: the repetition period of the movement and where its strongest moment falls;
 *  - subject: when a person is measured, the trajectory of their outline: centroid and height
 *    curves, the axis they travel along, how much they extend, and which part of the body outline
 *    moves in which direction (a coarse joint-trajectory stand-in from 10 Hz contours).
 * The same signature is measured for each reference shot and each candidate source window. */
import { z } from "zod";
import type { VisualFrame } from "./visual";
import { stabilize, type PersonSample } from "./subject-mask";

export const STEPS = 12;
const curve = z.array(z.number().finite()).length(STEPS);
export const actionSignatureSchema = z
  .object({
    durationMs: z.number().nonnegative(),
    /** Mean per-frame change (movement level, 0–1). */
    level: z.number().min(0).max(1),
    /** Movement over time, normalised to mean 1. */
    energy: curve,
    /** Share of movement in each cell of a 4×4 grid (sums to 1; uniform when nothing moves). */
    regions: z.array(z.number().min(0).max(1)).length(16),
    /** Global camera movement per second: pan in frame widths/heights, zoom as relative scale. */
    camera: z.object({ panX: z.number().finite(), panY: z.number().finite(), zoom: z.number().finite() }).strict(),
    /** Dominant repetition period of the movement (ms) and how periodic it is (0–1). */
    periodMs: z.number().positive().nullable(),
    periodicity: z.number().min(0).max(1),
    /** Where the strongest movement falls (0–1) and how clearly it stands out (max / mean). */
    peak: z.number().min(0).max(1),
    peakedness: z.number().nonnegative(),
    subject: z
      .object({
        cx: curve,
        cy: curve,
        height: curve,
        aspect: curve,
        /** Travel of the outline's centre across the stretch, in body heights. */
        travelX: z.number().nonnegative(),
        travelY: z.number().nonnegative(),
        /** Change of the outline's height across the stretch, in body heights. */
        stretch: z.number().nonnegative(),
        /** Outline movement by body third (top, middle, bottom) × axis (vertical, horizontal). */
        limbs: z.array(z.number().min(0).max(1)).length(6),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ActionSignature = z.infer<typeof actionSignatureSchema>;

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Resample (time, value) points to STEPS values across [start, end), by bin means with
 * interpolation for empty bins. */
function resample(points: readonly { t: number; v: number }[], start: number, end: number): number[] {
  const bins = Array.from({ length: STEPS }, () => [] as number[]);
  for (const p of points) {
    const k = Math.min(STEPS - 1, Math.max(0, Math.floor(((p.t - start) / Math.max(1, end - start)) * STEPS)));
    bins[k].push(p.v);
  }
  const out: (number | undefined)[] = bins.map((b) => (b.length ? mean(b) : undefined));
  for (let k = 0; k < STEPS; k++)
    if (out[k] === undefined) {
      let a = k - 1,
        b = k + 1;
      while (a >= 0 && out[a] === undefined) a--;
      while (b < STEPS && out[b] === undefined) b++;
      const va = a >= 0 ? out[a] : undefined,
        vb = b < STEPS ? out[b] : undefined;
      out[k] = va !== undefined && vb !== undefined ? va + ((vb - va) * (k - a)) / (b - a) : (va ?? vb ?? 0);
    }
  return out as number[];
}

/** Movement per frame, smoothed over ~170 ms so footage with repeated frames (below the delivery
 * rate) reads as continuous movement rather than alternating spikes and zeros. */
export function smoothedChange(frames: readonly VisualFrame[]): number[] {
  return frames.map((_, i) => {
    let s = 0,
      n = 0;
    for (let k = Math.max(1, i - 2); k <= Math.min(frames.length - 1, i + 2); k++) {
      s += frames[k].change;
      n++;
    }
    return n ? s / n : 0;
  });
}

function periodOf(values: readonly number[], stepMs: number): { periodMs: number | null; periodicity: number } {
  const m = mean(values);
  const x = values.map((v) => v - m);
  const energy = x.reduce((s, v) => s + v * v, 0);
  if (energy <= 1e-12 || values.length < 12) return { periodMs: null, periodicity: 0 };
  let best = 0,
    lag = 0;
  const minLag = Math.max(2, Math.round(300 / stepMs)),
    maxLag = Math.floor(values.length / 2);
  for (let l = minLag; l <= maxLag; l++) {
    let s = 0;
    for (let i = 0; i + l < x.length; i++) s += x[i] * x[i + l];
    const r = s / energy;
    if (r > best) {
      best = r;
      lag = l;
    }
  }
  return best >= 0.2 && lag ? { periodMs: Math.round(lag * stepMs), periodicity: Math.min(1, best) } : { periodMs: null, periodicity: Math.max(0, Math.min(1, best)) };
}

function subjectTrajectory(people: readonly PersonSample[], start: number, end: number, frameAspect: number): ActionSignature["subject"] {
  const inside = stabilize(people.filter((p) => p.timeMs >= start && p.timeMs < end && p.points.length >= 3));
  if (inside.length < 3) return null;
  const boxes = inside.map((p) => {
    const xs = p.points.map((q) => q[0]),
      ys = p.points.map((q) => q[1]);
    const top = Math.min(...ys),
      bottom = Math.max(...ys),
      left = Math.min(...xs),
      right = Math.max(...xs);
    return { t: p.timeMs, cx: mean(xs), cy: mean(ys), top, h: Math.max(0.01, bottom - top), w: Math.max(0.01, right - left) };
  });
  const body = mean(boxes.map((b) => b.h));
  const span = (v: number[]) => Math.max(...v) - Math.min(...v);
  const limbs = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i < inside.length; i++) {
    const a = inside[i - 1],
      b = inside[i];
    if (b.timeMs - a.timeMs > 250 || a.points.length !== b.points.length) continue;
    const box = boxes[i - 1];
    for (let k = 0; k < a.points.length; k++) {
      const row = Math.min(2, Math.max(0, Math.floor(((a.points[k][1] - box.top) / box.h) * 3)));
      limbs[row * 2] += Math.abs(b.points[k][1] - a.points[k][1]) / body;
      limbs[row * 2 + 1] += Math.abs(b.points[k][0] - a.points[k][0]) / body;
    }
  }
  const total = limbs.reduce((a, b) => a + b, 0);
  const pts = (get: (b: (typeof boxes)[number]) => number) => boxes.map((b) => ({ t: b.t, v: get(b) }));
  return {
    cx: resample(pts((b) => b.cx), start, end),
    cy: resample(pts((b) => b.cy), start, end),
    height: resample(pts((b) => b.h), start, end),
    aspect: resample(pts((b) => (b.w * frameAspect) / b.h), start, end),
    travelX: span(boxes.map((b) => b.cx)) / body,
    travelY: span(boxes.map((b) => b.cy)) / body,
    stretch: span(boxes.map((b) => b.h)) / body,
    limbs: total > 0 ? limbs.map((v) => v / total) : limbs.map(() => 1 / 6),
  };
}

/** Signature of [startMs, endMs) from dense per-frame measurements (and person contours when
 * measured). Undefined when too few frames lie inside. */
export function actionSignature(
  frames: readonly VisualFrame[],
  people: readonly PersonSample[] | undefined,
  startMs: number,
  endMs: number,
  frameAspect: number,
): ActionSignature | undefined {
  const inside = frames.filter((f) => f.timeMs >= startMs && f.timeMs < endMs);
  if (inside.length < 4) return undefined;
  // The first frame's change measures what came before the stretch (often a cut): leave it out.
  const moving = inside.slice(1);
  const smooth = smoothedChange(inside).slice(1);
  const level = mean(moving.map((f) => f.change));
  const energyRaw = resample(
    moving.map((f, i) => ({ t: f.timeMs, v: smooth[i] })),
    startMs,
    endMs,
  );
  const em = mean(energyRaw);
  const energy = energyRaw.map((v) => (em > 1e-6 ? v / em : 1));
  const regions = Array.from({ length: 16 }, () => 0);
  for (let i = 1; i < inside.length; i++) for (let j = 0; j < 16; j++) regions[j] += Math.abs(inside[i].layout[j] - inside[i - 1].layout[j]);
  const rt = regions.reduce((a, b) => a + b, 0);
  const stepMs = inside.length > 1 ? (inside.at(-1)!.timeMs - inside[0].timeMs) / (inside.length - 1) : 33;
  const flows = moving.filter((f) => f.flow && f.flow.confidence >= 0.5);
  const fps = 1000 / Math.max(1, stepMs);
  // Flow is measured on a 96×54 grid in pixels per frame.
  const camera = {
    panX: Number(((mean(flows.map((f) => f.flow!.panX)) / 96) * fps).toFixed(4)),
    panY: Number(((mean(flows.map((f) => f.flow!.panY)) / 54) * fps).toFixed(4)),
    zoom: Number((mean(flows.map((f) => f.flow!.expansion)) * fps).toFixed(4)),
  };
  let peakAt = 0;
  smooth.forEach((v, i) => {
    if (v > smooth[peakAt]) peakAt = i;
  });
  const smoothMean = mean(smooth);
  return {
    durationMs: Math.round(endMs - startMs),
    level: Math.min(1, level),
    energy: energy.map((v) => Number(v.toFixed(3))),
    regions: rt > 0 ? regions.map((v) => Number((v / rt).toFixed(4))) : regions.map(() => 1 / 16),
    camera,
    ...periodOf(smooth, stepMs),
    peak: moving.length ? Math.max(0, Math.min(1, (moving[peakAt].timeMs - startMs) / Math.max(1, endMs - startMs))) : 0.5,
    peakedness: smoothMean > 1e-6 ? Number((smooth[peakAt] / smoothMean).toFixed(3)) : 0,
    subject: people?.length ? subjectTrajectory(people, startMs, endMs, frameAspect) : null,
  };
}

const pearson = (a: readonly number[], b: readonly number[]) => {
  const ma = mean(a),
    mb = mean(b);
  let s = 0,
    va = 0,
    vb = 0;
  for (let i = 0; i < a.length; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 1e-9 && vb > 1e-9 ? s / Math.sqrt(va * vb) : null;
};
const intersection = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + Math.min(v, b[i]), 0);
/** Shape of a curve over time compared after removing its level: 0–1. */
const shape = (a: readonly number[], b: readonly number[]) => {
  const r = pearson(a, b);
  return r === null ? 0.5 : (r + 1) / 2;
};

export interface ActionMatch {
  /** Movement curve over time (rise, hold, repeat). */
  trajectory: number;
  /** Where in the frame the movement happens. */
  regions: number;
  /** Camera pan and zoom direction. */
  camera: number;
  /** Repetition period. */
  rhythm: number;
  /** Subject outline trajectory (null when either side has no measured person). */
  subject: number | null;
  /** Weighted movement-geometry agreement, 0–1. */
  overall: number;
}

/** How alike two stretches move, 0–1 per aspect. */
export function actionSimilarity(a: ActionSignature, b: ActionSignature): ActionMatch {
  const trajectory = 0.5 * shape(a.energy, b.energy) + 0.5 * Math.max(0, 1 - mean(a.energy.map((v, i) => Math.abs(v - b.energy[i]))) / 1.5);
  const regions = intersection(a.regions, b.regions);
  const moves = (s: ActionSignature) => Math.abs(s.camera.panX) + Math.abs(s.camera.panY) + Math.abs(s.camera.zoom) > 0.02;
  const camera =
    moves(a) || moves(b) ? Math.exp(-(Math.abs(a.camera.panX - b.camera.panX) + Math.abs(a.camera.panY - b.camera.panY)) / 0.15 - Math.abs(a.camera.zoom - b.camera.zoom) / 0.1) : 1;
  const rhythm =
    a.periodMs && b.periodMs && a.periodicity >= 0.35 && b.periodicity >= 0.35
      ? Math.exp(-Math.abs(Math.log(a.periodMs / b.periodMs)) / 0.35)
      : (a.periodicity >= 0.35) !== (b.periodicity >= 0.35)
        ? 0.4
        : 0.6;
  let subject: number | null = null;
  if (a.subject && b.subject) {
    const sa = a.subject,
      sb = b.subject;
    const axis = (s: typeof sa) => [s.travelX, s.travelY, s.stretch];
    const va = axis(sa),
      vb = axis(sb);
    const na = Math.hypot(...va),
      nb = Math.hypot(...vb);
    // Direction of travel/extension, and how much: both matter for the same movement.
    const direction = na > 0.02 && nb > 0.02 ? Math.max(0, va.reduce((s, v, i) => s + v * vb[i], 0) / (na * nb)) : na <= 0.02 && nb <= 0.02 ? 1 : 0.3;
    const amount = Math.exp(-Math.abs(Math.log((0.05 + na) / (0.05 + nb))) / 0.7);
    const curves = (shape(sa.cy, sb.cy) + shape(sa.height, sb.height)) / 2;
    const posture = Math.exp(-Math.abs(Math.log(mean(sa.aspect) / Math.max(1e-3, mean(sb.aspect)))) / 0.5);
    subject = 0.3 * intersection(sa.limbs, sb.limbs) + 0.2 * direction + 0.15 * amount + 0.15 * curves + 0.2 * posture;
  }
  // Weights from measured discrimination (scripts/action-feature-confusion.mjs): where the
  // movement happens and the subject's outline carry most of the meaning; the energy curve,
  // rhythm and camera help less on short shots.
  const parts: [number, number][] = [
    [trajectory, 0.15],
    [regions, 0.35],
    [rhythm, 0.075],
    [camera, 0.075],
    ...(subject === null ? [] : ([[subject, 0.35]] as [number, number][])),
  ];
  const overall = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0);
  const r = (v: number) => Number(v.toFixed(3));
  return { trajectory: r(trajectory), regions: r(regions), camera: r(camera), rhythm: r(rhythm), subject: subject === null ? null : r(subject), overall: r(overall) };
}
