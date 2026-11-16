import { z } from "zod";
import { assessReferenceText } from "./text-evidence";
import type { Transcript } from "../transcript";
import {
  characterizeTransitions,
  refineFlashBoundaries,
  separateColorPulses,
  measuredLayout,
  averageEmbedding,
  measuredColor,
  measuredColorSchema,
  pulsePaletteSchema,
  transitionSchema,
  type VisualFrame,
} from "./visual";
import type { Asset } from "../../project-schema";
import type { MediaAnalysis, BeatMap } from "../media-analysis/model";
import type { ColorStats } from "../rough-cut/matching";
import { strongEvents } from "../rough-cut/beats";
import {
  appearanceSchema,
  classifyTextOverlays,
  type TextAppearance,
} from "./appearance";
import type { MotionSample } from "./motion";

const unit = z.number().finite().min(0).max(1);
export const modes = [
  "Close Match",
  "Smart Adaptation",
  "Creative Remix",
] as const;
export type RecreationMode = (typeof modes)[number];
export const dnaSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(256),
    width: z.number().int().positive().max(32768),
    height: z.number().int().positive().max(32768),
    shots: z
      .array(
        z
          .object({
            color: measuredColorSchema.nullable().optional(),
            layout: z.array(unit).length(16).nullable().optional(),
            embedding: z
              .array(z.number().finite().min(-1).max(1))
              .length(512)
              .nullable()
              .optional(),
            startMs: z.number().nonnegative(),
            endMs: z.number().positive(),
            motion: unit.nullable(),
            luma: unit.nullable(),
            subject: z.string().max(128).nullable().optional(),
            framing: z.enum(["close", "medium", "wide"]).nullable(),
            fadeIn: z.boolean(),
            fadeOut: z.boolean(),
            boundaryConfidence: unit.nullable(),
            camera: z
              .object({
                expansion: z.number().min(-0.3).max(0.3),
                drift: unit,
                freeze: unit,
                letterbox: unit,
                vignette: unit,
                confidence: unit,
                motionDip: unit.nullable(),
              })
              .optional(),
          })
          .strict()
          .refine((s) => s.endMs > s.startMs),
      )
      .min(1)
      .max(2000),
    transitions: z.array(transitionSchema).max(1999).default([]),
    colorPulses: z
      .array(
        z
          .object({
            startMs: z.number().nonnegative(),
            endMs: z.number().positive(),
            confidence: unit,
            palette: pulsePaletteSchema.optional(),
          })
          .strict()
          .refine((v) => v.endMs > v.startMs),
      )
      .max(1000)
      .default([]),
    text: z.array(appearanceSchema).max(512).nullable().default(null),
    color: z
      .object({
        luma: unit,
        contrast: unit,
        saturation: unit,
        temperature: z.number().min(-1).max(1).nullable(),
      })
      .nullable(),
    bpm: z.number().positive().nullable(),
    alignedCuts: unit.nullable(),
    onsetsPerSecond: z.number().nonnegative().nullable(),
  })
  .strict();
