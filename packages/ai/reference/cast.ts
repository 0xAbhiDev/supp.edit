/** Casting: who or what a shot shows, as evidence of its role in the edit.
 *
 * When the raw footage cannot match a reference shot's action (other recordings, missing moments),
 * the shot still has a job: a face reacting, a crowd, an aircraft, a dog, an object close up, a wide
 * scene. Movement and look alone filled such shots with whatever moved alike (an engineer's face
 * played by an aircraft in flight). The vision pass already detects objects (YOLOX, the 80 COCO
 * classes) and classifies shot scale on sampled frames; this summarises them per window:
 *  - how often a person is there, how large the largest one is, and how often there is a crowd;
 *  - what the main subject is, by kind (person, animal, vehicle, other object, nothing);
 *  - the shot scale (close, medium, wide).
 * Kinds are coarse on purpose: "a vehicle" fills an aircraft shot better than a face does, without
 * the casting deciding between an aircraft and a car. */
import { z } from "zod";

const unit = z.number().min(0).max(1);
export const castSchema = z
  .object({
    /** Vision frames the summary rests on. */
    frames: z.number().int().min(1),
    person: unit,
    /** Height of the largest person (frame share), over frames with one; 0 without. */
    personSize: unit,
    crowd: unit,
    kinds: z.object({ person: unit, animal: unit, vehicle: unit, object: unit, none: unit }).strict(),
    /** Shares of frames per shot scale; null when the vision pass gave no scale. */
    scale: z.object({ close: unit, medium: unit, wide: unit }).strict().nullable(),
  })
  .strict();
export type Cast = z.infer<typeof castSchema>;

interface Detection {
  label: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
}
interface CastFrame {
  detections?: readonly Detection[];
  shotScale?: "close" | "medium" | "wide" | null;
}

const ANIMALS = new Set(["bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"]);
const VEHICLES = new Set(["bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat"]);
/** A detection counts at this confidence (the vision pass keeps 0.30 and up). */
const SEEN = 0.4;
const kindOf = (label: string) => (label === "person" ? "person" : ANIMALS.has(label) ? "animal" : VEHICLES.has(label) ? "vehicle" : "object");

/** The casting of a window from its vision frames; undefined without frames. */
export function castSignature(frames: readonly CastFrame[]): Cast | undefined {
  if (!frames.length) return undefined;
  let person = 0,
    crowd = 0,
    scaled = 0;
  const sizes: number[] = [];
  const kinds = { person: 0, animal: 0, vehicle: 0, object: 0, none: 0 };
  const scale = { close: 0, medium: 0, wide: 0 };
  for (const f of frames) {
    const seen = (f.detections ?? []).filter((d) => d.confidence >= SEEN);
    const people = seen.filter((d) => d.label === "person");
    if (people.length) {
      person++;
      sizes.push(Math.max(...people.map((d) => d.bounds.height)));
    }
    if (people.length >= 3) crowd++;
    // The main subject: the largest confident detection.
    const main = [...seen].sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0];
    kinds[main ? kindOf(main.label) : "none"]++;
    if (f.shotScale) {
      scale[f.shotScale]++;
      scaled++;
    }
  }
  const n = frames.length;
  const share = (v: number, of = n) => Number((v / Math.max(1, of)).toFixed(3));
  sizes.sort((a, b) => a - b);
  return {
    frames: n,
    person: share(person),
    personSize: sizes.length ? Number(Math.min(1, sizes[sizes.length >> 1]).toFixed(3)) : 0,
    crowd: share(crowd),
    kinds: { person: share(kinds.person), animal: share(kinds.animal), vehicle: share(kinds.vehicle), object: share(kinds.object), none: share(kinds.none) },
    scale: scaled ? { close: share(scale.close, scaled), medium: share(scale.medium, scaled), wide: share(scale.wide, scaled) } : null,
  };
}

const intersection = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).reduce((s, k) => s + Math.min(a[k], b[k] ?? 0), 0);

/** 0–1: how alike two windows are cast (who or what they show, at what scale). */
export function castSimilarity(a: Cast | undefined, b: Cast | undefined) {
  if (!a || !b) return null;
  const parts: [number, number][] = [
    [intersection(a.kinds, b.kinds), 0.35],
    [1 - Math.abs(a.person - b.person), 0.25],
    [1 - Math.abs(a.crowd - b.crowd), 0.1],
  ];
  // Person size only where both show a person most of the time (a face vs a figure far away).
  const size = a.person >= 0.5 && b.person >= 0.5 ? Math.exp(-Math.abs(a.personSize - b.personSize) / 0.2) : null;
  if (size !== null) parts.push([size, 0.15]);
  const scale = a.scale && b.scale ? intersection(a.scale, b.scale) : null;
  if (scale !== null) parts.push([scale, 0.15]);
  const overall = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0);
  // Kind agreement alone: what the main subject is, and whether a person is there.
  const kind = 0.6 * intersection(a.kinds, b.kinds) + 0.4 * (1 - Math.abs(a.person - b.person));
  return { overall: Number(overall.toFixed(3)), kind: Number(kind.toFixed(3)), size, scale };
}

/** A plain description of a casting, for explanations ("a person, close", "a vehicle, wide"). */
export function describeCast(c: Cast | undefined) {
  if (!c) return null;
  const [kind] = Object.entries(c.kinds).sort((x, y) => y[1] - x[1])[0];
  const scale = c.scale ? Object.entries(c.scale).sort((x, y) => y[1] - x[1])[0][0] : null;
  const what = kind === "none" ? "no clear subject" : c.crowd >= 0.5 ? "a crowd" : kind === "person" ? "a person" : kind === "object" ? "an object" : `${kind === "animal" ? "an" : "a"} ${kind}`;
  return scale ? `${what}, ${scale}` : what;
}
