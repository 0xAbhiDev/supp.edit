import { z } from "zod";

// Standalone persistence contract. Do not import project-schema from this file.
const id = z.string().min(1).max(128);
const milliseconds = z.number().finite().int().min(0).max(604_800_000);
export const transcriptSegmentSchema = z
  .object({
    id,
    startMs: milliseconds,
    endMs: milliseconds,
    text: z.string().min(1).max(10000),
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
    segments: z.array(transcriptSegmentSchema).min(1).max(10000),
  })
  .strict()
  .superRefine((transcript, context) => {
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
export type Transcript = z.infer<typeof transcriptSchema>;
