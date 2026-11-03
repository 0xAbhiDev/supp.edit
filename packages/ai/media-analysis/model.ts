import { z } from "zod";
import { transcriptSchema } from "../transcript";
import { identitySchema } from "../../project-schema/identity";
export const VISION_MODEL_VERSION =
  "mobileclip-757d59c9-fp32-yolox-0.1.1rc0-ort1.31.1";
const ms = z.number().int().min(0).max(1_800_000),
  unit = z.number().finite().min(0).max(1);
export const mediaRangeSchema = z
  .object({ startMs: ms, endMs: ms })
  .strict()
  .refine((r) => r.endMs > r.startMs, { message: "Empty media range" });
export const analysisSettingsSchema = z
  .object({
    task: z.enum(["speech", "audio", "video", "vision"]),
    language: z.string().regex(/^[a-zA-Z-]{1,16}$/),
    translate: z.boolean(),
    thresholdDb: z.number().finite().min(-80).max(-5),
    minimumSilenceMs: z.number().int().min(100).max(10000),
    paddingMs: z.number().int().min(0).max(2000),
  })
  .strict();
export type AnalysisSettings = z.infer<typeof analysisSettingsSchema>;
export type AnalysisTask = AnalysisSettings["task"];
export const defaultAnalysisSettings = (
  task: AnalysisTask,
): AnalysisSettings => ({
  task,
  language: "auto",
  translate: false,
  thresholdDb: -35,
  minimumSilenceMs: 700,
  paddingMs: 100,
});
const onset = z.object({ timeMs: ms, strength: unit }).strict();
export const beatMapSchema = z
  .object({
    bpm: z.number().finite().min(60).max(200).nullable(),
    confidence: unit,
    beats: z.array(onset).max(30000),
    downbeats: z.array(ms).max(30000),
    onsets: z.array(onset).max(30000),
    energyCurve: z
      .array(
        z
          .object({ timeMs: ms, rmsDb: z.number().finite().min(-120).max(0) })
          .strict(),
      )
      .max(18001),
    method: z.string().max(1000),
  })
  .strict();
export const sceneSchema = z
  .object({
    startMs: ms,
    endMs: ms,
    representativeMs: ms,
    boundaryScore: unit.nullable(),
    motion: unit.nullable(),
    sharpness: z.number().finite().nonnegative().nullable(),
    blackFraction: unit.nullable(),
    frozenFraction: unit.nullable(),
  })
  .strict()
  .refine(
    (s) =>
      s.endMs > s.startMs &&
      s.representativeMs >= s.startMs &&
      s.representativeMs < s.endMs,
  );
const detectionSchema = z
  .object({
    label: z.string().min(1).max(128),
    confidence: unit,
    bounds: z
      .object({ x: unit, y: unit, width: unit, height: unit })
      .strict()
      .refine(
        (b) =>
          b.width > 0 &&
          b.height > 0 &&
          b.x + b.width <= 1.00001 &&
          b.y + b.height <= 1.00001,
      ),
  })
  .strict();
export const visionFrameSchema = z
  .object({
    timeMs: ms,
    sceneStartMs: ms,
    sceneEndMs: ms,
    width: z.number().int().min(1).max(960),
    height: z.number().int().min(1).max(960),
    orientation: z.enum(["landscape", "portrait", "square"]),
    description: z.string().max(1000),
    labels: z
      .array(
        z
          .object({
            label: z.string().max(128),
            similarity: z.number().finite().min(-1.00001).max(1.00001),
            relativeConfidence: unit,
          })
          .strict(),
      )
      .max(128),
    detections: z.array(detectionSchema).max(64),
    subject: detectionSchema.nullable(),
    shotScale: z.enum(["close", "medium", "wide"]).nullable(),
    embedding: z.array(z.number().finite().min(-1).max(1)).length(512),
  })
  .strict()
  .refine((f) => f.timeMs >= f.sceneStartMs && f.timeMs < f.sceneEndMs);
