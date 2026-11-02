import { type Asset, type Project, uid, fps } from "../../project-schema";
import {
  type MediaAnalysis,
  type BeatMap,
  type VisionFrame,
} from "../media-analysis/model";
import {
  gymEvidence,
  subjectEvidence,
  cosine,
  scoreVisualQuery,
} from "../media-analysis/evidence";
import { type EditorPlan, previewEditPlan } from "../editor-agent/execution";
import { type EditorToolCall } from "../editor-agent/registry";
import { type EditBrief, briefSchema } from "./model";
import { nearestStrongBeat, strongEvents } from "./beats";
import { gymStyles } from "./styles";
import { musicEvents, type MusicEvent } from "./music";
import { styleRelevance } from "./hooks";
import { placeStyledShots } from "./placement";
import { initialShotColor, type ShotTreatment } from "./color";
const unit = (n: number) => Math.max(0, Math.min(1, n));
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export interface EditCandidate {
  id: string;
  assetId: string;
  fingerprint: string;
  cacheKey: string;
  sourceStartMs: number;
  sourceEndMs: number;
  representativeMs: number;
  motionPeakMs: number;
  semanticScore: number;
  promptRelevance: number;
  subjectScore: number;
  motionScore: number;
  diversityScore: number;
  overallScore: number;
  visualQuality: number;
  qualitySignals: {
    sharpness: number | null;
    meanLuma: number | null;
    darkFraction: number | null;
    clippedFraction: number | null;
    frozenFraction: number | null;
    meanFrameDifference: number | null;
    cameraShake: null;
  };
  subject: ReturnType<typeof subjectEvidence>;
  equipmentEvidence: null;
  frame: VisionFrame;
  reasons: string[];
}
export interface RankedEvidence {
  candidates: EditCandidate[];
  analyzedAssets: number;
  rejectedRanges: number;
  warnings: string[];
}
export interface PlannedShot {
  candidate: EditCandidate;
  sourceIn: number;
  startFrame: number;
  duration: number;
  beatAligned: boolean;
  placementReason?: string;
  role: "HOOK" | "BUILD" | "PEAK" | "END";
}
export interface RoughCutPlan {
  plan: EditorPlan;
  shots: PlannedShot[];
  candidates: EditCandidate[];
  brief: EditBrief;
  warnings: string[];
  durationSeconds: number;
  music: Asset | null;
  beatMap: BeatMap | null;
  musicEvents: MusicEvent[];
  color: ShotTreatment[][];
  analyzedAssets: number;
}
export function rankMoments(
  project: Project,
  analyses: readonly MediaAnalysis[],
  brief: EditBrief,
  query?: { embedding: readonly number[]; modelVersion: string },
): RankedEvidence {
  const candidates: EditCandidate[] = [],
    warnings: string[] = [];
  let analyzedAssets = 0,
    rejectedRanges = 0;
  for (const asset of project.assets.filter((a) => a.kind === "video")) {
    const result = analyses.find(
      (a) =>
        a.assetId === asset.id &&
        a.fingerprint === asset.fingerprint &&
        a.vision &&
        a.video,
    );
    if (!result?.vision || !result.video) continue;
    analyzedAssets++;
    if (result.vision.analyzedScenes < result.vision.totalScenes)
      warnings.push(
        `${asset.name}: ${result.vision.analyzedScenes}/${result.vision.totalScenes} scenes sampled.`,
      );
    for (const scene of result.video.scenes) {
      const frames = result.vision.frames.filter(
        (f) => f.sceneStartMs === scene.startMs && f.sceneEndMs === scene.endMs,
      );
      if (!frames.length || scene.endMs - scene.startMs < 1500) continue;
      // Non-overlapping windows prevent selecting the same source moment twice.
      for (
        let begin = scene.startMs;
        begin + 1500 <= scene.endMs;
        begin += 6000
      ) {
        const end = Math.min(scene.endMs, begin + 6000, asset.duration * 1000),
          center = (begin + end) / 2;
        const f = [...frames].sort(
            (a, b) => Math.abs(a.timeMs - center) - Math.abs(b.timeMs - center),
          )[0],
          gym = gymEvidence(
            f,
            brief.style === "physique" || brief.style === "powerlifting",
          ),
          subject = subjectEvidence(f);
        const quality = result.video.quality.filter(
            (q) => q.timeMs >= begin && q.timeMs < end,
          ),
          motion = mean(quality.map((q) => q.frameDifference)),
          dark = mean(quality.map((q) => q.darkFraction)),
          clipped = mean(quality.map((q) => q.clippedFraction)),
          sharpness = mean(quality.map((q) => q.laplacianVariance)),
          frozen = mean(
            quality.map((q) => (q.frameDifference < 0.001 ? 1 : 0)),
          );
        if (
          end - begin < 1500 ||
          (brief.profile === "gym" && !gym.eligible) ||
          (dark ?? 0) > 0.75 ||
          (frozen ?? 0) > (brief.style === "physique" ? 0.98 : 0.85) ||
          (brief.profile === "gym" &&
            brief.style !== "physique" &&
            (motion === null || motion < 0.001))
        ) {
          rejectedRanges++;
          continue;
        }
        const queryScore = scoreVisualQuery(
          brief.prioritize.join(" ") || brief.profile,
          f,
          query?.modelVersion === result.vision.modelVersion
            ? query.embedding
            : undefined,
        );
        const semanticScore = unit((gym.similarity - 0.18) / 0.17),
          promptRelevance =
            queryScore.semantic === null
              ? semanticScore
              : unit((queryScore.semantic - 0.12) / 0.25),
          subjectScore =
            subject.presence *
            (0.5 +
              0.25 * unit(subject.area / 0.15) +
              0.25 * (subject.centrality ?? 0)) *
            (subject.edgeClipped ? 0.8 : 1),
          motionScore = unit((motion ?? 0) / 0.05),
          sharpScore = unit(Math.log1p(sharpness ?? 0) / Math.log(2001)),
          exposure = unit(1 - (dark ?? 0) - (clipped ?? 0));
        const visualQuality = 0.6 * sharpScore + 0.4 * exposure;
        let overallScore =
          0.25 * semanticScore +
          0.15 * promptRelevance +
          0.2 * subjectScore +
          0.15 * motionScore +
          0.15 * sharpScore +
          0.1 * exposure;
        const style = brief.style ? gymStyles[brief.style] : undefined;
        if (style)
          overallScore =
            0.2 * semanticScore +
            0.15 * promptRelevance +
            0.2 * subjectScore +
            0.2 * visualQuality +
            0.15 * styleRelevance({ frame: f, semanticScore }, style) +
            0.1 * (1 - Math.abs(motionScore - style.motionTarget));
        const reasons = [
          `Broad training similarity ${gym.similarity.toFixed(3)}; exact exercise unverified`,
          `Person confidence ${(subject.presence * 100).toFixed(0)}%, ${(subject.area * 100).toFixed(0)}% frame area`,
          `Measured motion ${(motion ?? 0).toFixed(4)}; sharpness ${(sharpness ?? 0).toFixed(0)}`,
        ];
        if (subject.edgeClipped) reasons.push("Subject touches a frame edge");
        if (f.timeMs < begin || f.timeMs >= end)
          reasons.push("Visual context sampled elsewhere in this scene");
        candidates.push({
          id: `${asset.id}:${begin}:${end}`,
          assetId: asset.id,
          fingerprint: asset.fingerprint,
          cacheKey: result.cacheKey,
          sourceStartMs: begin,
          sourceEndMs: end,
          representativeMs: Math.max(begin, Math.min(end - 1, f.timeMs)),
          motionPeakMs:
            [...quality].sort(
              (a, b) => b.frameDifference - a.frameDifference,
            )[0]?.timeMs ?? center,
          semanticScore,
          promptRelevance,
          subjectScore,
          motionScore,
          diversityScore: 1,
          overallScore,
          visualQuality,
          qualitySignals: {
            sharpness,
            meanLuma: mean(quality.map((q) => q.meanLuma)),
            darkFraction: dark,
            clippedFraction: clipped,
            frozenFraction: frozen,
            meanFrameDifference: motion,
            cameraShake: null,
          },
          subject,
          equipmentEvidence: null,
          frame: f,
          reasons,
        });
      }
    }
  }
  return {
    candidates: candidates.sort((a, b) => b.overallScore - a.overallScore),
    analyzedAssets,
    rejectedRanges,
    warnings,
  };
}
export function diversify(
  candidates: readonly EditCandidate[],
): EditCandidate[] {
  const remaining = [...candidates],
    selected: EditCandidate[] = [];
  while (remaining.length) {
    const ranked = remaining
      .map((c) => {
        const similarity = selected.reduce(
            (n, s) =>
              Math.max(
                n,
                unit(
                  (cosine(c.frame.embedding, s.frame.embedding) - 0.75) / 0.25,
                ),
              ),
            0,
          ),
          sameSource = selected.some((s) => s.assetId === c.assetId) ? 1 : 0,
          diversity = 1 - Math.max(similarity, sameSource * 0.65);
        return { c, diversity, score: c.overallScore - 0.16 * (1 - diversity) };
      })
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    selected.push({
      ...best.c,
      diversityScore: best.diversity,
      reasons: [
        ...best.c.reasons,
        `Visual novelty ${(best.diversity * 100).toFixed(0)}% relative to earlier selections`,
      ],
    });
    remaining.splice(remaining.indexOf(best.c), 1);
  }
  return selected;
}
export function chooseMusic(
  project: Project,
  requested?: string | null,
  contextAsset?: string | null,
): Asset | null {
  if (requested) {
    const a = project.assets.find(
      (a) => a.id === requested && a.kind === "audio",
    );
    if (!a) throw new Error("Selected music is no longer available");
    return a;
  }
  const audio = project.assets.filter((a) => a.kind === "audio");
  if (audio.length === 1) return audio[0];
  const contextual = audio.find((a) => a.id === contextAsset);
  if (contextual) return contextual;
  if (audio.length > 1)
    throw new Error(
      "Choose the music asset before planning; several audio sources are imported.",
    );
  return null;
}
export function buildRoughCut(
  project: Project,
  revision: number,
  input: EditBrief,
  evidence: RankedEvidence,
  music: Asset | null,
  beatMap: BeatMap | null,
  selectedIds?: readonly string[],
): RoughCutPlan {
  const brief = briefSchema.parse(input),
    rate = fps(project),
    warnings = [...evidence.warnings];
  if (!evidence.candidates.length)
    throw new Error(
      "No sufficiently relevant gym/lifting footage was found. Visual analysis confidence is too low for reliable gym-lift selection. Inspect the source clips or choose different footage.",
    );
  if (brief.beatSync !== "off" && !music)
    throw new Error("Import or choose a music asset to synchronize this edit.");
  let ordered = selectedIds
    ? selectedIds.map((id) => {
        const c = evidence.candidates.find((c) => c.id === id);
        if (!c) throw new Error("Candidate is no longer available");
        return c;
      })
    : diversify(evidence.candidates);
  if (new Set(ordered.map((c) => c.id)).size !== ordered.length)
    throw new Error("A source moment cannot be repeated in this plan");
  if (!ordered.length) throw new Error("Select at least one moment");
  const nominal = {
      cinematic: 4.5,
      balanced: 3.8,
      energetic: 2.8,
      aggressive: 1.8,
    }[brief.pacing],
    target = Math.floor(
      Math.min(brief.durationSeconds, music?.duration ?? Infinity) * rate,
    ),
    minimum = Math.ceil(0.9 * rate),
    events = beatMap ? musicEvents(beatMap, (target / rate) * 1000) : [],
    shots: PlannedShot[] = brief.style
      ? placeStyledShots(
          project,
          brief,
          ordered,
          target,
          events,
          beatMap,
          !!selectedIds,
        )
      : [];
  const tolerance = { off: 0, loose: 120, balanced: 300, tight: 650 }[
    brief.beatSync
  ];
  let cursor = shots.reduce((n, s) => n + s.duration, 0);
  for (const c of brief.style ? [] : ordered) {
    const asset = project.assets.find(
      (a) => a.id === c.assetId && a.fingerprint === c.fingerprint,
    );
    if (!asset) throw new Error("Candidate media is missing or changed");
    const start = Math.ceil((c.sourceStartMs * rate) / 1000),
      end = Math.min(
        Math.floor((c.sourceEndMs * rate) / 1000),
        Math.floor(asset.duration * rate),
      ),
      available = end - start;
    let length = Math.min(
      Math.round(nominal * rate),
      available,
      target - cursor,
    );
    if (length < minimum) continue;
    const planned = ((cursor + length) / rate) * 1000,
      beat =
        beatMap && tolerance
          ? nearestStrongBeat(beatMap, planned, tolerance)
          : null;
    const aligned = beat
      ? Math.round((beat.timeMs * rate) / 1000) - cursor
      : null;
    const beatAligned =
      aligned !== null &&
      aligned >= minimum &&
      aligned <= available &&
      cursor + aligned <= target;
    if (beatAligned) length = aligned!;
    const sourceIn = Math.max(
      start,
      Math.min(
        end - length,
        Math.round((c.motionPeakMs * rate) / 1000 - length * 0.5),
      ),
    );
    shots.push({
      candidate: c,
      sourceIn,
      startFrame: cursor,
      duration: length,
      beatAligned,
      role: shots.length === 0 ? "HOOK" : "BUILD",
    });
    cursor += length;
    if (target - cursor < minimum) break;
  }
  if (!shots.length)
    throw new Error("The selected source ranges are too short");
  if (!brief.style && shots.length >= 3) shots[shots.length - 2].role = "PEAK";
  if (shots.length > 1) shots[shots.length - 1].role = "END";
  if (cursor < target - rate)
    warnings.push(
      `Only ${(cursor / rate).toFixed(1)} seconds of distinct selected ranges fit this pacing; footage was not repeated or stretched.`,
    );
  if (shots.length === 1)
    warnings.push(
      "Only one usable moment is available. This is a single-shot selection, not a multi-shot highlight edit.",
    );
  if (brief.beatSync !== "off" && (!beatMap || !strongEvents(beatMap).length))
    warnings.push(
      "No reliable musical onsets were found; cut timing is based on the selected pacing.",
    );
  if (brief.speedRamps !== "off")
    warnings.push(
      "Speed remapping is not implemented; this preview uses original source speed.",
    );
  if (brief.captions)
    warnings.push(
      "This rough-cut pass does not add captions yet. Source audio is preserved; transcript captions remain available in Media understanding.",
    );
  if (brief.style)
    warnings.push(
      "Initial color uses measured luma matching and restrained contrast/saturation. White balance, skin-aware matching, grain, vignette, sharpening, punch-ins and automatic ducking are not included in this pass.",
    );
  warnings.push(
    "Exercise identity, equipment type, rep phases, camera shake and occlusion are not verified. Scores are relative ranking signals, not probabilities.",
  );
  const id = uid(),
    videoTrackId = uid(),
    audioTrackId = uid(),
    prefix = brief.profile === "gym" ? "AI Gym Edit" : "AI Highlight Edit";
  let number = 1;
  while (
    project.compositions.some(
      (c) => c.name === `${prefix} ${String(number).padStart(2, "0")}`,
    )
  )
    number++;
  const name = `${prefix} ${String(number).padStart(2, "0")}`;
  // Preserve the current long-edge resolution, with even dimensions for H.264.
  const long = brief.style
      ? 1920
      : Math.max(project.settings.width, project.settings.height),
    [aw, ah] = brief.aspect.split(":").map(Number),
    factor = long / Math.max(aw, ah),
    settings = {
      ...project.settings,
      width: Math.max(16, Math.round((aw * factor) / 2) * 2),
      height: Math.max(16, Math.round((ah * factor) / 2) * 2),
    };
  const provenance = [
    ...new Map(
      shots.map((s) => [
        s.candidate.cacheKey,
        {
          assetId: s.candidate.assetId,
          fingerprint: s.candidate.fingerprint,
          cacheKey: s.candidate.cacheKey,
        },
      ]),
    ).values(),
  ];
  const commands: EditorToolCall[] = [
    {
      tool: "sequence.create",
      id,
      name,
      settings,
      duration: cursor,
      videoTrackId,
      audioTrackId,
      ai: {
        plannerVersion: "rough-cut-1",
        createdAt: new Date().toISOString(),
        brief,
        evidence: provenance,
        warnings,
      },
    },
  ];
  const style = brief.style ? gymStyles[brief.style] : null,
    color = style ? initialShotColor(shots, style) : shots.map(() => []);
  for (const [index, shot] of shots.entries()) {
    const clipId = uid();
    commands.push({
      tool: "sequence.insert",
      sequenceId: id,
      clipId,
      trackId: videoTrackId,
      assetId: shot.candidate.assetId,
      fingerprint: shot.candidate.fingerprint,
      startFrame: shot.startFrame,
      sourceIn: shot.sourceIn,
      duration: shot.duration,
      gain: 0,
    });
    for (const effect of color[index])
      commands.push({
        tool: "sequence.effect",
        sequenceId: id,
        clipId,
        effectId: uid(),
        type: effect.type,
        value: effect.value,
      });
    commands.push({
      tool: "sequence.marker",
      sequenceId: id,
      id: uid(),
      frame: shot.startFrame,
      name: `${shot.role}${shot.startFrame ? " · cut" : ""}`,
    });
  }
  if (music)
    commands.push({
      tool: "sequence.insert",
      sequenceId: id,
      clipId: uid(),
      trackId: audioTrackId,
      assetId: music.id,
      fingerprint: music.fingerprint,
      startFrame: 0,
      sourceIn: 0,
      duration: cursor,
      gain: style?.audio.musicDb ?? -14,
    });
  const plan: EditorPlan = {
    id: uid(),
    projectId: project.id,
    revision,
    compositionId: null,
    resultCompositionId: id,
    summary: `${name}: ${shots.length} selected moments, ${(cursor / rate).toFixed(1)} seconds${music ? `, music: ${music.name}` : ""}`,
    processing: "LOCAL",
    commands,
  };
  previewEditPlan(plan, project, revision);
  return {
    plan,
    shots,
    candidates: evidence.candidates,
    brief,
    warnings,
    durationSeconds: cursor / rate,
    music,
    beatMap,
    musicEvents: events,
    color,
    analyzedAssets: evidence.analyzedAssets,
  };
}