export type StyleDNA = z.infer<typeof dnaSchema>;
export type Shot = StyleDNA["shots"][number];
export function describeShots(a: Asset, analysis: MediaAnalysis): Shot[] {
  if (
    a.id !== analysis.assetId ||
    a.fingerprint !== analysis.fingerprint ||
    !analysis.video
  )
    throw Error("Scene evidence does not match " + a.name);
  const { quality, scenes } = analysis.video;
  return scenes
    .map((s) => {
      const frames = quality.filter(
          (f) => f.timeMs >= s.startMs && f.timeMs < s.endMs,
        ),
        vision = analysis.vision?.frames.find(
          (f) => f.timeMs >= s.startMs && f.timeMs < s.endMs,
        );
      const first = frames[0],
        last = frames.at(-1);
      return {
        startMs: s.startMs,
        endMs: Math.min(s.endMs, a.duration * 1000),
        motion: s.motion,
        luma: frames.length
          ? frames.reduce((v, f) => v + f.meanLuma, 0) / frames.length
          : null,
        subject: vision?.subject?.label ?? null,
        framing: vision?.shotScale ?? null,
        boundaryConfidence: s.boundaryScore,
        fadeIn:
          !!first &&
          frames.length >= 3 &&
          first.meanLuma < 0.04 &&
          frames[1].meanLuma > first.meanLuma &&
          frames[2].meanLuma > frames[1].meanLuma + 0.04,
        fadeOut:
          !!last &&
          frames.length >= 3 &&
          last.meanLuma < 0.04 &&
          frames.at(-2)!.meanLuma > last.meanLuma &&
          frames.at(-3)!.meanLuma > frames.at(-2)!.meanLuma + 0.04,
      };
    })
    .filter((s) => s.endMs > s.startMs);
}
export function extractDNA(
  asset: Asset,
  analysis: MediaAnalysis,
  map?: BeatMap,
  color?: ColorStats,
  motion: readonly MotionSample[] = [],
  text: TextAppearance[] | null = null,
  visual: readonly VisualFrame[] = [],
  transcript?: Transcript,
): StyleDNA {
  const shots = describeShots(asset, analysis),
    events = map && strongEvents(map),
    knownBoundaries = shots.map((s) => s.startMs);
  // Large isolated residuals with little matching block motion can expose a cut
  // inside a scene with a similar color histogram. Reject paired flash edges.
  for (const [i, s] of motion.entries()) {
    if (
      !i ||
      i === motion.length - 1 ||
      s.confidence > 0.35 ||
      s.intensity < 0.1
    )
      continue;
    const neighbours = motion
      .slice(Math.max(0, i - 4), i + 5)
      .filter((x) => x !== s)
      .map((x) => x.intensity)
      .sort((a, b) => a - b);
    if (
      s.intensity < 4 * neighbours[Math.floor(neighbours.length / 2)] ||
      Math.max(motion[i - 1].intensity, motion[i + 1].intensity) >
        0.72 * s.intensity
    )
      continue;
    const j = shots.findIndex(
      (x) => s.timeMs > x.startMs + 250 && s.timeMs < x.endMs - 250,
    );
    if (j < 0 || knownBoundaries.some((t) => Math.abs(t - s.timeMs) < 250))
      continue;
    const old = shots[j];
    shots.splice(
      j,
      1,
      { ...old, endMs: s.timeMs, fadeOut: false },
      { ...old, startMs: s.timeMs, fadeIn: false, boundaryConfidence: null },
    );
  }
  const colorPulses = separateColorPulses(shots, visual);
  refineFlashBoundaries(shots, visual);
  const cuts = shots.slice(1);
  for (const shot of shots) {
    // A residual split changes which frames describe each side of the boundary.
    const quality = analysis.video!.quality.filter(
      (f) => f.timeMs >= shot.startMs && f.timeMs < shot.endMs,
    );
    const vision = analysis.vision?.frames.filter(
      (f) => f.timeMs >= shot.startMs && f.timeMs < shot.endMs,
    );
    const changes = quality.filter((f) => f.timeMs > shot.startMs);
    if (quality.length)
      shot.luma = quality.reduce((n, f) => n + f.meanLuma, 0) / quality.length;
    if (changes.length)
      shot.motion =
        changes.reduce((n, f) => n + f.frameDifference, 0) / changes.length;
    shot.framing = vision?.[0]?.shotScale ?? null;
    shot.subject = vision?.[0]?.subject?.label ?? null;
    if (visual.length) {
      shot.embedding = averageEmbedding(vision?.map((f) => f.embedding) ?? []);
      shot.color = measuredColor(visual, shot.startMs, shot.endMs);
      shot.layout = measuredLayout(
        visual,
        shot.startMs + 100,
        shot.endMs - 100,
      );
    }
    const samples = motion.filter(
      (m) => m.timeMs > shot.startMs + 125 && m.timeMs < shot.endMs,
    );
    if (samples.length < 3) continue;
    const tracked = samples.filter((s) => s.confidence >= 0.25);
    const avg = (
      samples: readonly MotionSample[],
      get: (m: MotionSample) => number,
    ) => samples.reduce((n, m) => n + get(m), 0) / Math.max(1, samples.length);
    const hold = samples.find((m) => m.cadenceHoldMs != null)?.cadenceHoldMs;
    const dip =
      hold == null ? null : (hold - shot.startMs) / (shot.endMs - shot.startMs);
    shot.camera = {
      expansion: Math.max(
        -0.3,
        Math.min(
          0.3,
          tracked.reduce((sum, m) => sum + m.expansion, 0),
        ),
      ),
      drift: Math.min(1, avg(tracked, (m) => Math.hypot(m.panX, m.panY)) / 4),
      freeze: avg(samples, (m) => Number(m.freeze)),
      letterbox: avg(samples, (m) => Number(m.blackBars)),
      vignette: avg(samples, (m) => (m.blackBars ? 0 : m.edgeDarkening)),
      confidence: avg(samples, (m) => m.confidence),
      motionDip: dip,
    };
  }
  return dnaSchema.parse({
    version: 1,
    name: asset.name,
    width: asset.width,
    height: asset.height,
    shots,
    transitions: characterizeTransitions(shots, visual, motion),
    colorPulses,
    text:
      text &&
      assessReferenceText(
        classifyTextOverlays(text, asset.duration * 1000),
        transcript,
        map,
      ),
    bpm: map?.bpm ?? null,
    alignedCuts:
      events?.length && cuts.length
        ? cuts.filter((s) =>
            events.some((e) => Math.abs(s.startMs - e.timeMs) <= 120),
          ).length / cuts.length
        : null,
    onsetsPerSecond: map ? map.onsets.length / asset.duration : null,
    color: color
      ? {
          luma: color.meanLuma,
          contrast: color.contrastStd,
          saturation: color.meanSaturation,
          temperature: color.neutralTemperature,
        }
      : null,
  });
}
