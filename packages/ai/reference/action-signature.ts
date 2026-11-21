import { cameraSignature, cameraSignatureSchema, cameraSimilarity } from "./camera-signature";
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
import { shapeFit, silhouette } from "./subject-shape";

export const STEPS = 12;
/** Below this mean per-frame change a picture is still: where it "moves" is codec noise. */
export const STILL_LEVEL = 0.0003;
/** Frames kept clear of a reference shot's cuts when measuring it: the frame at a cut (or one
 * frame of boundary slack) would dominate where and how much the shot moves. Raw segments keep the
 * same two-frame margin (cuts.ts). */
export const shotSpan = (shot: { startMs: number; endMs: number }) => {
  const guard = Math.min(67, (shot.endMs - shot.startMs) / 6);
  return [shot.startMs + guard, shot.endMs - guard] as const;
};
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
    /** The camera's own path over the window (sub-pixel flow): curves, speed, kind, confidence. */
    cameraPath: cameraSignatureSchema.optional(),
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
        /** Principal-axis angle of the outline over time (radians), for near-tie review. */
        orientation: curve.optional(),
        /** How much the outline changes shape between samples (0 rigid – 1 entirely new). */
        deformation: z.number().min(0).max(1).optional(),
        /** Share of picture movement inside the subject's box (foreground vs background). */
        foreground: z.number().min(0).max(1).optional(),
      })
      .strict()
      .nullable(),
    /** Which way things move locally (per-cell flow over changing pixels): share of movement by
     * direction (8 bins from rightward, y down), how consistent the direction is, net vertical and
     * horizontal transport, rotation about the motion centre, how straight and how turning the
     * motion centre's path is, and the share of the frame that moves. */
    direction: z
      .object({
        histogram: z.array(z.number().min(0).max(1)).length(8),
        consistency: z.number().min(0).max(1),
        vertical: z.number().min(-1).max(1),
        horizontal: z.number().min(-1).max(1),
        rotation: z.number().min(0).max(1),
        straightness: z.number().min(0).max(1),
        turning: z.number().min(0).max(1),
        area: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    /** Activity over the stretch: active share, idle share before the movement starts and after it ends. */
    envelope: z.object({ active: z.number().min(0).max(1), lead: z.number().min(0).max(1), trail: z.number().min(0).max(1) }).strict().optional(),
  })
  .strict();
export type ActionSignature = z.infer<typeof actionSignatureSchema>;

/** Direction, rotation and path of local motion over frames (see the schema). */
function directionOf(frames: readonly VisualFrame[], aspect: number): ActionSignature["direction"] {
  const local = frames.filter((f) => f.local);
  if (local.length < 3) return undefined;
  const hist = new Array<number>(8).fill(0);
  let sx = 0,
    sy = 0,
    sm = 0,
    st = 0;
  for (const f of local) {
    const L = f.local!;
    for (let c = 0; c < 16; c++) {
      const dx = L.flow[2 * c],
        dy = L.flow[2 * c + 1];
      const m = Math.hypot(dx, dy);
      if (m < 0.05) continue;
      const bin = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
      hist[bin] += m;
      sx += dx;
      sy += dy;
      sm += m;
      // Tangential component about the motion centre: circling motion turns around it.
      const rx = (((c % 4) + 0.5) / 4 - L.cx) * aspect,
        ry = (Math.floor(c / 4) + 0.5) / 4 - L.cy;
      const rn = Math.hypot(rx, ry);
      if (rn > 0.05) st += (rx * dy - ry * dx) / rn;
    }
  }
  const pts = local.filter((f) => f.local!.area >= 0.0005).map((f) => [f.local!.cx * aspect, f.local!.cy] as const);
  let len = 0,
    turn = 0,
    turns = 0,
    prevAngle: number | undefined;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0],
      dy = pts[i][1] - pts[i - 1][1];
    const step = Math.hypot(dx, dy);
    len += step;
    if (step < 0.004) continue;
    const angle = Math.atan2(dy, dx);
    if (prevAngle !== undefined) {
      let d = Math.abs(angle - prevAngle);
      if (d > Math.PI) d = 2 * Math.PI - d;
      turn += d;
      turns++;
    }
    prevAngle = angle;
  }
  const net = pts.length > 1 ? Math.hypot(pts.at(-1)![0] - pts[0][0], pts.at(-1)![1] - pts[0][1]) : 0;
  const r = (v: number) => Number(v.toFixed(3));
  return {
    histogram: sm > 0 ? hist.map((v) => r(v / sm)) : hist.map(() => 0.125),
    consistency: r(sm > 0 ? Math.min(1, Math.hypot(sx, sy) / sm) : 0),
    vertical: r(sm > 0 ? sy / sm : 0),
    horizontal: r(sm > 0 ? sx / sm : 0),
    rotation: r(sm > 0 ? Math.min(1, Math.abs(st) / sm) : 0),
    straightness: r(len > 0 ? Math.min(1, net / len) : 0),
    turning: r(turns ? turn / turns / Math.PI : 0),
    area: Number(mean(local.map((f) => f.local!.area)).toFixed(4)),
  };
}

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

