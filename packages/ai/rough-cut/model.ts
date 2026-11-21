import { z } from "zod";
import {
  visualRevision,
  musicRevision,
  removeRequest,
  audioRevision,
} from "../revisions/requests";
import { gymStyleSchema, gymStyles, requestedGymStyle } from "./styles";
import { treatmentSchema } from "../revisions/treatment-model";
export const pacingSchema = z.enum([
  "cinematic",
  "balanced",
  "energetic",
  "aggressive",
]);
export const briefSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    profile: z.enum(["gym", "general"]),
    style: gymStyleSchema.optional(),
    durationSeconds: z.number().finite().min(3).max(300),
    aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]),
    pacing: pacingSchema,
    beatSync: z.enum(["off", "loose", "balanced", "tight"]),
    captions: z.boolean(),
    speedRamps: z.enum(["off", "subtle", "dynamic"]),
    prioritize: z.array(z.string().max(128)).max(16),
  })
  .strict();
export type EditBrief = z.infer<typeof briefSchema>;
const curvePoints = z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(8);
/** One source moment a reference shot can play. */
export const takeSchema = z
  .object({
    sourceId: z.string().min(1).max(128),
    inMs: z.number().finite().nonnegative().max(2_000_000_000),
    outMs: z.number().finite().nonnegative().max(2_000_000_000),
    speed: z.number().finite().min(0.05).max(4),
    score: z.number().finite().min(-10).max(10),
    lostOn: z.string().max(400),
    curves: z.object({ red: curvePoints, green: curvePoints, blue: curvePoints }).strict().optional(),
    /** The take has no measured tone: choosing it removes the fitted curve (a neutral look). */
    neutral: z.boolean().optional(),
  })
  .strict()
  .refine((t) => t.outMs >= t.inMs, "A take ends after it starts");
