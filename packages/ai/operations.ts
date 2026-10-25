import type { AnimatedProperty, Clip, Keyframe } from "../project-schema";
import type { Transcript } from "./transcript";

export const operationKinds = [
  "Transcribe",
  "DetectSilence",
  "GenerateCaptions",
  "SegmentSubject",
  "RemoveBackground",
  "TrackObject",
  "EnhanceSpeech",
  "SemanticSearch",
] as const;
export type OperationKind = (typeof operationKinds)[number];
export type SourceBinding =
  | { kind: "media"; assetId: string; contentDigest: string }
  | { kind: "transcript"; transcriptId: string; contentDigest: string };
export interface TimelineRange {
  startFrame: number;
  endFrame: number;
}
interface OperationBase<K extends OperationKind> {
  id: string;
  kind: K;
  projectId: string;
  contextSnapshotId: string;
  revision: number;
  providerId: string;
  modelId: string;
  modelVersion: string;
  sources: readonly SourceBinding[];
}
export interface TranscribeOperation extends OperationBase<"Transcribe"> {
  language?: string;
}
export interface DetectSilenceOperation extends OperationBase<"DetectSilence"> {
  thresholdDb: number;
  minimumMs: number;
}
export interface GenerateCaptionsOperation extends OperationBase<"GenerateCaptions"> {
  transcript: Transcript;
  offsetFrames: number;
}
export interface SegmentSubjectOperation extends OperationBase<"SegmentSubject"> {
  clipId: string;
  range: TimelineRange;
}
export interface RemoveBackgroundOperation extends OperationBase<"RemoveBackground"> {
  clipId: string;
  range: TimelineRange;
}
export interface TrackObjectOperation extends OperationBase<"TrackObject"> {
  clipId: string;
  range: TimelineRange;
  seed: { x: number; y: number; width: number; height: number };
}
export interface EnhanceSpeechOperation extends OperationBase<"EnhanceSpeech"> {
  clipId: string;
}
export interface SemanticSearchOperation extends OperationBase<"SemanticSearch"> {
  query: string;
}
export interface OperationMap {
  Transcribe: TranscribeOperation;
  DetectSilence: DetectSilenceOperation;
  GenerateCaptions: GenerateCaptionsOperation;
  SegmentSubject: SegmentSubjectOperation;
  RemoveBackground: RemoveBackgroundOperation;
  TrackObject: TrackObjectOperation;
  EnhanceSpeech: EnhanceSpeechOperation;
  SemanticSearch: SemanticSearchOperation;
}
export type AIOperation = OperationMap[OperationKind];
export interface CaptionCue {
  segmentId: string;
  startFrame: number;
  endFrame: number;
  text: string;
}
export interface MaskProposal {
  clipId: string;
  frame: number;
  mask: NonNullable<Clip["mask"]>;
}
/** Opaque native artifact reference; never a file path or a URL accepted from model text. */
export type NativeArtifactHandle = string & {
  readonly __nativeArtifact: unique symbol;
};
export interface ResultMap {
  Transcribe: { kind: "Transcribe"; transcript: Transcript };
  DetectSilence: { kind: "DetectSilence"; ranges: TimelineRange[] };
  GenerateCaptions: {
    kind: "GenerateCaptions";
    transcript: Transcript;
    captions: CaptionCue[];
  };
  SegmentSubject: { kind: "SegmentSubject"; masks: MaskProposal[] };
  RemoveBackground: { kind: "RemoveBackground"; masks: MaskProposal[] };
  TrackObject: {
    kind: "TrackObject";
    clipId: string;
    channels: Partial<Record<AnimatedProperty, Keyframe[]>>;
  };
  EnhanceSpeech: {
    kind: "EnhanceSpeech";
    clipId: string;
    artifact: NativeArtifactHandle;
    durationMs: number;
  };
  SemanticSearch: {
    kind: "SemanticSearch";
    matches: { assetId: string; range: TimelineRange; score: number }[];
  };
}
export type AIResult = ResultMap[OperationKind];
export type GenerateCaptionsResult = ResultMap["GenerateCaptions"];
