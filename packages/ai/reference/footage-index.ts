import { takeChoiceShift } from "./corrections";
import { classifySourceText, unrelatedTextPenalty, type ReferenceText } from "./source-text";
import { IDENTITY_MIN_MOTION, IDENTITY_MIN_SCORE, type IdentityMatch } from "./identity";
import { reuseOf } from "./take-reuse";
/** Long-footage selection. All supplied raw clips are one searchable pool, indexed once from the
 * cached analysis (dense 33 ms frame measurements, quality every 500 ms, scenes, vision
 * embeddings, person contours), so the reference can be rematched without decoding again.
 *
 *  - Segments: first-stage scenes split at frame-accurate cuts (cuts.ts), each kept a safety
 *    margin away from every cut. Nothing selected ever crosses a cut, and no measurement (look,
 *    movement, pose) of one segment borrows frames from its neighbour.
 *  - Candidates: action windows at movement peaks of the dense per-frame curve and calm windows
 *    for holds, inside every segment of every clip, with measured quality.
 *  - Requirements: each reference shot's duration, role, look, framing, pose, temporal action
 *    signature (action-signature.ts), and the moment inside it that matters (its strongest linked
 *    audio event, else its own movement peak).
 *  - Retrieval: stage A scores every candidate cheaply (look, movement level, framing, quality,
 *    duration feasibility); stage B reranks the best of them on movement geometry (trajectory,
 *    regions, rhythm, camera, subject outline trajectory) and pose.
 *  - Feasibility: a shot is filled only from a usable cut-safe stretch at least as long as the
 *    shot; up to 15% short is bridged by a mild retime; otherwise the shot is reported as one no
 *    source interval can faithfully fill.
 *  - Selection: a beam search over the whole edit adds progression and diversity and penalises
 *    reuse, stutter (near-identical neighbours) and retiming.
 *  - Trimming: the chosen window is cut so its action peak lands on the reference shot's peak.
 * Every choice keeps its scoring terms, the reasons, and distinct alternatives with what they
 * lost on. */
import type { Shot, RecreationMode } from "./dna";
import { averageEmbedding, embeddingSimilarity, layoutSimilarity, measuredColor, measuredLayout } from "./visual";
import { describeShots } from "./dna";
import { pathFit, shapeFit, shapeOver, shapePath } from "./subject-shape";
import { bodyFit, bodyPresence, bodySignature } from "./body-pose";
import type { SourceEvidence } from "./planner";
import { cutSafeSegments, frameCuts } from "./cuts";
import { actionSignature, actionSimilarity, smoothedChange, type ActionSignature } from "./action-signature";
import { sceneSignature, sceneSimilarity } from "./scene-signature";
import { castSignature, castSimilarity } from "./cast";
import { breakNearTies, calibrate, phaseWindows, planSequence, repeatGroups, sourceResources, stretchOf, strongStretches, type Coverage, type Option, type RepeatGroup, type SourceResource } from "./sequence-planner";

