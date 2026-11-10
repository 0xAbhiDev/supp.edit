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