export type VisionFrame = z.infer<typeof visionFrameSchema>;
export const visionAnalysisSchema = z
  .object({
    modelId: z.string().max(128),
    modelVersion: z.string().max(128),
    device: z.string().max(64),
    frames: z.array(visionFrameSchema).min(1).max(96),
    totalScenes: z.number().int().min(1).max(2000),
    analyzedScenes: z.number().int().min(1).max(32),
    method: z.string().max(2000),
    limitations: z.array(z.string().max(1000)).max(32),
  })
  .strict();
export const analysisResultSchema = z
  .object({
    assetId: identitySchema,
    fingerprint: z.string().min(1).max(8192),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    algorithm: z.literal("media-analysis-1"),
    processing: z.literal("LOCAL"),
    durationMs: ms,
    settings: analysisSettingsSchema,
    transcript: transcriptSchema.optional(),
    speechDetected: z.boolean().optional(),
    vision: visionAnalysisSchema.optional(),
    audio: z
      .object({
        silences: z.array(mediaRangeSchema).max(18000),
        removalRanges: z.array(mediaRangeSchema).max(18000),
        beatMap: beatMapSchema,
      })
      .strict()
      .optional(),
    video: z
      .object({
        scenes: z.array(sceneSchema).min(1).max(2000),
        quality: z
          .array(
            z
              .object({
                timeMs: ms,
                meanLuma: unit,
                darkFraction: unit,
                clippedFraction: unit,
                laplacianVariance: z.number().finite().nonnegative(),
                frameDifference: unit,
              })
              .strict(),
          )
          .max(3601),
        method: z.string().max(1000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((r, c) => {
    const expected =
      r.settings.task === "speech"
        ? r.transcript || r.speechDetected === false
        : r.settings.task === "audio"
          ? r.audio
          : r.settings.task === "vision"
            ? r.vision
            : r.video;
    if (!expected)
      c.addIssue({
        code: "custom",
        message: "Analysis result is missing its task output",
      });
    if (r.speechDetected === false && r.transcript)
      c.addIssue({
        code: "custom",
        message: "No-speech output cannot contain a transcript",
      });
    if (
      r.transcript &&
      (r.transcript.assetId !== r.assetId ||
        r.transcript.sourceFingerprint !== r.fingerprint)
    )
      c.addIssue({
        code: "custom",
        message: "Transcript does not match the source",
      });
    for (const range of [
      ...(r.audio?.silences ?? []),
      ...(r.audio?.removalRanges ?? []),
      ...(r.video?.scenes ?? []),
      ...(r.transcript?.segments ?? []),
      ...(r.vision?.frames.map((f) => ({ endMs: f.sceneEndMs })) ?? []),
    ])
      if (range.endMs > r.durationMs)
        c.addIssue({
          code: "custom",
          message: "Analysis exceeds source duration",
        });
  });
export type MediaAnalysis = z.infer<typeof analysisResultSchema>;
export type BeatMap = z.infer<typeof beatMapSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type MediaRange = z.infer<typeof mediaRangeSchema>;
export interface DiarizationProvider {
  readonly id: string;
  readonly processing: "LOCAL" | "CLOUD";
  available(): Promise<boolean>;
  identifySpeakers(
    assetId: string,
    signal: AbortSignal,
  ): Promise<(MediaRange & { speakerId: string; confidence?: number })[]>;
}
export interface VisionProvider {
  readonly id: string;
  readonly processing: "LOCAL" | "CLOUD";
  available(): Promise<boolean>;
  analyzeFrames(
    assetId: string,
    timesMs: readonly number[],
    signal: AbortSignal,
  ): Promise<
    {
      timeMs: number;
      description?: string;
      detections: {
        label: string;
        confidence: number;
        box: { x: number; y: number; width: number; height: number };
      }[];
    }[]
  >;
}