function subjectTrajectory(people: readonly PersonSample[], start: number, end: number, frameAspect: number, frames: readonly VisualFrame[] = []): ActionSignature["subject"] {
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
  // Principal axis of each outline from its second moments.
  const angles = inside.map((p) => {
    const cx = mean(p.points.map((q) => q[0])),
      cy = mean(p.points.map((q) => q[1]));
    let xx = 0,
      yy = 0,
      xy = 0;
    for (const [x, y] of p.points) {
      xx += ((x - cx) * frameAspect) ** 2;
      yy += (y - cy) ** 2;
      xy += (x - cx) * frameAspect * (y - cy);
    }
    return { t: p.timeMs, v: 0.5 * Math.atan2(2 * xy, xx - yy) };
  });
  const fits: number[] = [];
  for (let i = 1; i < inside.length; i++) {
    const a = silhouette(inside[i - 1].points, frameAspect),
      b = silhouette(inside[i].points, frameAspect);
    if (a && b && inside[i].timeMs - inside[i - 1].timeMs <= 250) fits.push(shapeFit(a, b));
  }
  // Foreground: movement in the layout cells the subject's box covers, against the whole frame.
  const box = { left: Math.min(...boxes.map((b) => b.cx)) - 0.1, right: Math.max(...boxes.map((b) => b.cx)) + 0.1, top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.top + b.h)) };
  let fg = 0,
    all = 0;
  for (let i = 1; i < frames.length; i++)
    for (let j = 0; j < 16; j++) {
      const d = Math.abs(frames[i].layout[j] - frames[i - 1].layout[j]);
      all += d;
      const x0 = (j % 4) / 4,
        y0 = Math.floor(j / 4) / 4;
      if (x0 < box.right && x0 + 0.25 > box.left && y0 < box.bottom && y0 + 0.25 > box.top) fg += d;
    }
  return {
    cx: resample(pts((b) => b.cx), start, end),
    cy: resample(pts((b) => b.cy), start, end),
    height: resample(pts((b) => b.h), start, end),
    aspect: resample(pts((b) => (b.w * frameAspect) / b.h), start, end),
    travelX: span(boxes.map((b) => b.cx)) / body,
    travelY: span(boxes.map((b) => b.cy)) / body,
    stretch: span(boxes.map((b) => b.h)) / body,
    limbs: total > 0 ? limbs.map((v) => v / total) : limbs.map(() => 1 / 6),
    orientation: resample(angles, start, end).map((v) => Number(v.toFixed(3))),
    ...(fits.length ? { deformation: Number(Math.max(0, Math.min(1, 1 - mean(fits))).toFixed(3)) } : {}),
    ...(all > 0 ? { foreground: Number(Math.min(1, fg / all).toFixed(3)) } : {}),
  };
}

/** Signature of [startMs, endMs) from dense per-frame measurements (and person contours when
 * measured). Undefined when too few frames lie inside. */
/** Whole-frame edit effects measured in a reference: colour pulses and person flashes. Their
 * frames, and the frame returning from each, are the edit's movement, not the shot's: a colour
 * pulse changes the whole frame at once (about 50 times a lift's per-frame change). Transition
 * spans are left in: removing them from a short shot leaves too little to measure, and calm
 * footage then agrees with it too easily (two false close matches offline). */
