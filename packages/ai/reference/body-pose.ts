/** Body pose (MediaPipe, 33 joints; native `analysis/pose.rs`) as evidence of what a shot does.
 *
 * Movement amount, framing, look and silhouettes cannot tell a deadlift from an incline press when
 * the reference and the footage are different recordings: a standing hip hinge and a press lying
 * on a bench move about as much, in similar rooms. Joint angles can: the knees, hips, elbows and
 * shoulders bend differently, and the torso stands, leans or lies. Angles come from the model's
 * metric 3D joints (unchanged by distance and framing); the torso's lean from the picture (the 3D
 * joints are given in the model's upright crop). Left and right are paired without regard to side,
 * so a mirrored camera position compares as the same action. */
import { z } from "zod";

const triple = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const poseSamplesSchema = z
  .array(
    z
      .object({
        timeMs: z.number().int().nonnegative(),
        score: z.number().min(0).max(1),
        aspect: z.number().positive().max(10),
        points: z.array(triple).refine((p) => p.length === 0 || p.length === 33),
        world: z.array(triple).refine((p) => p.length === 0 || p.length === 33),
      })
      .strict(),
  )
  .max(100_000);
export type PoseSample = z.infer<typeof poseSamplesSchema>[number];

/** Feature names, in order: paired joints (smaller, larger angle) and the torso's lean. */
export const POSE_FEATURES = ["knee", "knee'", "hip", "hip'", "elbow", "elbow'", "shoulder", "shoulder'", "lean"] as const;
const J = { lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 };
/** A joint counts when the model sees it this clearly. */
const VISIBLE = 0.5;
/** Samples this close to a step of a shot speak for it. */
const NEAR_MS = 250;

type Vec3 = readonly [number, number, number];
const angle = (a: Vec3, b: Vec3, c: Vec3) => {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const nu = Math.hypot(...u),
    nv = Math.hypot(...v);
  if (nu < 1e-6 || nv < 1e-6) return null;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / Math.PI; // 0–1 (0–180°)
};

/** One sample's features (0–1 each), null where the joints are not seen; undefined without a body. */
export function poseFeatures(s: PoseSample): (number | null)[] | undefined {
  if (!s.score || s.points.length !== 33 || s.world.length !== 33) return undefined;
  const seen = (...ids: number[]) => ids.every((i) => s.points[i][2] >= VISIBLE);
  const w = (i: number) => s.world[i] as unknown as Vec3;
  const joint = (a: number, b: number, c: number) => (seen(a, b, c) ? angle(w(a), w(b), w(c)) : null);
  const pair = (l: number | null, r: number | null): [number | null, number | null] => {
    if (l === null && r === null) return [null, null];
    if (l === null || r === null) return [l ?? r, l ?? r];
    return [Math.min(l, r), Math.max(l, r)];
  };
  const knee = pair(joint(J.lHip, J.lKnee, J.lAnkle), joint(J.rHip, J.rKnee, J.rAnkle));
  const hip = pair(joint(J.lShoulder, J.lHip, J.lKnee), joint(J.rShoulder, J.rHip, J.rKnee));
  const elbow = pair(joint(J.lShoulder, J.lElbow, J.lWrist), joint(J.rShoulder, J.rElbow, J.rWrist));
  const shoulder = pair(joint(J.lHip, J.lShoulder, J.lElbow), joint(J.rHip, J.rShoulder, J.rElbow));
  // Lean: the hip→shoulder direction in the picture against straight up (0 upright, 0.5 lying).
  let lean: number | null = null;
  if (seen(J.lShoulder, J.rShoulder, J.lHip, J.rHip)) {
    const p = (i: number) => [s.points[i][0] * s.aspect, s.points[i][1]];
    const sx = (p(J.lShoulder)[0] + p(J.rShoulder)[0]) / 2,
      sy = (p(J.lShoulder)[1] + p(J.rShoulder)[1]) / 2,
      hx = (p(J.lHip)[0] + p(J.rHip)[0]) / 2,
      hy = (p(J.lHip)[1] + p(J.rHip)[1]) / 2;
    const dx = sx - hx,
      dy = sy - hy;
    if (Math.hypot(dx, dy) > 1e-3) lean = Math.acos(Math.max(-1, Math.min(1, -dy / Math.hypot(dx, dy)))) / Math.PI;
  }
  return [...knee, ...hip, ...elbow, ...shoulder, lean];
}

export interface BodySignature {
  /** Features at `steps` moments across the window (null where no body was measured there). */
  path: ((number | null)[] | null)[];
  /** How much each feature moves across the window (range), where measured. */
  motion: (number | null)[];
  /** Share of the window's steps with a measured body. */
  coverage: number;
}