export const aiEditMetadataSchema = z
  .object({
    plannerVersion: z.enum(["rough-cut-1", "reference-edit-1"]),
    createdAt: z.string().datetime(),
    brief: briefSchema,
    evidence: z
      .array(
        z
          .object({
            assetId: z.string().min(1).max(128),
            fingerprint: z.string().min(1).max(8192),
            cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(512),
    warnings: z.array(z.string().max(1000)).max(64),
    generated: z.array(treatmentSchema).max(512).optional(),
    /** Reference audio events placed as markers, and the layers each one drives. */
    referenceEvents: z
      .array(
        z
          .object({
            markerId: z.string().min(1).max(128),
            anchorKind: z.string().min(1).max(32),
            anchorMs: z.number().int().nonnegative(),
            confidence: z.number().min(0).max(1),
            links: z
              .array(
                z
                  .object({
                    layerId: z.string().min(1).max(128),
                    visual: z.string().min(1).max(32),
                    relation: z.enum(["on", "before", "after", "offbeat"]),
                    offsetMs: z.number().int().min(-10000).max(10000),
                  })
                  .strict(),
              )
              .max(16),
          })
          .strict(),
      )
      .max(2000)
      .optional(),
    /** Recreate mode: where each reference visual event went and why (structural alignment). */
    audioMapping: z
      .array(
        z
          .object({
            visual: z.string().min(1).max(32),
            referenceMs: z.number().int().nonnegative(),
            adaptedMs: z.number().int().nonnegative(),
            anchor: z.string().min(1).max(32),
            replacement: z.string().min(1).max(32),
            relation: z.string().min(1).max(16),
            offsetMs: z.number().int().min(-10000).max(10000),
            confidence: z.number().min(0).max(1),
            status: z.enum(["anchored", "no-replacement", "free"]),
            reasons: z
              .object({ type: z.number().min(0).max(1), section: z.number().min(0).max(1), phrase: z.number().min(0).max(1), strength: z.number().min(0).max(1), position: z.number().min(0).max(1) })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(400)
      .optional(),
    /** Frames of the detected events of the audio the sequence uses: snap targets for markers. */
    audioEventFrames: z.array(z.number().int().nonnegative()).max(4000).optional(),
    /** Which audio the plan used and why. */
    audioMode: z.enum(["music", "reference", "recreate"]).optional(),
    audioNotes: z.array(z.string().max(400)).max(64).optional(),
    /** Reference recreation: each shot's clip, the moment first chosen for it and its alternative
     * takes (source, interval, speed, and the tone curve fitted to that footage, or `neutral` when
     * it has none), so a reopened recreation can still swap a take and warn about reuse. */
    takes: z
      .array(
        z
          .object({
            clipId: z.string().min(1).max(128),
            original: takeSchema,
            alternatives: z.array(takeSchema).max(4),
          })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict();
export type AIEditMetadata = z.infer<typeof aiEditMetadataSchema>;
export type RequestRoute =
  "creative" | "search" | "analysis" | "transcript" | "revision" | "precise";
export function routeRequest(input: string): RequestRoute {
  if (audioRevision(input)) return "revision";
  if (/^(find|search|show)(?:\s+me)?\s/i.test(input)) return "search";
  if (
    /(?:remove|delete|cut)\s+(?:all\s+)?(?:pauses|silences|filler)/i.test(input)
  )
    return "transcript";
  if (/^(which|analy[sz]e|detect)\b/i.test(input)) return "analysis";
  if (
    visualRevision(input) ||
    musicRevision(input) ||
    removeRequest.test(input)
  )
    return "revision";
  if (
    /(?:third (?:shot|clip)|3rd (?:shot|clip)|intro faster|faster opening|opening faster|first \d+ seconds faster|remove captions|sync (?:the )?ending|make (?:this|it) (?:\d+|shorter)|shorten (?:it|this) to|use more|less bench|use (?:an?other|different) clip first|remove (?:the )?(?:last|final) (?:clip|shot)|tighten (?:the )?cuts|undo (?:that|the) revision)/i.test(
      input,
    )
  )
    return "revision";
  if (
    /\b(pick|make|create|build|edit)\b/i.test(input) &&
    /\b(gym|fitness|lifts?|reel|montage|rough cut|cinematic|highlight|video)\b/i.test(
      input,
    )
  )
    return "creative";
  return "precise";
}
/** Deterministic local brief parsing; no pretend language model or unbounded command generation. */
export function parseEditBrief(prompt: string): EditBrief {
  const style = requestedGymStyle(prompt),
    preset = style ? gymStyles[style] : undefined,
    duration = prompt.match(
      /\b(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s)\b/i,
    ),
    aspect = prompt.match(/\b(9:16|16:9|1:1|4:5)\b/),
    pacing = /aggressive/i.test(prompt)
      ? "aggressive"
      : /energetic|fast.paced/i.test(prompt)
        ? "energetic"
        : /cinematic/i.test(prompt)
          ? "cinematic"
          : (preset?.pacing ?? "balanced");
  return briefSchema.parse({
    prompt,
    ...(style ? { style } : {}),
    profile: /gym|fitness|lift|deadlift|barbell|bench|physique/i.test(prompt)
      ? "gym"
      : "general",
    durationSeconds: duration ? Number(duration[1]) : 30,
    aspect:
      aspect?.[1] ?? (/landscape|horizontal/i.test(prompt) ? "16:9" : "9:16"),
    pacing,
    beatSync: /no (?:beat|music)|without music/i.test(prompt)
      ? "off"
      : /tight|strong beats/i.test(prompt)
        ? "tight"
        : /music|beat|sync/i.test(prompt)
          ? (preset?.beatSync ?? "balanced")
          : "off",
    captions:
      /caption|subtitle/i.test(prompt) &&
      !/(?:no|remove|without) captions?/i.test(prompt),
    speedRamps:
      /(?:no|without|disable) speed ramps?|speed ramps?\s*(?:off|disabled)/i.test(
        prompt,
      )
        ? "off"
        : /speed ramp/i.test(prompt)
          ? /dynamic/i.test(prompt)
            ? "dynamic"
            : "subtle"
          : (preset?.speedRamps ?? "off"),
    prioritize: [
      ...new Set(
        prompt
          .toLowerCase()
          .match(
            /deadlift|bench press|barbell|dumbbell|squat|posing|physique|heavy lifts/g,
          ) ?? [],
      ),
    ],
  });
}