export function effectSpans(
  dna: {
    colorPulses?: readonly { startMs: number; endMs: number }[];
    personFlashes?: readonly { startMs: number; endMs: number }[];
  },
  frameMs = 34,
) {
  return [...(dna.colorPulses ?? []), ...(dna.personFlashes ?? [])]
    .filter((s) => s.endMs > s.startMs)
    .map((s) => ({ startMs: s.startMs, endMs: s.endMs + frameMs }));
}

export function actionSignature(
  frames: readonly VisualFrame[],
  people: readonly PersonSample[] | undefined,
  startMs: number,
  endMs: number,
  frameAspect: number,
  /** Spans to leave out (a reference's edit effects, effectSpans). */
  exclude: readonly { startMs: number; endMs: number }[] = [],
): ActionSignature | undefined {
  const inside = frames.filter((f) => f.timeMs >= startMs && f.timeMs < endMs && !exclude.some((s) => f.timeMs >= s.startMs && f.timeMs <= s.endMs));
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
  // Sub-pixel flow where measured: slow pans read as zero in whole pixels.
  const camera = {
    panX: Number(((mean(flows.map((f) => f.flow!.fineX ?? f.flow!.panX)) / 96) * fps).toFixed(4)),
    panY: Number(((mean(flows.map((f) => f.flow!.fineY ?? f.flow!.panY)) / 54) * fps).toFixed(4)),
    zoom: Number((mean(flows.map((f) => f.flow!.fineZoom ?? f.flow!.expansion)) * fps).toFixed(4)),
  };
  const cameraPath = cameraSignature(frames, startMs, endMs);
  let peakAt = 0;
  smooth.forEach((v, i) => {
    if (v > smooth[peakAt]) peakAt = i;
  });
  const smoothMean = mean(smooth);
  // Activity envelope: an active stretch filled mostly with idle frames is not the same shot.
  const top = Math.max(0, ...smooth);
  const threshold = Math.max(STILL_LEVEL, 0.3 * top);
  const activeIdx = smooth.map((v, i) => (v >= threshold ? i : -1)).filter((i) => i >= 0);
  const envelope =
    top < STILL_LEVEL || !activeIdx.length
      ? { active: 0, lead: 0, trail: 0 }
      : {
          active: Number((activeIdx.length / smooth.length).toFixed(3)),
          lead: Number((activeIdx[0] / smooth.length).toFixed(3)),
          trail: Number(((smooth.length - 1 - activeIdx.at(-1)!) / smooth.length).toFixed(3)),
        };
  const direction = directionOf(moving, frameAspect);
  return {
    envelope,
    ...(direction ? { direction } : {}),
    durationMs: Math.round(endMs - startMs),
    level: Math.min(1, level),
    energy: energy.map((v) => Number(v.toFixed(3))),
    regions: rt > 0 ? regions.map((v) => Number((v / rt).toFixed(4))) : regions.map(() => 1 / 16),
    camera,
    ...(cameraPath ? { cameraPath } : {}),
    ...periodOf(smooth, stepMs),
    peak: moving.length ? Math.max(0, Math.min(1, (moving[peakAt].timeMs - startMs) / Math.max(1, endMs - startMs))) : 0.5,
    peakedness: smoothMean > 1e-6 ? Number((smooth[peakAt] / smoothMean).toFixed(3)) : 0,
    subject: people?.length ? subjectTrajectory(people, startMs, endMs, frameAspect, inside) : null,
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
  /** Which way things move locally: direction mix, transport, rotation, path shape. */
  direction: number | null;
  /** Activity envelope: active share and idle lead/tail against the reference's. */
  envelope: number | null;
  /** Weighted movement-geometry agreement, 0–1. */
  overall: number;
}

/** How alike two stretches move, 0–1 per aspect. */
export function actionSimilarity(a: ActionSignature, b: ActionSignature): ActionMatch {
  // Two still pictures move alike; a still against a moving one does not. Neither has a
  // meaningful movement curve or map, so those are not compared.
  const stillA = a.level < STILL_LEVEL,
    stillB = b.level < STILL_LEVEL;
  if (stillA || stillB) {
    const same = stillA && stillB ? 1 : 0.25;
    const r = (v: number) => Number(v.toFixed(3));
    return { trajectory: same, regions: same, camera: same, rhythm: same, subject: null, direction: null, envelope: null, overall: r(same) };
  }
  const trajectory = 0.5 * shape(a.energy, b.energy) + 0.5 * Math.max(0, 1 - mean(a.energy.map((v, i) => Math.abs(v - b.energy[i]))) / 1.5);
  const regions = intersection(a.regions, b.regions);
  const moves = (s: ActionSignature) => Math.abs(s.camera.panX) + Math.abs(s.camera.panY) + Math.abs(s.camera.zoom) > 0.02;
  const camera =
    a.cameraPath && b.cameraPath
      ? cameraSimilarity(a.cameraPath, b.cameraPath)
      : moves(a) || moves(b)
        ? Math.exp(-(Math.abs(a.camera.panX - b.camera.panX) + Math.abs(a.camera.panY - b.camera.panY)) / 0.15 - Math.abs(a.camera.zoom - b.camera.zoom) / 0.1)
        : 1;
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
  let direction: number | null = null;
  if (a.direction && b.direction) {
    const da = a.direction,
      db = b.direction;
    const na = Math.hypot(da.horizontal, da.vertical),
      nb = Math.hypot(db.horizontal, db.vertical);
    // Net transport only means something when the movement keeps one direction.
    const transport = na > 0.15 && nb > 0.15 ? Math.max(0, (da.horizontal * db.horizontal + da.vertical * db.vertical) / (na * nb)) : na <= 0.15 && nb <= 0.15 ? 0.8 : 0.3;
    direction =
      0.3 * intersection(da.histogram, db.histogram) +
      0.2 * transport +
      0.15 * Math.exp(-Math.abs(da.consistency - db.consistency) / 0.25) +
      0.15 * Math.exp(-Math.abs(da.rotation - db.rotation) / 0.2) +
      0.1 * Math.exp(-Math.abs(da.straightness - db.straightness) / 0.3) +
      0.1 * Math.exp(-Math.abs(da.turning - db.turning) / 0.2);
  }
  const envelope =
    a.envelope && b.envelope
      ? Math.exp(-Math.abs(a.envelope.active - b.envelope.active) / 0.3) * Math.exp(-(Math.max(0, b.envelope.lead - a.envelope.lead) + Math.max(0, b.envelope.trail - a.envelope.trail)) / 0.25)
      : null;
  // Weights from measured discrimination (scripts/action-feature-confusion.mjs): where the
  // movement happens and the subject's outline carry most of the meaning; the energy curve,
  // rhythm and camera help less on short shots. Small-motion mode (the reference's moving pixels
  // under 2% of the frame: a spoon, a stream, a distant car): which way things move locally and
  // when the shot is active decide; whole-frame and outline measures say little.
  const small = !!a.direction && a.direction.area < 0.02;
  // Camera-driven mode: the reference shot's movement is the camera's (a confident pan, tilt,
  // push or handheld move with no tracked subject): the camera path decides.
  const cameraDriven = !small && a.subject === null && !!a.cameraPath && a.cameraPath.confidence >= 0.5 && !["static", "uncertain"].includes(a.cameraPath.kind);
  const w = cameraDriven
    ? { trajectory: 0.1, regions: 0.15, rhythm: 0.05, camera: 0.5, subject: 0.1, direction: 0.05, envelope: 0.05 }
    : small
    ? { trajectory: 0.1, regions: 0.2, rhythm: 0.05, camera: 0.05, subject: 0.1, direction: 0.45, envelope: 0.15 }
    : { trajectory: 0.15, regions: 0.35, rhythm: 0.075, camera: 0.075, subject: 0.35, direction: 0.12, envelope: 0.1 };
  const parts: [number, number][] = [
    [trajectory, w.trajectory],
    [regions, w.regions],
    [rhythm, w.rhythm],
    [camera, w.camera],
    ...(subject === null ? [] : ([[subject, w.subject]] as [number, number][])),
    ...(direction === null ? [] : ([[direction, w.direction]] as [number, number][])),
    ...(envelope === null ? [] : ([[envelope, w.envelope]] as [number, number][])),
  ];
  const overall = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0);
  const r = (v: number) => Number(v.toFixed(3));
  return {
    trajectory: r(trajectory),
    regions: r(regions),
    camera: r(camera),
    rhythm: r(rhythm),
    subject: subject === null ? null : r(subject),
    direction: direction === null ? null : r(direction),
    envelope: envelope === null ? null : r(envelope),
    overall: r(overall),
  };
}