/** The body's features across [start, end): the nearest sample to each of `steps` moments. */
export function bodySignature(samples: readonly PoseSample[] | undefined, startMs: number, endMs: number, steps = 8): BodySignature | undefined {
  const inside = (samples ?? []).filter((s) => s.timeMs >= startMs - NEAR_MS && s.timeMs < endMs + NEAR_MS);
  if (!inside.length) return undefined;
  const path = Array.from({ length: steps }, (_, k) => {
    const t = startMs + ((k + 0.5) / steps) * (endMs - startMs);
    let best: PoseSample | undefined;
    for (const s of inside) if (!best || Math.abs(s.timeMs - t) < Math.abs(best.timeMs - t)) best = s;
    return best && Math.abs(best.timeMs - t) <= NEAR_MS ? poseFeatures(best) ?? null : null;
  });
  const within = inside.filter((s) => s.timeMs >= startMs && s.timeMs < endMs).map(poseFeatures).filter((f): f is (number | null)[] => !!f);
  const motion = POSE_FEATURES.map((_, i) => {
    const v = within.map((f) => f[i]).filter((x): x is number => x !== null);
    return v.length >= 3 ? Math.max(...v) - Math.min(...v) : null;
  });
  return { path, motion, coverage: path.filter(Boolean).length / steps };
}

/** Whether a measured window holds a body (at least half its steps), shows nobody, or is unknown. */
export function bodyPresence(sig: BodySignature | undefined): "present" | "absent" | "unknown" {
  if (!sig) return "unknown";
  return sig.coverage >= 0.5 ? "present" : sig.coverage === 0 ? "absent" : "unknown";
}

const frameDistance = (a: (number | null)[], b: (number | null)[]) => {
  let sum = 0,
    n = 0;
  for (let i = 0; i < a.length; i++)
    if (a[i] !== null && b[i] !== null) {
      // The torso's lean decides standing, hinging and lying: it counts twice.
      const w = POSE_FEATURES[i] === "lean" ? 2 : 1;
      sum += w * Math.abs(a[i]! - b[i]!);
      n += w;
    }
  return n >= 4 ? sum / n : null;
};

/** 0–1: how alike two bodies' actions are, from posture over time (aligned by time warping within
 * two steps) and which joints move how much. Undefined when either side measured a body at fewer
 * than half its steps. */
export function bodyFit(a: BodySignature | undefined, b: BodySignature | undefined): number | undefined {
  if (!a || !b || a.coverage < 0.5 || b.coverage < 0.5) return undefined;
  const n = a.path.length,
    m = b.path.length,
    band = 2;
  const MISSING = 0.25;
  const cost = (i: number, j: number) => {
    const x = a.path[i],
      y = b.path[j];
    if (!x || !y) return MISSING;
    return frameDistance(x, y) ?? MISSING;
  };
  const d = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => Infinity));
  const len = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  d[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      const prev = [
        [d[i - 1][j - 1], len[i - 1][j - 1]],
        [d[i - 1][j], len[i - 1][j]],
        [d[i][j - 1], len[i][j - 1]],
      ].reduce((best, c) => (c[0] < best[0] ? c : best));
      d[i][j] = prev[0] + cost(i - 1, j - 1);
      len[i][j] = prev[1] + 1;
    }
  const posture = d[n][m] / Math.max(1, len[n][m]);
  let motionSum = 0,
    motionN = 0;
  for (let i = 0; i < POSE_FEATURES.length; i++)
    if (a.motion[i] !== null && b.motion[i] !== null) {
      motionSum += Math.abs(a.motion[i]! - b.motion[i]!);
      motionN++;
    }
  const moves = motionN >= 4 ? motionSum / motionN : null;
  // About 0.1 (18°) of mean posture difference halves the fit; movement ranges a little less.
  const postureFit = Math.exp(-posture / 0.14);
  const movesFit = moves === null ? null : Math.exp(-moves / 0.12);
  return Number((movesFit === null ? postureFit : 0.65 * postureFit + 0.35 * movesFit).toFixed(4));
}

/** The clip's body pose from the native MediaPipe models (5 samples a second), cached by file
 * identity and model. Long clips are measured only in the given windows (the matcher's candidate
 * stretches); otherwise the whole clip. */
export async function bodyPose(
  asset: import("../../project-schema").Asset,
  job: import("../../jobs").JobContext,
  windows: readonly [number, number][] = [],
) {
  const { desktop } = await import("../../platform");
  const { readDerived, writeDerived } = await import("../../platform/derived");
  const { nativeJob } = await import("../media-analysis/service");
  const spans = windows.map(([a, b]) => [Math.max(0, Math.floor(a)), Math.ceil(b)] as [number, number]).filter(([a, b]) => b > a);
  const key = `pose-mediapipe-2023mar-9d89c599-v1:${asset.fingerprint}:${spans.map((w) => w.join("-")).join(",") || "all"}`;
  const cached = poseSamplesSchema.safeParse(await readDerived(key));
  if (cached.success) return cached.data;
  if (!desktop) return [];
  const samples = poseSamplesSchema.parse(await nativeJob("body_pose", { path: asset.path, windows: spans }, job));
  await writeDerived(key, samples, JSON.stringify(samples).length * 2);
  return samples;
}
