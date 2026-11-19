/** Scene signature: what a shot shows when it barely moves.
 *
 * Movement geometry decides action shots; a hold, a reveal or a detail needs the picture's own
 * structure instead, and colour is a weak cue across different footage. Measured on both sides:
 *  - structure: the 4×4 brightness layout normalised to zero mean and unit spread, so the same
 *    composition in another palette or exposure still matches (horizon, sky, foreground mass);
 *  - vertical profile: the row profile of that structure and where its strongest horizontal edge
 *    (the horizon, a table edge) sits;
 *  - geometry of movement: how concentrated movement is (one moving object vs the whole frame),
 *    camera pan/zoom, movement level;
 *  - subject size, and detected object classes with their positions when vision found any;
 *  - a visual role inferred from those measurements (no category names from the content). */
import { z } from "zod";
import type { VisualFrame } from "./visual";
import type { ActionSignature } from "./action-signature";

export const visualRoles = ["environment reveal", "object movement", "sky/horizon hold", "object detail", "portrait close-up", "establishing wide", "static reaction", "subject action"] as const;
export type VisualRole = (typeof visualRoles)[number];
export const sceneSignatureSchema = z
  .object({
    structure: z.array(z.number().finite()).length(16),
    rows: z.array(z.number().finite()).length(4),
    horizon: z.number().min(0).max(1),
    /** Share of movement in the three busiest cells (1 = one small moving object). */
    localized: z.number().min(0).max(1),
    camera: z.number().nonnegative(),
    level: z.number().nonnegative(),
    subjectSize: z.number().min(0).max(1).nullable(),
    /** Mean detail (Laplacian energy) of the picture: a smooth sky or wall is smooth content. */
    sharpness: z.number().nonnegative().optional(),
    /** Detail relative to the whole video's typical detail (below ~0.6: smooth by design). */
    relativeDetail: z.number().nonnegative().optional(),
    objects: z.record(z.string(), z.number()).optional(),
    role: z.enum(visualRoles),
  })
  .strict();
export type SceneSignature = z.infer<typeof sceneSignatureSchema>;

