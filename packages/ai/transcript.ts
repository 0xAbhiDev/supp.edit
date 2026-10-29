import { z } from "zod";

// Standalone persistence contract. Do not import project-schema from this file.
const id = z.string().min(1).max(128);
const milliseconds = z.number().finite().int().min(0).max(604_800_000);
export const transcriptWordSchema = z
  .object({
    text: z.string().min(1).max(1000),
    startMs: milliseconds,
    endMs: milliseconds,
    confidence: z.number().finite().min(0).max(1).optional(),
    speakerId: id.optional(),
  })
  .strict()
  .refine((w) => w.endMs >= w.startMs, { message: "Invalid word timing" });
export const transcriptSegmentSchema = z
  .object({
    id,
    startMs: milliseconds,
    endMs: milliseconds,
    text: z.string().min(1).max(10000),
    speakerId: id.optional(),
    words: z.array(transcriptWordSchema).max(10000).optional(),
  })
  .strict()
  .refine((segment) => segment.endMs > segment.startMs, {
    message: "Transcript segment end must follow its start",
  });
export const transcriptSchema = z
  .object({
    id,
    name: z.string().min(1).max(256),
    source: z.enum(["srt", "transcription"]),
    language: z.string().min(1).max(64).optional(),
    assetId: id.optional(),
    sourceFingerprint: z.string().min(1).max(8192).optional(),
    modelId: id.optional(),
    modelVersion: id.optional(),
    timingQuality: z.enum(["imported", "approximate"]).optional(),
    translated: z.boolean().optional(),
    segments: z.array(transcriptSegmentSchema).min(1).max(10000),
  })
  .strict()
  .superRefine((transcript, context) => {
    if (
      transcript.segments.reduce((n, s) => n + (s.words?.length ?? 0), 0) >
      100000
    )
      context.addIssue({
        code: "custom",
        message: "Transcript exceeds 100,000 words",
      });
    for (const segment of transcript.segments) {
      let previous = segment.startMs;
      for (const word of segment.words ?? []) {
        if (word.startMs < previous || word.endMs > segment.endMs)
          context.addIssue({
            code: "custom",
            message: "Word timing is outside its segment or unordered",
          });
        previous = word.startMs;
      }
    }
    if (
      new Set(transcript.segments.map((s) => s.id)).size !==
      transcript.segments.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate transcript segment IDs",
      });
    for (let i = 1; i < transcript.segments.length; i++)
      if (transcript.segments[i].startMs < transcript.segments[i - 1].startMs)
        context.addIssue({
          code: "custom",
          message: "Transcript segments must be ordered by start time",
        });
  });
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
