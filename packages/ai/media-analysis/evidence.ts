import { type Project } from "../../project-schema";
import { type MediaAnalysis, type VisionFrame } from "./model";
export const activeTrainingLabels = [
  "deadlift",
  "squat",
  "bench press",
  "overhead press",
  "dumbbell exercise",
  "kettlebell exercise",
  "barbell exercise",
];
// Separation is against unrelated contexts. Setup/rest/pose compete through the
// active-family support denominator; a still image cannot establish a rep phase.
const competingLabels = [
  "running",
  "talking",
  "speaking to camera",
  "landscape",
  "street",
  "food",
  "animal",
  "room",
  "screen",
  "title",
  "abstract",
  "dark frame",
];
export type VisualEvidence = Pick<
  VisionFrame,
  "labels" | "detections" | "embedding"
>;
const unit = (n: number) => Math.max(0, Math.min(1, n));
export function cosine(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length || !a.length)
    throw new Error("Incompatible embedding dimensions");
  const dot = a.reduce((n, x, i) => n + x * b[i], 0),
    norm = Math.sqrt(
      a.reduce((n, x) => n + x * x, 0) * b.reduce((n, x) => n + x * x, 0),
    );
  if (!Number.isFinite(norm) || norm < 1e-8)
    throw new Error("Invalid embedding");
  return Math.max(-1, Math.min(1, dot / norm));
}
export function subjectEvidence(frame: VisualEvidence) {
  const subject = frame.detections
    .filter((d) => d.label === "person" && d.confidence >= 0.55)
    .sort(
      (a, b) =>
        b.bounds.width * b.bounds.height * b.confidence -
        a.bounds.width * a.bounds.height * a.confidence,
    )[0];
  if (!subject)
    return {
      subject: null,
      presence: 0,
      area: 0,
      centrality: null,
      edgeClipped: null,
      occlusion: null,
    };
  const b = subject.bounds,
    area = b.width * b.height;
  return {
    subject,
    presence: subject.confidence,
    area,
    centrality: unit(
      1 -
        Math.hypot(b.x + b.width / 2 - 0.5, b.y + b.height / 2 - 0.5) /
          Math.SQRT1_2,
    ),
    edgeClipped:
      b.x <= 0.01 ||
      b.y <= 0.01 ||
      b.x + b.width >= 0.99 ||
      b.y + b.height >= 0.99,
    occlusion: null,
  };
}
/** Broad activity gate; never converts a candidate exercise name into an observed fact. */
export function gymEvidence(frame: VisualEvidence, includePosing = false) {
  const trainingLabels = includePosing
    ? [...activeTrainingLabels, "posing", "mirror pose", "training setup"]
    : activeTrainingLabels;
  const active = frame.labels.filter((l) => trainingLabels.includes(l.label)),
    strongest = active.reduce((n, l) => Math.max(n, l.similarity), -1),
    competition = frame.labels
      .filter((l) => competingLabels.includes(l.label))
      .reduce((n, l) => Math.max(n, l.similarity), -1),
    support = active.reduce((n, l) => n + l.relativeConfidence, 0),
    subject = subjectEvidence(frame);
  return {
    eligible:
      subject.presence >= 0.55 &&
      subject.area >= 0.025 &&
      strongest >= 0.21 &&
      strongest - competition >= 0.02 &&
      support >= 0.55,
    similarity: strongest,
    margin: strongest - competition,
    relativeSupport: support,
    subject,
  };
}
const terms = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 1 &&
        ![
          "the",
          "all",
          "clip",
          "clips",
          "where",
          "find",
          "show",
          "say",
          "my",
          "a",
          "an",
        ].includes(w),
    );
