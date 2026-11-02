import { z } from "zod";
import { identitySchema as id } from "../../project-schema/identity";
import { keyframeSchema } from "../../animation/schema";
import { revisionRecordSchema } from "../revisions/model";
const unit = z.number().finite().min(0).max(1),
  ms = z
    .number()
    .int()
    .min(0)
    .max(86_400_000 * 7);
export const boundsSchema = z
  .object({ x: unit, y: unit, width: unit.positive(), height: unit.positive() })
  .strict()
  .refine((b) => b.x + b.width <= 1.00001 && b.y + b.height <= 1.00001);
export const samplingSchema = z
  .object({
    startMs: ms,
    endMs: ms,
    intervalMs: z.number().int().min(100).max(1000),
  })
  .strict()
  .refine((s) => s.endMs > s.startMs && s.endMs - s.startMs <= 300000);
export const subjectSamplesSchema = z
  .object({
    assetId: id,
    fingerprint: z.string().min(1).max(8192),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    algorithm: z.literal("subject-samples-1"),
    modelVersion: z.string().max(128),
    processing: z.literal("LOCAL"),
    device: z.string().max(64),
    width: z.number().int().min(1).max(960),
    height: z.number().int().min(1).max(960),
    sampling: samplingSchema,
    samples: z
      .array(
        z
          .object({
            timeMs: ms,
            people: z
              .array(
                z
                  .object({
                    confidence: unit,
                    bounds: boundsSchema,
                    whiteTorsoFraction: unit,
                  })
                  .strict(),
              )
              .max(64),
          })
          .strict(),
      )
      .min(1)
      .max(1201),
  })
  .strict()
  .superRefine((r, c) => {
    if (
      r.samples.some(
        (s, i) =>
          s.timeMs < r.sampling.startMs ||
          s.timeMs >= r.sampling.endMs ||
          (i > 0 && s.timeMs <= r.samples[i - 1].timeMs),
      )
    )
      c.addIssue({
        code: "custom",
        message:
          "Subject samples must be ordered inside the requested source range",
      });
  });
export type SubjectSamples = z.infer<typeof subjectSamplesSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type ReframeMode = "locked" | "smooth" | "responsive";
export type SubjectChoice = "main" | "both" | "white-shirt";
const keys = z.array(keyframeSchema).min(1).max(1201);
export const reframeSchema = z
  .object({
    sequenceId: id,
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    changes: z
      .array(
        z
          .object({
            clipId: id,
            assetId: id,
            fingerprint: z.string().min(1).max(8192),
            sourceIn: z.number().int().nonnegative(),
            duration: z.number().int().positive(),
            x: keys,
            y: keys,
            scale: keys,
          })
          .strict(),
      )
      .min(1)
      .max(256),
    record: revisionRecordSchema,
  })
  .strict();
export type ReframeChange = z.infer<typeof reframeSchema>;
export const reframeRequest =
  /^(?:(?:make|convert|reframe)\s+(?:this|it|the (?:edit|sequence|video))\s+(?:into\s+|to\s+|a\s+)?(?:vertical|(?:an?\s+)?(?:instagram\s+)?reel|9:16)|keep\s+(?:me|both(?: people)?)\s+(?:centered|centred|visible)|track\s+(?:the )?person\s+in\s+(?:the |a )?white shirt)/i;
