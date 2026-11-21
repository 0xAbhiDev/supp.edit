import { z } from "zod";
import { dissolves, frameCuts, whipAt } from "./cuts";
import { actionSignature, actionSignatureSchema, effectSpans, shotSpan } from "./action-signature";
import { medianSharpness, sceneSignature, sceneSignatureSchema } from "./scene-signature";
import { toneSchema } from "./tone";
import { subjectShapeSchema } from "./subject-shape";
import { audioTimelineSchema } from "../audio/timeline";
import { eventGraphSchema } from "./event-graph";
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
            plateTint: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
            tone: toneSchema.optional(),
            subjectShape: subjectShapeSchema.optional(),
            /** The subject's outline at eight moments across the shot (pose trajectory). */
            subjectPath: z.array(subjectShapeSchema.nullable()).length(8).optional(),
            /** Person segmentation measured this shot and found nobody (after the detector check). */
            subjectAbsent: z.literal(true).optional(),
            /** How the shot moves over time (movement geometry, not a label). */
            action: actionSignatureSchema.optional(),
            /** What the shot shows when it barely moves: structure, horizon, role. */
            scene: sceneSignatureSchema.optional(),
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
    /** The reference's soundtrack measured on the shared clock, and its links to visual events. */
    audio: audioTimelineSchema.optional(),
    eventGraph: eventGraphSchema.optional(),
    personFlashes: z.array(z.object({startMs:z.number().int().nonnegative(),endMs:z.number().int().positive(),color:z.string().regex(/^#[0-9a-f]{6}$/i)}).strict().refine(f=>f.endMs>f.startMs)).max(300).optional(),
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
/** A sliver of a few frames between two flash boundaries is the flash's own ramp (scene detection
 * sees its brightening as a boundary), not a shot: it joins the outgoing shot and one flash
 * remains at the real cut, spanning both. Edits shots in place; returns the transitions. */
/** A boundary characterised as a plain cut (or unresolved movement) that sits inside a measured
 * whip is a whip: the shot boundary stays, its treatment is the sweep (direction, span, travel).
 * Flashes, blurs and dissolves keep their own evidence. */
function withWhips(transitions: ReturnType<typeof characterizeTransitions>, visual: readonly VisualFrame[]) {
  if (visual.length < 12) return transitions;
  return transitions.map((t) => {
    if (!["cut", "motion", "unresolved"].includes(t.kind)) return t;
    const w = whipAt(visual, t.cutMs);
    if (!w) return t;
    return { ...t, kind: "whip" as const, startMs: Math.min(w.startMs, t.cutMs), endMs: Math.max(w.endMs, t.cutMs), direction: w.direction, confidence: w.confidence, strength: Number(Math.min(1, w.travel).toFixed(3)), evidence: [`The picture sweeps ${w.direction} ${Math.round(w.travel * 100)}% of the frame over ${w.endMs - w.startMs} ms around the boundary (peak ${(w.peakMs / 1000).toFixed(2)} s).`] };
  });
}
export function absorbFlashSlivers(shots: { startMs: number; endMs: number }[], transitions: ReturnType<typeof characterizeTransitions>) {
  let out = [...transitions];
  for (let k = shots.length - 2; k >= 1; k--) {
    const sliver = shots[k];
    if (sliver.endMs - sliver.startMs >= 150) continue;
    const into = out.find((t) => Math.abs(t.cutMs - sliver.startMs) < 1),
      out_ = out.find((t) => Math.abs(t.cutMs - sliver.endMs) < 1);
    if (into?.kind !== "flash" || out_?.kind !== "flash") continue;
    shots[k - 1] = { ...shots[k - 1], endMs: sliver.endMs };
    shots.splice(k, 1);
    out = out.filter((t) => t !== into).map((t) => (t === out_ ? { ...t, startMs: Math.min(t.startMs, into.startMs), endMs: Math.max(t.endMs, into.endMs) } : t));
  }
  return out;
}
/** Measured dissolves take the place of whatever the boundary was characterised as: the blend's
 * span, its linearity as confidence, and the evidence. */
function withDissolves(transitions: ReturnType<typeof characterizeTransitions>, blends: ReturnType<typeof dissolves>, shots: readonly { startMs: number }[]) {
  const out = [...transitions];
  for (const d of blends) {
    const boundary = shots.find((x) => Math.abs(x.startMs - d.midMs) < 250);
    if (!boundary) continue;
    const entry = { cutMs: boundary.startMs, startMs: Math.min(d.startMs, boundary.startMs), endMs: Math.max(d.endMs, boundary.startMs), kind: "dissolve" as const, confidence: Number(Math.max(0.5, Math.min(0.95, 1 - d.residual * 5)).toFixed(3)), strength: Number(Math.min(1, d.strength * 4).toFixed(3)), direction: null, evidence: [`Linear blend of two shots over ${d.endMs - d.startMs} ms (departure ${d.residual}).`] };
    const at = out.findIndex((t) => Math.abs(t.cutMs - boundary.startMs) < 150);
    if (at >= 0) out[at] = entry;
    else out.push(entry);
  }
  return out.sort((a, b) => a.cutMs - b.cutMs);
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
  // Cuts between similar material (two dark takes from one corner) leave no residual the sparse
  // samples can see; at frame level they break flow and palette at once. Strict mode: titles,
  // flashes and pulses that return within half a second are effects, not shots.
  for (const cut of frameCuts(visual, [], text ?? [], true)) {
    const j = shots.findIndex((x) => cut.timeMs > x.startMs + 300 && cut.timeMs < x.endMs - 300);
    if (j < 0 || shots.some((x) => Math.abs(x.startMs - cut.timeMs) < 250)) continue;
    const old = shots[j];
    shots.splice(j, 1, { ...old, endMs: cut.timeMs, fadeOut: false }, { ...old, startMs: cut.timeMs, fadeIn: false, boundaryConfidence: null });
  }
  // Dissolves: two shots blended over a span. The new shot begins at the blend's midpoint.
  const blends = dissolves(visual);
  for (const d of blends) {
    const j = shots.findIndex((x) => d.midMs > x.startMs + 300 && d.midMs < x.endMs - 300);
    if (j < 0 || shots.some((x) => Math.abs(x.startMs - d.midMs) < 250)) continue;
    const old = shots[j];
    shots.splice(j, 1, { ...old, endMs: d.midMs, fadeOut: false }, { ...old, startMs: d.midMs, fadeIn: false, boundaryConfidence: null });
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
      const [from, to] = shotSpan(shot);
      const action = actionSignature(visual, undefined, from, to, asset.width / Math.max(1, asset.height), effectSpans({ colorPulses }));
      if (action) shot.action = action;
      const scene = sceneSignature(visual, from, to, action, vision?.find((f) => f.subject)?.subject?.bounds.height ?? null, (vision ?? []).flatMap((f) => f.detections ?? []), medianSharpness(visual));
      if (scene) shot.scene = scene;
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
    transitions: withWhips(absorbFlashSlivers(shots, withDissolves(characterizeTransitions(shots, visual, motion), blends, shots)), visual),
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