function textMatch(query: string, text: string) {
  const words = terms(query),
    hay = text.toLowerCase();
  return words.length
    ? words.filter((w) => hay.includes(w)).length / words.length
    : 0;
}
export interface SearchHit {
  assetId: string;
  startMs: number;
  endMs: number;
  representativeMs: number;
  description: string;
  score: number;
  signals: {
    semantic: number | null;
    detector: number;
    transcript: number;
    labels: number;
    filename: number;
  };
}
export function scoreVisualQuery(
  query: string,
  frame: VisualEvidence,
  embedding?: readonly number[],
) {
  const semantic = embedding ? cosine(frame.embedding, embedding) : null,
    detector = frame.detections.reduce(
      (n, d) => Math.max(n, textMatch(query, d.label) * d.confidence),
      0,
    ),
    labels = frame.labels.reduce(
      (n, l) =>
        Math.max(
          n,
          textMatch(query, l.label) *
            l.relativeConfidence *
            (l.similarity >= 0.21 ? 1 : 0),
        ),
      0,
    );
  return { semantic, detector, labels };
}
export function semanticSearch(
  project: Project,
  analyses: readonly MediaAnalysis[],
  query: string,
  embedding?: readonly number[],
  modelVersion?: string,
): SearchHit[] {
  if (!query.trim()) return [];
  const hits: SearchHit[] = [];
  for (const asset of project.assets) {
    const own = analyses.filter(
        (a) => a.assetId === asset.id && a.fingerprint === asset.fingerprint,
      ),
      vision = own.find((a) => a.vision)?.vision,
      transcript =
        own.find((a) => a.transcript)?.transcript ??
        project.transcripts.find(
          (t) =>
            t.assetId === asset.id &&
            (!t.sourceFingerprint || t.sourceFingerprint === asset.fingerprint),
        );
    const filename = textMatch(query, asset.name),
      groups = new Map<string, VisionFrame[]>();
    for (const f of vision?.frames ?? []) {
      const id = `${f.sceneStartMs}:${f.sceneEndMs}`;
      const g = groups.get(id) ?? [];
      g.push(f);
      groups.set(id, g);
    }
    for (const frames of groups.values()) {
      const compatible =
          embedding && modelVersion === vision?.modelVersion
            ? embedding
            : undefined,
        scored = frames.map((f) => ({
          f,
          s: scoreVisualQuery(query, f, compatible),
        })),
        best = scored.sort(
          (a, b) =>
            (b.s.semantic ?? -1) +
            (b.s.detector * 0.3 + b.s.labels * 0.2) -
            ((a.s.semantic ?? -1) + (a.s.detector * 0.3 + a.s.labels * 0.2)),
        )[0],
        speech =
          transcript?.segments
            .filter(
              (s) =>
                s.endMs > best.f.sceneStartMs && s.startMs < best.f.sceneEndMs,
            )
            .reduce((n, s) => Math.max(n, textMatch(query, s.text)), 0) ?? 0,
        signals = { ...best.s, transcript: speech, filename },
        score = unit(
          0.55 * unit(((signals.semantic ?? 0.12) - 0.12) / 0.28) +
            0.2 * signals.detector +
            0.15 * signals.labels +
            0.15 * speech +
            0.1 * filename,
        );
      if (score >= 0.05)
        hits.push({
          assetId: asset.id,
          startMs: best.f.sceneStartMs,
          endMs: best.f.sceneEndMs,
          representativeMs: best.f.timeMs,
          description: best.f.description,
          score,
          signals,
        });
    }
    for (const s of transcript?.segments ?? []) {
      const match = textMatch(query, s.text);
      if (!match) continue;
      hits.push({
        assetId: asset.id,
        startMs: s.startMs,
        endMs: s.endMs,
        representativeMs: s.startMs,
        description: s.text,
        score: 0.7 + 0.3 * match,
        signals: {
          semantic: null,
          detector: 0,
          transcript: match,
          labels: 0,
          filename,
        },
      });
    }
    if (!groups.size && !transcript && filename)
      hits.push({
        assetId: asset.id,
        startMs: 0,
        endMs: Math.round(asset.duration * 1000),
        representativeMs: 0,
        description: `Filename match: ${asset.name}`,
        score: filename * 0.1,
        signals: {
          semantic: null,
          detector: 0,
          transcript: 0,
          labels: 0,
          filename,
        },
      });
  }
  return hits.sort((a, b) => b.score - a.score);
}