/** Detected objects as the vision pass reports them (label, box). */
interface Detected {
  label: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export const medianSharpness = (frames: readonly VisualFrame[]) => {
  const s = frames.map((f) => f.sharpness).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : undefined;
};
export function sceneSignature(
  frames: readonly VisualFrame[],
  startMs: number,
  endMs: number,
  action: ActionSignature | undefined,
  subjectSize: number | null,
  detections: readonly Detected[] = [],
  /** The whole video's median per-frame detail, to tell smooth content from lost detail. */
  medianSharpness?: number,
): SceneSignature | undefined {
  const inside = frames.filter((f) => f.timeMs >= startMs && f.timeMs < endMs);
  if (!inside.length) return undefined;
  const layout = Array.from({ length: 16 }, (_, j) => inside.reduce((s, f) => s + f.layout[j], 0) / inside.length);
  const m = layout.reduce((a, b) => a + b, 0) / 16;
  const sd = Math.sqrt(layout.reduce((s, v) => s + (v - m) ** 2, 0) / 16) || 1e-3;
  const structure = layout.map((v) => Number(((v - m) / sd).toFixed(3)));
  const rows = [0, 1, 2, 3].map((r) => Number(((structure[r * 4] + structure[r * 4 + 1] + structure[r * 4 + 2] + structure[r * 4 + 3]) / 4).toFixed(3)));
  let edge = 0,
    at = 0;
  for (let r = 0; r < 3; r++) {
    const d = Math.abs(rows[r + 1] - rows[r]);
    if (d > edge) {
      edge = d;
      at = r;
    }
  }
  const regions = action?.regions ?? Array.from({ length: 16 }, () => 1 / 16);
  // A still picture has no placement of movement (its change map is codec noise).
  const still = (action?.level ?? 0) < 0.0003;
  const localized = still ? 0 : [...regions].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const camera = action ? Math.abs(action.camera.panX) + Math.abs(action.camera.panY) + Math.abs(action.camera.zoom) : 0;
  const level = action?.level ?? 0;
  const objects: Record<string, number> = {};
  for (const d of detections) if (d.confidence >= 0.3) objects[d.label] = (objects[d.label] ?? 0) + d.confidence * d.bounds.width * d.bounds.height;
  const role = inferRole({ rows, localized, camera, level, subjectSize });
  const sharpness = Number((inside.reduce((s, f) => s + f.sharpness, 0) / inside.length).toFixed(4));
  const relativeDetail = medianSharpness ? Number((sharpness / Math.max(1e-6, medianSharpness)).toFixed(3)) : undefined;
  return { structure, rows, horizon: (at + 1) / 4, sharpness, ...(relativeDetail !== undefined ? { relativeDetail } : {}), localized: Number(localized.toFixed(3)), camera: Number(camera.toFixed(4)), level, subjectSize, ...(Object.keys(objects).length ? { objects } : {}), role };
}

/** The visual role from measured geometry only. */
function inferRole(s: { rows: number[]; localized: number; camera: number; level: number; subjectSize: number | null }): VisualRole {
  const moving = s.level >= 0.0015;
  const person = s.subjectSize !== null && s.subjectSize > 0.15;
  if (s.camera >= 0.05) return "environment reveal";
  if (person && s.subjectSize! > 0.85) return moving ? "subject action" : "portrait close-up";
  if (person) return moving ? "subject action" : "static reaction";
  if (moving && s.localized >= 0.45) return "object movement";
  // Brighter top than bottom with a strong horizontal edge: sky or horizon over the scene.
  if (!moving && s.rows[0] - s.rows[3] > 1.2) return "sky/horizon hold";
  if (!moving && s.localized < 0.3 && s.level >= 0.0003) return "establishing wide";
  if (s.level < 0.0003) return s.rows[0] - s.rows[3] > 1.2 ? "sky/horizon hold" : "establishing wide";
  return moving ? "object movement" : "object detail";
}

const pearson = (a: readonly number[], b: readonly number[]) => {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n,
    mb = b.reduce((x, y) => x + y, 0) / n;
  let s = 0,
    va = 0,
    vb = 0;
  for (let i = 0; i < n; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 1e-9 && vb > 1e-9 ? s / Math.sqrt(va * vb) : 0;
};
const related: Partial<Record<VisualRole, VisualRole[]>> = {
  "establishing wide": ["sky/horizon hold", "environment reveal"],
  "sky/horizon hold": ["establishing wide"],
  "object detail": ["portrait close-up"],
  "static reaction": ["portrait close-up", "subject action"],
  "portrait close-up": ["static reaction", "object detail"],
  "subject action": ["static reaction"],
};

/** 0–1: how alike two shots are as pictures (composition, horizon, how movement is placed,
 * subject size, objects, role). */
export function sceneSimilarity(a: SceneSignature, b: SceneSignature) {
  // Composition is the arrangement of masses whichever is brighter (a dark bowl on a light counter
  // composes like a light bowl on a dark one); an inverted match is discounted a little.
  const polarity = (r: number) => (r >= 0 ? (1 + r) / 2 : 0.85 * ((1 - r) / 2));
  const structure = polarity(pearson(a.structure, b.structure));
  const rows = polarity(pearson(a.rows, b.rows));
  const horizon = 1 - Math.abs(a.horizon - b.horizon);
  const placement = Math.exp(-Math.abs(a.localized - b.localized) / 0.25) * Math.exp(-Math.abs(a.camera - b.camera) / 0.08);
  const size = a.subjectSize !== null && b.subjectSize !== null ? Math.exp(-Math.abs(a.subjectSize - b.subjectSize) / 0.25) : a.subjectSize === null && b.subjectSize === null ? 1 : 0.4;
  let objects = 0.5;
  if (a.objects && b.objects) {
    const keys = [...new Set([...Object.keys(a.objects), ...Object.keys(b.objects)])];
    const dot = keys.reduce((s, k) => s + (a.objects![k] ?? 0) * (b.objects![k] ?? 0), 0);
    const na = Math.hypot(...keys.map((k) => a.objects![k] ?? 0)),
      nb = Math.hypot(...keys.map((k) => b.objects![k] ?? 0));
    objects = na && nb ? dot / (na * nb) : 0.5;
  } else if (a.objects || b.objects) objects = 0.3;
  const role = a.role === b.role ? 1 : related[a.role]?.includes(b.role) ? 0.5 : 0;
  const overall = 0.3 * structure + 0.1 * rows + 0.1 * horizon + 0.15 * placement + 0.1 * size + 0.05 * objects + 0.2 * role;
  return { structure, rows, horizon, placement, size, objects, role, overall: Number(overall.toFixed(3)) };
}