export interface FootageSegment {
  sourceId: string;
  startMs: number;
  endMs: number;
  /** A detected cut lies just before / after (the bounds already keep a margin from it). */
  cutBefore: boolean;
  cutAfter: boolean;
  /** No measurable change at all: a held still, a paused stream. */
  frozen: boolean;
}
export interface FootageCandidate {
  sourceId: string;
  /** Window considered for this candidate (source milliseconds). */
  startMs: number;
  endMs: number;
  /** The usable cut-safe stretch it lies in: nothing outside it may be used for this candidate. */
  sceneStartMs: number;
  sceneEndMs: number;
  /** The moment of strongest movement (or the window centre for a calm hold). */
  peakMs: number;
  kind: "action" | "hold";
  /** Movement level: mean per-frame change when dense frames exist, else 500 ms frame difference. */
  motion: number;
  /** 0–1 share of sampled frames that are sharp, exposed, stable and not black. */
  quality: number;
  qualityIssues: string[];
  luma: number | null;
  frozen: boolean;
}
export interface FootageIndex {
  candidates: FootageCandidate[];
  segments: FootageSegment[];
  cuts: { sourceId: string; timeMs: number; evidence: string[] }[];
  coverage: { clips: number; suppliedMs: number; analyzedMs: number; candidates: number; segments: number; cuts: number };
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Version of the per-clip index (segments, frame cuts, candidates). Part of its cache key with
 * the file identity, the vision model and whether person contours were measured. */
// 6: rebuilt from reference-visual-v8 (the index does not otherwise see the visual version).
/** Pose agreement when one side shows a person and the other was measured with nobody. */
export const PRESENCE_MISMATCH = 0.2;
export const INDEX_VERSION = "cut-safe-segments-6";
export interface SourceIndex extends FootageIndex {
  version: string;
}
export function sourceIndexKey(source: SourceEvidence) {
  const model = source.analysis.vision?.modelVersion ?? "no-vision";
  return `footage-index-${INDEX_VERSION}:${model}:${(source.outlines ?? source.people)?.length ? "people" : "no-people"}:${source.visual?.length ? "dense" : "sparse"}:${source.asset.fingerprint}`;
}
/** The persistent part of the index for one clip; reusable in any project holding the same file. */
export function indexSource(source: SourceEvidence): SourceIndex {
  return { version: INDEX_VERSION, ...indexClips([source]) };
}

/** One searchable pool over every clip, reusing each clip's cached index when it has one. */
export function buildFootageIndex(sources: SourceEvidence[]): FootageIndex {
  const parts = sources.map((source) => {
    const cached = source.index?.version === INDEX_VERSION ? source.index : undefined;
    if (!cached) return indexClips([source]);
    // Cached by file identity: the clip may carry another asset id in this project.
    const id = source.asset.id;
    return {
      ...cached,
      candidates: cached.candidates.map((c) => ({ ...c, sourceId: id })),
      segments: cached.segments.map((s) => ({ ...s, sourceId: id })),
      cuts: cached.cuts.map((c) => ({ ...c, sourceId: id })),
    };
  });
  const sum = (k: keyof FootageIndex["coverage"]) => parts.reduce((n, p) => n + p.coverage[k], 0);
  return {
    candidates: parts.flatMap((p) => p.candidates),
    segments: parts.flatMap((p) => p.segments),
    cuts: parts.flatMap((p) => p.cuts),
    coverage: { clips: sources.length, suppliedMs: sum("suppliedMs"), analyzedMs: sum("analyzedMs"), candidates: sum("candidates"), segments: sum("segments"), cuts: sum("cuts") },
  };
}

function indexClips(sources: SourceEvidence[]): FootageIndex {
  const candidates: FootageCandidate[] = [],
    allSegments: FootageSegment[] = [],
    allCuts: FootageIndex["cuts"] = [];
  let suppliedMs = 0,
    analyzedMs = 0;
  for (const source of sources) {
    const id = source.asset.id;
    const durationMs = source.asset.duration * 1000;
    suppliedMs += durationMs;
    const quality = source.analysis.video?.quality ?? [];
    const visual = source.visual ?? [];
    const dense = visual.length >= 8;
    if (dense) analyzedMs += Math.min(durationMs, visual.at(-1)!.timeMs - visual[0].timeMs + 33);
    else if (quality.length) analyzedMs += Math.min(durationMs, quality.at(-1)!.timeMs - quality[0].timeMs + (quality[1]?.timeMs ?? 500) - quality[0].timeMs);
    const sharpRef = median(quality.map((q) => q.laplacianVariance));
    const good = (q: (typeof quality)[number]) => {
      const issues: string[] = [];
      if (q.meanLuma < 0.03) issues.push("black");
      else if (q.meanLuma < 0.05 || q.meanLuma > 0.94) issues.push("exposure");
      if (q.laplacianVariance < Math.max(4, 0.3 * sharpRef)) issues.push("blur");
      if (q.frameDifference > 0.45) issues.push("shake or transition");
      return issues;
    };
    let scenes: Shot[] = [];
    try {
      scenes = describeShots(source.asset, source.analysis);
    } catch {
      continue;
    }
    let segments: { startMs: number; endMs: number; cutBefore: boolean; cutAfter: boolean }[];
    if (dense) {
      // Frame-accurate second stage: cuts between similar material the scene pass missed.
      // Cut evidence reads the segmentation's own outlines: a jump of any outlined region is a
      // picture change, person or not.
      const cuts = frameCuts(visual, source.outlines ?? source.people ?? []);
      for (const c of cuts) allCuts.push({ sourceId: id, timeMs: c.timeMs, evidence: c.evidence });
      // Two frames clear of every cut at the dense rate actually measured (30 fps, or 15 past 20 min).
      const step = median(visual.slice(1, 200).map((f, k) => f.timeMs - visual[k].timeMs));
      segments = cutSafeSegments(scenes, cuts, Math.max(67, Math.round(2 * step)), 400);
      // A frozen run (no codec change for at least 0.5 s: a held still, a paused stream) beside live
      // footage is its own stretch, so live windows are never judged by the hold next to them.
      const frozenRuns: { startMs: number; endMs: number }[] = [];
      // Hysteresis: up to three changing frames inside a run (quantisation of a near-still picture)
      // do not end it.
      let runStart = -1,
        lastStill = -1;
      for (let i = 1; i <= visual.length; i++) {
        const still = i < visual.length && visual[i].change < 0.00015;
        if (still) {
          if (runStart < 0) runStart = i;
          lastStill = i;
        } else if (runStart >= 0 && (i === visual.length || i - lastStill > 3)) {
          const startMs = visual[runStart].timeMs,
            endMs = visual[lastStill].timeMs + 33;
          if (endMs - startMs >= 500) frozenRuns.push({ startMs, endMs });
          runStart = -1;
        }
      }
      segments = segments.flatMap((seg) => {
        const parts: typeof segments = [];
        let at = seg.startMs;
        for (const run of frozenRuns.filter((r) => r.endMs > seg.startMs && r.startMs < seg.endMs)) {
          const a = Math.max(seg.startMs, run.startMs),
            b = Math.min(seg.endMs, run.endMs);
          if (a - 33 - at >= 400) parts.push({ startMs: at, endMs: a - 33, cutBefore: at === seg.startMs ? seg.cutBefore : false, cutAfter: false });
          if (b - a >= 400) parts.push({ startMs: a, endMs: b, cutBefore: a === seg.startMs ? seg.cutBefore : false, cutAfter: b === seg.endMs ? seg.cutAfter : false });
          at = b + 33;
        }
        if (seg.endMs - at >= 400) parts.push({ startMs: at, endMs: seg.endMs, cutBefore: at === seg.startMs ? seg.cutBefore : false, cutAfter: seg.cutAfter });
        return parts.length ? parts : [seg];
      });
    } else {
      // Without dense frames: an isolated one-sample spike of 500 ms frame difference is a cut.
      segments = [];
      for (const scene of scenes) {
        const inside = quality.filter((q) => q.timeMs >= scene.startMs && q.timeMs < scene.endMs);
        let start = scene.startMs,
          cutBefore = false;
        inside.forEach((q, k) => {
          const around = [inside[k - 2], inside[k - 1], inside[k + 1], inside[k + 2]].filter(Boolean).map((x) => x!.frameDifference);
          if (k > 0 && around.length && q.frameDifference >= 0.05 && q.frameDifference >= 2.5 * median(around)) {
            const before = inside[k - 1].timeMs;
            if (before - start >= 400) segments.push({ startMs: start, endMs: before, cutBefore, cutAfter: true });
            start = q.timeMs;
            cutBefore = true;
          }
        });
        if (scene.endMs - start >= 400) segments.push({ startMs: start, endMs: scene.endMs, cutBefore, cutAfter: false });
      }
    }
    for (const seg of segments) {
      const frames = dense ? visual.filter((f) => f.timeMs >= seg.startMs && f.timeMs < seg.endMs) : [];
      const samples = quality.filter((q) => q.timeMs > seg.startMs && q.timeMs < seg.endMs);
      const frozen = frames.length >= 8 && frames.slice(1).filter((f) => f.change < 0.00015).length >= 0.9 * (frames.length - 1);
      allSegments.push({ sourceId: id, ...seg, frozen });
      if (!frames.length && !samples.length) continue;
      const window = (a: number, b: number, peakMs: number, kind: FootageCandidate["kind"]) => {
        const inside = samples.filter((q) => q.timeMs >= a && q.timeMs < b);
        const issues = inside.map(good);
        const ok = inside.length ? issues.filter((i) => !i.length).length / inside.length : frames.length ? 1 : 0;
        const counts = new Map<string, number>();
        for (const list of issues) for (const i of list) counts.set(i, (counts.get(i) ?? 0) + 1);
        const moving = frames.filter((f) => f.timeMs > a && f.timeMs < b);
        candidates.push({
          sourceId: id,
          startMs: Math.round(a),
          endMs: Math.round(b),
          sceneStartMs: seg.startMs,
          sceneEndMs: seg.endMs,
          peakMs: Math.round(peakMs),
          kind,
          motion: moving.length ? mean(moving.map((f) => f.change)) : inside.length ? mean(inside.map((q) => q.frameDifference)) : 0,
          quality: Number(ok.toFixed(3)),
          qualityIssues: [...counts].filter(([, n]) => n >= Math.max(1, inside.length * 0.3)).map(([i]) => i).concat(frozen ? ["held still frame"] : []),
          luma: moving.length ? mean(moving.map((f) => f.luma)) : inside.length ? mean(inside.map((q) => q.meanLuma)) : null,
          frozen,
        });
      };
      const peaks: number[] = [];
      if (frames.length >= 8) {
        // Action: local maxima of the dense movement curve clearly above the segment's typical
        // movement, at least 400 ms apart (repetitions give one candidate each).
        const e = smoothedChange(frames);
        const typical = median(e),
          top = Math.max(...e);
        const found: { t: number; v: number }[] = [];
        for (let k = 1; k < e.length; k++) {
          const v = e[k];
          if (v < Math.max(typical * 1.4, top * 0.55, 0.0012)) continue;
          if (e[k - 1] > v || (k + 1 < e.length && e[k + 1] >= v)) continue;
          found.push({ t: frames[k].timeMs, v });
        }
        found.sort((x, y) => y.v - x.v);
        for (const p of found) if (!peaks.some((q) => Math.abs(q - p.t) < 400)) peaks.push(p.t);
        peaks.sort((x, y) => x - y);
      } else {
        const motion = samples.map((q) => q.frameDifference);
        const typical = median(motion),
          top = Math.max(...motion);
        for (let k = 0; k < samples.length; k++) {
          const v = motion[k];
          if (v < Math.max(typical * 1.4, top * 0.55) || v < 0.004) continue;
          if (k > 0 && motion[k - 1] > v) continue;
          if (k + 1 < samples.length && motion[k + 1] >= v) continue;
          const a = motion[k - 1] ?? v,
            c = motion[k + 1] ?? v,
            denom = a - 2 * v + c,
            shift = denom ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0,
            step = (samples[1]?.timeMs ?? samples[0].timeMs + 500) - samples[0].timeMs;
          peaks.push(Math.round(samples[k].timeMs + shift * step));
        }
      }
      if (!frozen) for (const p of peaks) window(Math.max(seg.startMs, p - 1500), Math.min(seg.endMs, p + 1500), p, "action");
      // Holds: calm windows every 2 s, for shots that need little movement.
      for (let a = seg.startMs; a < seg.endMs - 400; a += 2000) {
        const b = Math.min(seg.endMs, a + 3000);
        if (frozen || !peaks.some((p) => p >= a && p < b)) window(a, b, Math.round((a + b) / 2), "hold");
      }
    }
  }
  return {
    candidates,
    segments: allSegments,
    cuts: allCuts,
    coverage: { clips: sources.length, suppliedMs: Math.round(suppliedMs), analyzedMs: Math.round(analyzedMs), candidates: candidates.length, segments: allSegments.length, cuts: allCuts.length },
  };
}

export type ShotRole = "establishing" | "action peak" | "detail" | "close-up" | "wide movement" | "setup" | "transition" | "rest/hold";
export interface ShotRequirement {
  shot: Shot;
  /** Wanted duration in source milliseconds. */
  durationMs: number;
  /** Where inside the shot its important moment falls (0–1), and why. */
  peakFraction: number;
  peakSource: "audio event" | "reference motion" | "none";
  role?: ShotRole;
  /** Reference titles on screen during the shot (reference frame fractions). */
  texts?: ReferenceText[];
  /** The shot's own frames found in a raw clip (same footage): that moment plays it. */
  identity?: IdentityMatch;
  /** Source time the incoming dissolve needs before the in-point (dissolveLeadIn). */
  leadInMs?: number;
}

/** A shot entered by a dissolve plays the incoming footage from before its in-point, for the length
 * of the blend: the trim must leave that much of the same cut-safe stretch before it. */
export function dissolveLeadIn(transitions: readonly { kind: string; cutMs: number; startMs: number; endMs: number }[] | undefined, shot: { startMs: number }) {
  const d = (transitions ?? []).find((t) => t.kind === "dissolve" && Math.abs(t.cutMs - shot.startMs) < 150);
  return d ? Math.min(4000, Math.max(0, d.endMs - d.startMs)) : 0;
}

/** What a reference shot does in the edit, from its measured look and movement. */
export function shotRole(shot: Shot, index: number, count: number, peakSource: ShotRequirement["peakSource"], next?: Shot): ShotRole {
  const a = shot.action,
    length = shot.endMs - shot.startMs;
  const level = a?.level ?? (shot.motion ?? 0) / 4;
  const camera = a ? Math.abs(a.camera.panX) + Math.abs(a.camera.panY) + Math.abs(a.camera.zoom) : (shot.camera?.drift ?? 0) / 2;
  const height = shot.subjectShape?.height ?? null;
  if (length < 450 && level > 0.01) return "transition";
  // A hold is a still picture, or weak movement spread over the frame; a small object moving in
  // one place (a spoon, a stream, a vehicle far away) is an action even at a low level.
  const localized = (shot.scene?.localized ?? 0) >= 0.45;
  if (level < 0.0003 || (level < 0.0015 && !localized)) return "rest/hold";
  if (peakSource === "audio event" && (a?.peakedness ?? 0) >= 1.5) return "action peak";
  if (camera > 0.08 || (shot.framing === "wide" && level > 0.006)) return "wide movement";
  if (shot.framing === "close" || (height !== null && height > 0.9)) return level > 0.006 ? "close-up" : "detail";
  if (index === 0 && count > 2 && (shot.framing === "wide" || level < 0.004)) return "establishing";
  const nextLevel = next?.action?.level ?? (next?.motion ?? 0) / 4;
  if (next && level < 0.5 * nextLevel) return "setup";
  return "action peak";
}

/** A source window and why it fits; undefined when the candidate cannot fill the shot. */
export interface Scored {
  inMs: number;
  outMs: number;
  peakMs: number;
  /** Playback speed needed to fill the shot from the usable stretch (1 = none). */
  speed: number;
  score: number;
  match: Record<string, number>;
  /** Movement-geometry detail when measured (stage B). */
  action?: ReturnType<typeof actionSimilarity>;
  /** Pose agreement when a person was measured on both sides (stage B). */
  pose?: number | null;
  /** Subject scale (height share, or framing class) for transition context. */
  scale?: number | null;
}
export interface ShotChoice {
  sourceId: string;
  /** Chosen trim (source milliseconds). */
  inMs: number;
  outMs: number;
  peakMs: number;
  speed: number;
  score: number;
  /** 0–1 per criterion, for display. */
  match: Record<string, number>;
  role: ShotRole;
  /** Plain reasons: what made it win, feasibility, peak alignment. */
  why: string[];
  confidence: "high" | "medium" | "low";
  /** "close match": the evidence says this moment plays the shot; "best available": nothing in
   * the footage clearly does, and this is the strongest candidate. */
  label: "close match" | "best available";
  /** The shot's own frames were found in this clip (same footage). */
  identity?: IdentityMatch;
  /** Calibrated 0–1 confidence: measured agreement on what the shot does (movement geometry and
   * pose), quality and duration fit — not the absolute score or the margin. */
  certainty: number;
  /** Score lead over the best alternative from another stretch. */
  margin: number;
  /** Score lead over the best non-overlapping moment anywhere, the same stretch included. */
  rival: number;
  /** Agreement on what the shot does (movement geometry and pose), null where unmeasured. */
  semantic: number | null;
  /** How well the source footage covers this shot. */
  coverage: Coverage;
  /** Movement phases the window holds when it was cut on phase boundaries. */
  phase?: string;
  alternatives: { sourceId: string; inMs: number; outMs: number; speed: number; score: number; match: Record<string, number>; lostOn: string }[];
  reuse: { intentional: boolean; permitted?: boolean; reason: string; confidence?: number } | null;
  /** The shot could not be filled faithfully: what was tried and why it fell short. */
  shortfall: string | null;
}

/** Close Match follows the stated priority: action (pose and movement geometry), framing,
 * movement level, peak alignment, composition, tone, quality; look (a frame embedding) counts
 * less, since similar rooms look alike whatever happens in them. Remix leans on movement. */
/** Movement level under which a shot is a still picture (shotRole calls it a rest/hold). */
export const STILL_LEVEL = 0.0003;
/** Confidence a "close match" label needs. Set from the evaluation set (real edits and footage,
 * labelled before any run; docs/EVALUATION_SET.md) with the earlier matrix:
 *  - evaluation set baseline (7 pairs, 35 close-match labels): 65–80% was right 4 times in 15, 80%
 *    and up 17 in 20;
 *  - matrix (planted moments, 74 right picks): 65–80% was right 4 in 4.
 * Together 65–80% is right 8 times in 19, too often wrong for "close match". From 80%, 11 wrong
 * close matches become "best available", for 8 right picks shown as best available. Same-footage
 * picks reach 80% at an identity score of about 0.88. */
export const CLOSE_MATCH_CERTAINTY = 0.8;
/** Score kept when the pose model saw a body on one side and nobody on the other. */
export const BODY_MISMATCH_FACTOR = 0.9;
/** Casting (cast.ts: who or what the window shows) is evidence of the shot's role that survives
 * other recordings: the evaluation set's baseline filled faces and openers by movement alone (role
 * fit 7/20 for faces, 0/5 for openers). It works as a gate, not a weighted term: a window showing
 * another kind of subject (a vehicle for a face, nobody for a person) loses up to this share of its
 * score, while windows of the same kind are left to movement and pose (as a weighted term, its coarse
 * sense of size and scale moved the gym's deadlift shot to a squat). */
export const CAST_MISMATCH = 0.15;
const weights: Record<RecreationMode, Record<string, number>> = {
  // Learned from the labelled evaluation pairs (scripts/eval/tune.mjs, 23 November 2026): peak
  // 0.5 → 0.3, composition 0.3 → 0.18 and quality 0.6 → 0.36 lifted right actions 33 → 37 of 74
  // offline, own and different footage both, with fewer wrong close matches (10 → 8).
  "Close Match": { action: 1.0, pose: 1.2, look: 0.6, framing: 0.5, motion: 0.3, peak: 0.3, composition: 0.18, tone: 0.2, quality: 0.36, scene: 1 },
  "Smart Adaptation": { action: 0.9, pose: 0.8, look: 0.6, framing: 0.5, motion: 0.6, peak: 0.5, composition: 0.35, tone: 0.25, quality: 0.6, scene: 1 },
  // Remix reinterprets rhythm (durations), grade and framing, but still performs what each
  // reference shot does: movement geometry and pose lead; look, framing and tone barely count.
  "Creative Remix": { action: 1.0, pose: 0.7, look: 0.25, framing: 0.15, motion: 0.7, peak: 0.6, composition: 0.1, tone: 0.1, quality: 0.6, scene: 0.5 },
};
/** The weights themselves, for the evaluation tools that tune them offline (scripts/eval/tune.mjs). */
export const MATCH_WEIGHTS = weights;
/** What each role cares about more. */
const roleEmphasis: Partial<Record<ShotRole, Record<string, number>>> = {
  "action peak": { action: 1.3, peak: 1.1 },
  "rest/hold": { action: 0.6, motion: 1.4, look: 1.2 },
  "close-up": { framing: 1.5, pose: 1.2 },
  detail: { framing: 1.5, look: 1.2, action: 0.7 },
  "wide movement": { action: 1.2, framing: 1.2 },
  establishing: { look: 1.3, composition: 1.3, action: 0.8 },
  transition: { motion: 1.3, action: 0.8 },
};
export const termLabels: Record<string, string> = {
  action: "action trajectory",
  pose: "pose",
  look: "look",
  framing: "framing",
  motion: "movement level",
  peak: "audio/action peak",
  composition: "composition",
  tone: "tone",
  quality: "quality",
  trajectory: "movement over time",
  regions: "where it moves",
  camera: "camera move",
  subject: "body trajectory",
  duration: "duration fit",
  scene: "scene and role",
  cast: "who or what it shows",
  direction: "motion direction",
  envelope: "activity timing",
};

/** Score one candidate for one reference shot, trimmed so its peak lands on the shot's peak.
 * deep: measure movement geometry and pose (stage B); otherwise the cheap terms only. */
export function scoreCandidate(
  req: ShotRequirement,
  c: FootageCandidate,
  source: SourceEvidence,
  mode: RecreationMode,
  deep = true,
  /** An explicit window inside the stretch (a phase window); otherwise trimmed on the peak. */
  window?: { inMs: number; outMs: number },
): Scored | undefined {
  const len = req.durationMs;
  const lo = c.sceneStartMs,
    hi = c.sceneEndMs;
  const usable = hi - lo;
  // Duration feasibility before anything else: never borrow frames across a cut.
  if (usable < len * 0.85) return undefined;
  let speed: number, sourceLen: number, inMs: number;
  if (window) {
    if (window.inMs < lo - 1 || window.outMs > hi + 1) return undefined;
    sourceLen = Math.min(len, window.outMs - window.inMs);
    speed = Number(Math.min(1, sourceLen / len).toFixed(3));
    if (speed < 0.85) return undefined;
    inMs = window.inMs;
  } else {
    speed = usable >= len ? 1 : Number((usable / len).toFixed(3));
    sourceLen = Math.min(usable, len * speed);
    inMs = c.peakMs - req.peakFraction * sourceLen;
    // Leave the incoming dissolve its frames before the in-point when the stretch has room.
    const lead = Math.min(req.leadInMs ?? 0, Math.max(0, hi - sourceLen - lo));
    inMs = Math.max(lo + lead, Math.min(hi - sourceLen, inMs));
  }
  const outMs = inMs + sourceLen;
  const achieved = (c.peakMs - inMs) / Math.max(1, sourceLen);
  // Look: embeddings measured inside this segment, near the window; otherwise the dense colour.
  const vision = source.analysis.vision?.frames ?? [];
  const frames = vision.filter((f) => f.timeMs >= Math.max(lo, inMs - 500) && f.timeMs < Math.min(hi, outMs + 500));
  const embedded = embeddingSimilarity(req.shot.embedding, averageEmbedding(frames.map((f) => f.embedding)));
  const color = req.shot.color && source.visual?.length ? measuredColor(source.visual, inMs, outMs) : null;
  const colorFit =
    req.shot.color && color
      ? Math.exp(
          -(
            Math.abs(req.shot.color.luma - color.luma) / 0.12 +
            Math.abs(req.shot.color.contrast - color.contrast) / 0.1 +
            Math.abs(req.shot.color.saturation - color.saturation) / 0.12 +
            (req.shot.color.temperature !== null && color.temperature !== null ? Math.abs(req.shot.color.temperature - color.temperature) / 0.3 : 0)
          ) / 2.5,
        )
      : null;
  const look = embedded !== null ? embedded : colorFit !== null ? colorFit * 2 - 1 : null;
  const layout = layoutSimilarity(req.shot.layout, measuredLayout(source.visual ?? [], inMs, outMs));
  const shotScale = (frames.length ? frames : vision.filter((f) => f.timeMs >= lo && f.timeMs < hi))[0]?.shotScale ?? null;
  // Who or what the window shows, from the vision frames near it (else its stretch's).
  const castFit = castSimilarity(req.shot.cast, castSignature(frames.length ? frames : vision.filter((f) => f.timeMs >= lo && f.timeMs < hi)));
  const cast = castFit?.overall ?? null;
  // Movement level on the same scale on both sides: dense per-frame change when both measured it.
  const refLevel = req.shot.action?.level,
    dense = refLevel !== undefined && (source.visual?.length ?? 0) >= 8;
  // A still reference shot: below the still level on both sides, how still is mostly noise (a
  // resting hand's drift against a plate that never moves), so the measured difference counts
  // half; what the picture shows decides the rest. Counting it not at all reordered a whole plan
  // through near-ties (street holdout 5/6 → 3/6); counting it fully lost the cooking shot 4.
  const bothStill = dense && refLevel! < STILL_LEVEL && c.motion < STILL_LEVEL;
  const measuredFit = dense ? Math.exp(-Math.abs(Math.log((0.0015 + c.motion) / (0.0015 + refLevel!)))) : 0;
  const motionFit = bothStill
    ? (1 + measuredFit) / 2
    : dense
    ? Math.exp(-Math.abs(Math.log((0.0015 + c.motion) / (0.0015 + refLevel!))))
    : req.shot.motion !== null
      ? Math.exp(-Math.abs(Math.log((0.008 + c.motion) / (0.008 + req.shot.motion))))
      : 0.5;
  let action: ReturnType<typeof actionSimilarity> | undefined;
  let pose: number | null = null;
  // Pose from joint angles (body-pose.ts) rather than silhouettes.
  let jointPose = false;
  // The pose model measured a body on one side and nobody at all on the other.
  let bodyMismatch = false;
  let scene: number | null = null;
  let measuredHeight: number | null = null;
  let scale: number | null = shotScale === "close" ? 0.9 : shotScale === "medium" ? 0.6 : shotScale === "wide" ? 0.3 : null;
  if (deep) {
    const aspect = source.asset.width / Math.max(1, source.asset.height);
    const sig = source.visual?.length ? actionSignature(source.visual, source.people, inMs, outMs, aspect) : undefined;
    if (req.shot.action && sig) action = actionSimilarity(req.shot.action, sig);
    const shape = source.people?.length ? shapeOver(source.people, inMs, outMs, aspect) : undefined;
    if (shape) {
      scale = shape.height;
      measuredHeight = shape.height;
    }
    // What the picture shows, which decides shots that barely move.
    if (req.shot.scene && source.visual?.length) {
      const detections = frames.flatMap((f) => f.detections ?? []);
      const cs = sceneSignature(source.visual, inMs, outMs, sig, shape?.height ?? frames.find((f) => f.subject)?.subject?.bounds.height ?? null, detections);
      if (cs) scene = sceneSimilarity(req.shot.scene, cs).overall;
    }
    const still = req.shot.subjectShape && shape ? shapeFit(req.shot.subjectShape, shape) : null;
    // Pose trajectory: the outline's sequence across the shot, aligned by time warping.
    const path = req.shot.subjectPath && source.people?.length ? pathFit(req.shot.subjectPath.map((p) => p ?? undefined), shapePath(source.people, inMs, outMs, aspect)) : undefined;
    pose = still !== null && path !== undefined ? (still + path) / 2 : (still ?? path ?? null);
    // Joint angles over time say what the body does, whatever the framing or the room: where both
    // the reference shot and this window measured a body, they replace the silhouette.
    if (req.shot.body && source.pose?.length) {
      const window = bodySignature(source.pose, inMs, outMs);
      const fit = bodyFit(req.shot.body, window);
      if (fit !== undefined) {
        pose = fit;
        jointPose = true;
      }
      else {
        // A body on one side and measured nobody on the other.
        const there = bodyPresence(window),
          wanted = bodyPresence(req.shot.body);
        if ((wanted === "present" && there === "absent") || (wanted === "absent" && there === "present")) {
          bodyMismatch = true;
          if (pose === null) pose = PRESENCE_MISMATCH;
        }
      }
    }
    // Whether anyone is there is evidence too: a shot of a person played by footage measured with
    // nobody in it, or a shot measured with nobody played by a person, does not do what the shot
    // does. With nobody on either side there is no pose to compare (left unscored).
    if (pose === null) {
      // Segmented here (raw samples in the window) with no confirmed outline: nobody there.
      const sampled = (source.outlines ?? source.people ?? []).filter((s) => s.timeMs >= inMs && s.timeMs < outMs).length >= 2;
      if ((req.shot.subjectShape && sampled && !shape) || (req.shot.subjectAbsent && shape)) pose = PRESENCE_MISMATCH;
    }
  }

  // Low detail is a defect only where the reference has detail: a smooth sky, wall or plate is
  // the content when the reference shot is itself far smoother than the rest of its video, or
  // about as detailed as this window.
  let quality = c.quality;
  const refScene = req.shot.scene;
  if (c.qualityIssues.includes("blur") && refScene) {
    const own = (source.visual ?? []).filter((f) => f.timeMs >= inMs && f.timeMs < outMs);
    const sharp = own.length ? own.reduce((s, f) => s + f.sharpness, 0) / own.length : 0;
    if ((refScene.relativeDetail !== undefined && refScene.relativeDetail <= 0.6) || (refScene.sharpness !== undefined && own.length && sharp >= 0.7 * refScene.sharpness)) quality = Math.max(quality, 0.85);
  }
  // Framing: the subject's measured size on both sides when person outlines exist (continuous and
  // dense); otherwise the share of the window's vision frames whose framing class matches (a single
  // frame's class flips as a body bends).
  const scaled = (frames.length ? frames : []).filter((f) => f.shotScale);
  let framing = req.shot.framing && scaled.length ? 0.35 + 0.65 * (scaled.filter((f) => f.shotScale === req.shot.framing).length / scaled.length) : req.shot.framing && shotScale ? (req.shot.framing === shotScale ? 1 : 0.35) : 0.5;
  if (deep && req.shot.subjectShape && measuredHeight !== null) framing = Math.exp(-Math.abs(Math.log(req.shot.subjectShape.height / Math.max(0.01, measuredHeight))) / 0.35);
  const match: Record<string, number> = {
    action: action?.overall ?? 0.5,
    look: look === null ? 0.5 : (look + 1) / 2,
    pose: pose ?? 0.5,
    framing,
    motion: motionFit,
    // How close the source's movement peak lands to the shot's moment (a third of the shot off
    // still earns a third); semantic fit matters more than a few frames of phase.
    peak: req.peakSource === "none" ? 0.5 : Math.exp(-Math.abs(achieved - req.peakFraction) / 0.3) * (c.kind === "action" ? 1 : 0.6),
    composition: layout ?? 0.5,
    tone: req.shot.luma !== null && c.luma !== null && !dense ? Math.exp(-Math.abs(req.shot.luma - c.luma) / 0.15) : color && req.shot.color ? Math.exp(-Math.abs(req.shot.color.luma - color.luma) / 0.15) : 0.5,
    quality,
    scene: scene ?? 0.5,
    cast: cast ?? 0.5,
  };
  const emphasis: Record<string, number> = { ...((req.role && roleEmphasis[req.role]) ?? {}) };
  // The weaker the reference shot's movement, the more what the picture shows has to decide.
  const stillness = 1 - Math.min(1, (refLevel ?? 0.004) / 0.004);
  emphasis.scene = (emphasis.scene ?? 1) * (0.3 + 0.9 * stillness) * (scene === null ? 0 : 1);
  // Joint angles say what the body does far more reliably than a silhouette: in the modes that
  // follow the reference's action, they count double. Creative Remix keeps its own balance of
  // movement and pose (doubling it there lost a multi-clip shot, 8/9 → 7/9).
  if (jointPose && mode !== "Creative Remix") emphasis.pose = (emphasis.pose ?? 1) * 2;
  // A peak anchored by an audio event is part of the editing language; the reference's own
  // movement peak is weaker evidence of what must line up.
  const anchor: Record<string, number> = { peak: req.peakSource === "audio event" ? 1 : 0.6 };
  const w = Object.fromEntries(Object.entries(weights[mode]).map(([k, v]) => [k, v * (emphasis[k] ?? 1) * (anchor[k] ?? 1)]));
  const total = Object.entries(match).reduce((s, [k, v]) => s + (w[k] ?? 0) * v, 0) / Object.values(w).reduce((a, b) => a + b, 0);
  // Static footage cannot play an action shot: when the reference shot moves, the whole score is
  // scaled by how well the candidate moves. A held still frame plays only a held shot. Mostly
  // unusable footage is rejected outright; retiming costs a little.
  const moving = dense ? refLevel! >= 0.0015 : (req.shot.motion ?? 0) >= 0.01;
  // The gate only keeps static footage out: a candidate moving at least half as much as the
  // reference passes ungated (how closely the level matches is the motion term's job).
  const under = dense
    ? Math.min(1, (0.0015 + c.motion) / (0.0015 + refLevel!))
    : req.shot.motion !== null
      ? Math.min(1, (0.008 + c.motion) / (0.008 + req.shot.motion))
      : 1;
  let score = moving ? total * (0.4 + 0.6 * Math.min(1, under / 0.5)) : total;
  // A shot of a person is not played by footage with nobody in it (waves outmove a lifter between
  // repetitions), nor a shot of nobody by a person: whichever terms agree, this costs a tenth (a
  // fifth reordered a beach plan offline; a tenth kept it and still gave the gym shot a gym clip).
  if (bodyMismatch) score *= BODY_MISMATCH_FACTOR;
  // Another kind of subject than the reference shot shows (castSimilarity's kind and presence agreement).
  if (castFit) score *= 1 - CAST_MISMATCH * (1 - castFit.kind);
  // A dissolve needs footage before the in-point; a window without it plays the blend as a cut.
  if (req.leadInMs && inMs - lo < req.leadInMs * 0.5) score *= 0.97;
  if (c.frozen) score *= moving ? 0.3 : (req.shot.camera?.freeze ?? 0) >= 0.5 ? 1 : 0.6;
  if (quality < 0.35) score *= 0.3;
  score *= 1 - 0.6 * (1 - speed);
  // Clean imagery is preferred over persistent unrelated text burned into the footage; text that
  // shows the reference's own words is wanted, and unmeasured windows are not judged.
  const sourceText = classifySourceText(source.text, inMs, outMs, req.texts ?? []);
  if (sourceText.unrelated.length) {
    const penalty = unrelatedTextPenalty(sourceText.unrelated, req.texts ?? []);
    score = Math.max(0, score - penalty);
    match.sourceText = Number((1 - penalty / 0.08).toFixed(2));
  }
  // Your own take choices for this reel: a moment you chose for this shot before leads, and one
  // you replaced falls back (corrections.ts).
  const taken = takeChoiceShift(source.takes, req.shot.startMs, req.shot.endMs, inMs, outMs);
  if (taken) {
    score = Math.max(0, score + taken);
    match.yourChoice = taken > 0 ? 1 : 0;
  }
  for (const k of Object.keys(match)) match[k] = Number(match[k].toFixed(2));
  // Display-only detail (no weight): the parts of the movement match and the duration fit.
  if (action) {
    match.trajectory = action.trajectory;
    match.regions = action.regions;
    match.camera = action.camera;
    if (action.subject !== null) match.subject = action.subject;
    if (action.direction !== null) match.direction = action.direction;
    if (action.envelope !== null) match.envelope = action.envelope;
  }
  match.duration = speed;
  if (scene === null) delete match.scene;
  if (cast === null) delete match.cast;
  return { inMs: Math.round(inMs), outMs: Math.round(outMs), peakMs: c.peakMs, speed, score: Number(score.toFixed(4)), match, action, pose, scale };
}

/** Timings of the matching stages (ms), for the analysis profile. */
export interface SelectionProfile {
  stageA: number;
  stageB: number;
  beam: number;
  rerankedPerShot: number;
}

/** What the global plan found, for the preview and diagnostics. */
export interface PlanReport {
  resources: SourceResource[];
  groups: RepeatGroup[];
  nearTies: { shot: number; margin: number; changed: boolean }[];
  coverage: Record<Coverage, number>;
}

/** Choose a source moment for every reference shot, globally: retrieval (stage A, stage B), phase
 * windows on the best stretches, near-tie review, then one plan for the whole sequence that
 * knows which footage is scarce and which reference shots repeat an action. */
export function selectShots(
  index: FootageIndex,
  sources: SourceEvidence[],
  reqs: ShotRequirement[],
  mode: RecreationMode,
  beamWidth = 40,
  perShot = 16,
  profile?: SelectionProfile,
  /** Review hook: every shot's reranked candidates, best first. */
  inspect?: (shot: number, ranked: (Scored & { c: FootageCandidate })[]) => void,
  report?: (plan: PlanReport) => void,
): ShotChoice[] {
  const byId = new Map(sources.map((s) => [s.asset.id, s]));
  const roles = reqs.map((r, i) => r.role ?? shotRole(r.shot, i, reqs.length, r.peakSource, reqs[i + 1]?.shot));
  const withRoles = reqs.map((r, i) => ({ ...r, role: roles[i] }));
  // Reference shots that repeat the very same footage: same look AND same movement (two moments
  // of one take look alike but move differently).
  const repeats = reqs.map((r, i) =>
    reqs.findIndex(
      (o, j) =>
        j < i &&
        !!r.shot.embedding &&
        !!o.shot.embedding &&
        (embeddingSimilarity(r.shot.embedding, o.shot.embedding) ?? 0) > 0.97 &&
        (!r.shot.action || !o.shot.action || actionSimilarity(r.shot.action, o.shot.action).overall >= 0.9),
    ),
  );
  const dedupe = (list: Option[]) => list.filter((x, i, all) => all.findIndex((y) => y.c.sourceId === x.c.sourceId && Math.abs(y.inMs - x.inMs) < 120 && Math.abs(y.outMs - x.outMs) < 120) === i);
  let t = performance.now();
  // Stage A: cheap terms over every candidate; keep the best 50 per shot.
  const shortlist = withRoles.map((req) =>
    dedupe(
      index.candidates
        .map((c) => {
          const s = scoreCandidate(req, c, byId.get(c.sourceId)!, mode, false);
          return s && { c, ...s };
        })
        .filter((x): x is Option => !!x)
        .sort((a, b) => b.score - a.score),
    ).slice(0, 50),
  );
  if (profile) profile.stageA = Math.round(performance.now() - t);
  t = performance.now();
  // Stage B: movement geometry, pose and scene on the shortlist.
  const reranked: Option[][] = withRoles.map((req, i) =>
    shortlist[i]
      .map((x) => {
        const s = scoreCandidate(req, x.c, byId.get(x.c.sourceId)!, mode, true);
        return s && { c: x.c, ...s };
      })
      .filter((x): x is Option => !!x)
      .sort((a, b) => b.score - a.score),
  );
  // Action-phase windows on each shot's two best stretches: sub-intervals that start or end on a
  // rest point and hold a movement peak, so one long repetition can serve several shots.
  reranked.forEach((list, i) => {
    const stretches = [...new Map(list.map((o) => [stretchOf(o), o] as const)).values()].slice(0, 2);
    for (const o of stretches) {
      const source = byId.get(o.c.sourceId)!;
      for (const w of phaseWindows(source, o.c, withRoles[i].durationMs)) {
        const c = { ...o.c, peakMs: w.peakMs, kind: "action" as const };
        const s = scoreCandidate(withRoles[i], c, source, mode, true, w);
        if (s) list.push({ c, ...s, phase: w.label });
      }
    }
    const sorted = dedupe(list.sort((a, b) => b.score - a.score));
    list.splice(0, list.length, ...sorted);
  });
  // Near ties between stretches are decided by a deeper temporal review, not rounding noise.
  const nearTies = breakNearTies(withRoles, reranked, byId);
  if (profile) {
    profile.stageB = Math.round(performance.now() - t);
    profile.rerankedPerShot = Math.round(mean(shortlist.map((s) => s.length)));
  }
  // Same footage: a shot whose own frames were found in a clip is cut from that exact moment. Its
  // option is locked for the sequence plan (other shots plan around it); the ranked list stays
  // for the alternatives a reviewer can choose.
  const locked = withRoles.map((req) => {
    const id = req.identity;
    const source = id && byId.get(id.sourceId);
    if (!id || !source) return undefined;
    const want = { inMs: id.inMs, outMs: id.inMs + req.durationMs };
    // The cut-safe stretch holding the moment: the one the window lies in, else the one holding the
    // middle probe's match, with the window moved inside it. Footage that looks and moves like the
    // reference's (another repetition of the same take) passes the identity test too, so a match
    // decides which stretch and where — a detected cut is crossed only when the reference itself
    // shows continuous footage through it: probes on both sides match frames that move the way the
    // reference moves (a real edit into a held or different picture fails that).
    const whole = (h: { overlap: number } | undefined) => !!h && h.overlap >= req.durationMs - 1;
    const proven = (t: number) =>
      id.points.some((p) => p.sourceMs < t && p.score >= 0.9 && (p.motion ?? 0) >= IDENTITY_MIN_MOTION) &&
      id.points.some((p) => p.sourceMs > t && p.score >= 0.9 && (p.motion ?? 0) >= IDENTITY_MIN_MOTION);
    const cutsIn = (w: { inMs: number; outMs: number }) => index.cuts.filter((c) => c.sourceId === id.sourceId && c.timeMs > w.inMs && c.timeMs < w.outMs);
    // A cut beyond the outermost probes, near a window edge, cannot be vouched for: the window moves
    // off it (by at most 15% of the shot) rather than across it.
    const first = Math.min(...id.points.map((p) => p.sourceMs)),
      last = Math.max(...id.points.map((p) => p.sourceMs));
    for (const c of cutsIn(want)) {
      if (c.timeMs < first && c.timeMs - want.inMs <= 0.15 * req.durationMs) Object.assign(want, { inMs: c.timeMs + 70, outMs: c.timeMs + 70 + req.durationMs });
      else if (c.timeMs > last && want.outMs - c.timeMs <= 0.15 * req.durationMs) Object.assign(want, { inMs: c.timeMs - 70 - req.durationMs, outMs: c.timeMs - 70 });
    }
    const holder = index.candidates
      .filter((c) => c.sourceId === id.sourceId)
      .map((c) => ({ c, overlap: Math.min(c.sceneEndMs, want.outMs) - Math.max(c.sceneStartMs, want.inMs) }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    const inside = cutsIn(want);
    const continuous = !whole(holder) && inside.every((c) => proven(c.timeMs));
    const home = index.candidates
      .filter((c) => c.sourceId === id.sourceId && c.sceneStartMs <= id.anchorMs && id.anchorMs <= c.sceneEndMs && c.sceneEndMs - c.sceneStartMs >= 0.85 * req.durationMs)
      .sort((a, b) => Math.abs(a.peakMs - id.anchorMs) - Math.abs(b.peakMs - id.anchorMs))[0];
    const base: FootageCandidate | undefined = whole(holder)
      ? holder!.c
      : continuous
        ? { ...(holder?.c ?? home ?? { kind: "action" as const, motion: 0, quality: 0.8, qualityIssues: [], luma: null, frozen: false, peakMs: (want.inMs + want.outMs) / 2 }), sourceId: id.sourceId, startMs: want.inMs, endMs: want.outMs, sceneStartMs: want.inMs, sceneEndMs: want.outMs }
        : home;
    if (!base) return undefined;
    const lo = base.sceneStartMs,
      hi = base.sceneEndMs;
    const inMs = Math.max(lo, Math.min(hi - Math.min(req.durationMs, hi - lo), want.inMs));
    const w = { inMs, outMs: Math.min(hi, inMs + req.durationMs) };
    const c = { ...base, peakMs: Math.min(w.outMs, Math.max(w.inMs, base.peakMs)) };
    const s = scoreCandidate(req, c, source, mode, true, w);
    return s ? ({ c, ...s, identity: id } as Option) : undefined;
  });
  locked.forEach((o, i) => {
    if (!o) return;
    reranked[i] = [o, ...reranked[i].filter((x) => !(x.c.sourceId === o.c.sourceId && Math.abs(x.inMs - o.inMs) < 120))];
    // The reference itself shows the same footage twice: the plan may too.
    for (let j = 0; j < i; j++) {
      const q = locked[j];
      if (q && q.c.sourceId === o.c.sourceId && q.inMs < o.outMs && o.inMs < q.outMs) repeats[i] = j;
    }
  });
  reranked.forEach((list, i) => inspect?.(i, list));
  t = performance.now();
  const resources = sourceResources(reranked, withRoles);
  const groups = repeatGroups(withRoles, reranked);
  const scarce = new Set(resources.filter((r) => r.scarcity >= 0.6).flatMap((r) => r.usableIntervals.map((u) => `${u.sourceId}:${u.startMs}`)));
  const plan = planSequence(withRoles, reranked.map((list, i) => (locked[i] ? [locked[i]!] : list)), groups, repeats, beamWidth, perShot, scarce);
  if (profile) profile.beam = Math.round(performance.now() - t);
  const picks = plan.picks;
  const strong = strongStretches(reranked);
  for (const g of groups) {
    const chosen = g.shots.map((i) => picks[i]).filter(Boolean);
    const stretches = new Set(chosen.map(stretchOf));
    g.outcome = g.shots.some((i) => plan.reuse[i])
      ? "reused one interval"
      : g.shots.some((i) => picks[i] && strong[i].size > 0 && !strong[i].has(stretchOf(picks[i])))
        ? "substituted another action"
        : stretches.size < chosen.length
          ? "shared one stretch"
          : "separate repetitions";
  }
  const used = (i: number) => picks.filter((_, j) => j !== i);
  const choices = picks.map((first, i) => {
    let p = first;
    const req = withRoles[i];
    let cal = calibrate(p, reranked[i]);
    // The shot's own frames found in this clip: direct evidence, not a likeness.
    if (p.identity) cal = { ...cal, certainty: Number(Math.min(0.99, 0.75 + 1.5 * Math.max(0, p.identity.score - IDENTITY_MIN_SCORE)).toFixed(2)), coverage: "excellent" };
    let adapted: string | null = null;
    // No equivalent moment in the footage: Close Match keeps it (timing kept, mismatch flagged);
    // Smart Adaptation picks the footage that best plays the shot's visual role; Creative Remix
    // reinterprets it with whatever moves like it.
    if (cal.coverage === "missing" && mode !== "Close Match") {
      const free = reranked[i].filter((o) => !used(i).some((q) => q.c.sourceId === o.c.sourceId && q.inMs < o.outMs && o.inMs < q.outMs));
      const by = (o: Option) =>
        mode === "Smart Adaptation" ? mean([o.match.scene ?? 0.5, o.match.framing, o.match.composition, o.match.look]) : mean([o.match.motion, o.match.quality, o.match.trajectory ?? 0.5]);
      const best = [...free].sort((a, b) => by(b) - by(a))[0];
      if (best && best !== p) {
        p = best;
        picks[i] = best;
        cal = calibrate(p, reranked[i]);
        adapted = mode === "Smart Adaptation" ? "adapted to the source moment that best plays the shot's visual role" : "reinterpreted with source footage that moves like it";
      }
    }
    // Distinct alternatives: another clip first, then another stretch, never a near-duplicate. A
    // moment another shot already plays ranks 0.03 lower, so a comparably good unused moment is
    // offered first (deliberate reuse stays available, and is named in the editor).
    const others = picks.flatMap((q, j) => (j !== i && q ? [{ clipId: String(j), sourceId: q.c.sourceId, inMs: q.inMs, outMs: q.outMs }] : []));
    const reused = (x: Option) => reuseOf({ sourceId: x.c.sourceId, inMs: x.inMs, outMs: x.outMs }, others).length > 0;
    const pool = [...reranked[i]].sort((a, b) => b.score - (reused(b) ? 0.03 : 0) - (a.score - (reused(a) ? 0.03 : 0)));
    const alternatives: Option[] = [];
    for (const x of pool) {
      if (alternatives.length >= 3) break;
      const near = (y: Option) => y.c.sourceId === x.c.sourceId && (y.c.sceneStartMs === x.c.sceneStartMs || Math.abs(y.inMs - x.inMs) < 2500);
      if (near(p) || alternatives.some(near)) continue;
      alternatives.push(x);
    }
    const w = weights[mode];
    const lostOn = (x: Option) => {
      const deficits = Object.keys(w)
        .map((k) => ({ k, d: (w[k] ?? 0) * ((p.match[k] ?? 0.5) - (x.match[k] ?? 0.5)) }))
        .filter((e) => e.d > 0.02)
        .sort((a, b) => b.d - a.d)
        .slice(0, 2);
      const parts = deficits.map((e) => `${termLabels[e.k] ?? e.k} (${(x.match[e.k] ?? 0.5).toFixed(2)} vs ${(p.match[e.k] ?? 0.5).toFixed(2)})`);
      if (x.speed < 1) parts.push(`needs ${Math.round((1 - x.speed) * 100)}% slow-down`);
      const gap = p.score - x.score;
      return (parts.length ? "trails on " + parts.join(", ") : "close second overall") + (gap < 0.02 ? ` · differs by only ${gap.toFixed(3)}` : "");
    };
    const why: string[] = [];
    if (p.identity)
      why.push(
        `the same footage as the reference: its frames match here at ${p.identity.score.toFixed(2)} (other clips ${(p.identity.score - p.identity.margin).toFixed(2)})` +
          (p.identity.timingMargin < 0.01 ? "; the picture barely changes or repeats here, so the exact moment within the clip is approximate" : "") +
          (p.identity.speed !== null && Math.abs(p.identity.speed - 1) >= 0.05 ? `; the reference plays it at ${Math.round(p.identity.speed * 100)}% speed` : ""),
      );
    const strongest = Object.keys(w)
      .filter((k) => (p.match[k] ?? 0) >= 0.7)
      .sort((a, b) => (w[b] ?? 0) * (p.match[b] ?? 0) - (w[a] ?? 0) * (p.match[a] ?? 0))
      .slice(0, 3);
    if (strongest.length) why.push("strongest on " + strongest.map((k) => termLabels[k] ?? k).join(", "));
    if (p.action) why.push(`moves like the reference: trajectory ${p.action.trajectory.toFixed(2)}, regions ${p.action.regions.toFixed(2)}${p.action.subject !== null ? `, subject ${p.action.subject.toFixed(2)}` : ""}`);
    if (p.phase) why.push(`cut on movement-phase boundaries (${p.phase}) so one repetition serves several shots`);
    why.push(p.speed < 1 ? `cut-safe stretch is ${Math.round((1 - p.speed) * 100)}% short: mildly slowed to fill the shot` : "fits inside one cut-safe stretch");
    if (req.peakSource !== "none") why.push(`${req.peakSource === "audio event" ? "audio event" : "the reference's movement peak"} lands on the source's movement peak`);
    const tie = nearTies.find((x) => x.shot === i);
    if (tie) why.push(`near tie (${tie.margin.toFixed(3)}) decided by a deeper temporal review of pose, orientation and movement${tie.changed ? ", which changed the pick" : ""}`);
    if (cal.nearest && cal.margin < 0) why.push(`a stretch scoring ${(-cal.margin).toFixed(3)} higher went to another shot that needed it more`);
    else if (cal.nearest && cal.margin < 0.02) why.push(`the next stretch differs by only ${cal.margin.toFixed(3)}`);
    if (adapted) why.push(adapted);
    const reuse = plan.reuse[i];
    const confidence: ShotChoice["confidence"] = cal.certainty >= 0.7 ? "high" : cal.certainty >= 0.45 ? "medium" : "low";
    // A close match is a moment the evidence says plays this shot; otherwise the pick is the best
    // available candidate and says so, so a reviewer knows where to look.
    const label: ShotChoice["label"] = cal.coverage !== "missing" && cal.coverage !== "weak" && confidence !== "low" && cal.certainty >= CLOSE_MATCH_CERTAINTY ? "close match" : "best available";
    let shortfall: string | null = null;
    if (cal.coverage === "missing")
      shortfall =
        "No close source match found." +
        (mode === "Close Match" ? " Reference timing is kept and the mismatch is flagged; review the alternatives." : ` ${adapted ? adapted[0].toUpperCase() + adapted.slice(1) : "Best available adaptation used"}.`);
    else if (label === "best available" && confidence !== "low")
      shortfall = `No close source match found: best available candidate (${cal.coverage} source coverage, ${Math.round(cal.certainty * 100)}% confidence); review the alternatives.`;
    else if (confidence === "low") shortfall = `No close source match found: best available candidate. Low confidence (${Math.round(cal.certainty * 100)}%): ${cal.margin < 0 ? "a better-scoring stretch went to another shot" : cal.margin < 0.02 ? `the next stretch differs by only ${cal.margin.toFixed(3)}` : "weak agreement on what the shot does"}; review the alternatives.`;
    return {
      sourceId: p.c.sourceId,
      inMs: p.inMs,
      outMs: p.outMs,
      peakMs: p.peakMs,
      speed: p.speed,
      score: p.score,
      match: p.match,
      role: roles[i],
      why,
      confidence,
      label,
      ...(p.identity ? { identity: p.identity } : {}),
      certainty: cal.certainty,
      margin: cal.margin,
      rival: cal.rival,
      semantic: cal.semantic,
      coverage: cal.coverage,
      ...(p.phase ? { phase: p.phase } : {}),
      alternatives: alternatives.map((x) => ({ sourceId: x.c.sourceId, inMs: x.inMs, outMs: x.outMs, speed: x.speed, score: x.score, match: x.match, lostOn: lostOn(x) })),
      reuse: reuse ? { intentional: true, permitted: true, reason: reuse.reason, confidence: reuse.confidence } : null,
      shortfall,
    };
  });
  const coverage: Record<Coverage, number> = { excellent: 0, good: 0, weak: 0, missing: 0 };
  for (const c of choices) coverage[c.coverage]++;
  report?.({ resources, groups, nearTies, coverage });
  return choices;
}

/** Shots no usable cut-safe stretch can fill (even with a mild retime), and the longest stretch. */
export function infeasibleShots(index: FootageIndex, reqs: ShotRequirement[]) {
  const longest = Math.max(0, ...index.segments.filter((s) => !s.frozen).map((s) => s.endMs - s.startMs));
  return reqs
    .map((r, i) => ({ shot: i, needMs: Math.round(r.durationMs), longestMs: Math.round(longest) }))
    .filter((x) => x.longestMs < x.needMs * 0.85);
}

/** The reference shot's action phase: its own movement peak when no audio event anchors it. */
export function motionPeak(shot: Shot): Pick<ShotRequirement, "peakFraction" | "peakSource"> | undefined {
  const a: ActionSignature | undefined = shot.action;
  return a && a.peakedness >= 1.5 && a.level >= 0.0015 ? { peakFraction: Math.max(0.1, Math.min(0.9, a.peak)), peakSource: "reference motion" } : undefined;
}
