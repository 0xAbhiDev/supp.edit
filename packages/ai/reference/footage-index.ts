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
import type { SourceEvidence } from "./planner";
import { cutSafeSegments, frameCuts } from "./cuts";
import { actionSignature, actionSimilarity, smoothedChange, type ActionSignature } from "./action-signature";

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
export const INDEX_VERSION = "cut-safe-segments-1";
export interface SourceIndex extends FootageIndex {
  version: string;
}
export function sourceIndexKey(source: SourceEvidence) {
  const model = source.analysis.vision?.modelVersion ?? "no-vision";
  return `footage-index-${INDEX_VERSION}:${model}:${source.people?.length ? "people" : "no-people"}:${source.visual?.length ? "dense" : "sparse"}:${source.asset.fingerprint}`;
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
      const cuts = frameCuts(visual, source.people ?? []);
      for (const c of cuts) allCuts.push({ sourceId: id, timeMs: c.timeMs, evidence: c.evidence });
      segments = cutSafeSegments(scenes, cuts, 67, 400);
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
}

/** What a reference shot does in the edit, from its measured look and movement. */
export function shotRole(shot: Shot, index: number, count: number, peakSource: ShotRequirement["peakSource"], next?: Shot): ShotRole {
  const a = shot.action,
    length = shot.endMs - shot.startMs;
  const level = a?.level ?? (shot.motion ?? 0) / 4;
  const camera = a ? Math.abs(a.camera.panX) + Math.abs(a.camera.panY) + Math.abs(a.camera.zoom) : (shot.camera?.drift ?? 0) / 2;
  const height = shot.subjectShape?.height ?? null;
  if (length < 450 && level > 0.01) return "transition";
  if (level < 0.0015 || (shot.camera?.freeze ?? 0) > 0.5) return "rest/hold";
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
  alternatives: { sourceId: string; inMs: number; outMs: number; speed: number; score: number; match: Record<string, number>; lostOn: string }[];
  reuse: { intentional: boolean; reason: string } | null;
  /** The shot could not be filled faithfully: what was tried and why it fell short. */
  shortfall: string | null;
}

/** Close Match follows the stated priority: action (pose and movement geometry), framing,
 * movement level, peak alignment, composition, tone, quality; look (a frame embedding) counts
 * less, since similar rooms look alike whatever happens in them. Remix leans on movement. */
const weights: Record<RecreationMode, Record<string, number>> = {
  "Close Match": { action: 1.0, pose: 1.2, look: 0.6, framing: 0.5, motion: 0.3, peak: 0.5, composition: 0.3, tone: 0.2, quality: 0.6 },
  "Smart Adaptation": { action: 0.9, pose: 0.8, look: 0.6, framing: 0.5, motion: 0.6, peak: 0.5, composition: 0.35, tone: 0.25, quality: 0.6 },
  "Creative Remix": { action: 0.8, pose: 0.2, look: 0.3, framing: 0.2, motion: 1.0, peak: 0.5, composition: 0.15, tone: 0.15, quality: 0.6 },
};
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
};

/** Score one candidate for one reference shot, trimmed so its peak lands on the shot's peak.
 * deep: measure movement geometry and pose (stage B); otherwise the cheap terms only. */
export function scoreCandidate(req: ShotRequirement, c: FootageCandidate, source: SourceEvidence, mode: RecreationMode, deep = true): Scored | undefined {
  const len = req.durationMs;
  const lo = c.sceneStartMs,
    hi = c.sceneEndMs;
  const usable = hi - lo;
  // Duration feasibility before anything else: never borrow frames across a cut.
  if (usable < len * 0.85) return undefined;
  const speed = usable >= len ? 1 : Number((usable / len).toFixed(3));
  const sourceLen = Math.min(usable, len * speed);
  let inMs = c.peakMs - req.peakFraction * sourceLen;
  inMs = Math.max(lo, Math.min(hi - sourceLen, inMs));
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
  // Movement level on the same scale on both sides: dense per-frame change when both measured it.
  const refLevel = req.shot.action?.level,
    dense = refLevel !== undefined && (source.visual?.length ?? 0) >= 8;
  const motionFit = dense
    ? Math.exp(-Math.abs(Math.log((0.0015 + c.motion) / (0.0015 + refLevel!))))
    : req.shot.motion !== null
      ? Math.exp(-Math.abs(Math.log((0.008 + c.motion) / (0.008 + req.shot.motion))))
      : 0.5;
  let action: ReturnType<typeof actionSimilarity> | undefined;
  let pose: number | null = null;
  if (deep) {
    const aspect = source.asset.width / Math.max(1, source.asset.height);
    if (req.shot.action && source.visual?.length) {
      const sig = actionSignature(source.visual, source.people, inMs, outMs, aspect);
      if (sig) action = actionSimilarity(req.shot.action, sig);
    }
    const shape = req.shot.subjectShape && source.people?.length ? shapeOver(source.people, inMs, outMs, aspect) : undefined;
    const still = req.shot.subjectShape && shape ? shapeFit(req.shot.subjectShape, shape) : null;
    // Pose trajectory: the outline's sequence across the shot, aligned by time warping.
    const path = req.shot.subjectPath && source.people?.length ? pathFit(req.shot.subjectPath.map((p) => p ?? undefined), shapePath(source.people, inMs, outMs, aspect)) : undefined;
    pose = still !== null && path !== undefined ? (still + path) / 2 : (still ?? path ?? null);
  }
  const match: Record<string, number> = {
    action: action?.overall ?? 0.5,
    look: look === null ? 0.5 : (look + 1) / 2,
    pose: pose ?? 0.5,
    framing: req.shot.framing && shotScale ? (req.shot.framing === shotScale ? 1 : 0.35) : 0.5,
    motion: motionFit,
    // How close the source's movement peak lands to the shot's moment (a third of the shot off
    // still earns a third); semantic fit matters more than a few frames of phase.
    peak: req.peakSource === "none" ? 0.5 : Math.exp(-Math.abs(achieved - req.peakFraction) / 0.3) * (c.kind === "action" ? 1 : 0.6),
    composition: layout ?? 0.5,
    tone: req.shot.luma !== null && c.luma !== null && !dense ? Math.exp(-Math.abs(req.shot.luma - c.luma) / 0.15) : color && req.shot.color ? Math.exp(-Math.abs(req.shot.color.luma - color.luma) / 0.15) : 0.5,
    quality: c.quality,
  };
  const emphasis = (req.role && roleEmphasis[req.role]) ?? {};
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
  if (c.frozen) score *= moving ? 0.3 : (req.shot.camera?.freeze ?? 0) >= 0.5 ? 1 : 0.6;
  if (c.quality < 0.35) score *= 0.3;
  score *= 1 - 0.6 * (1 - speed);
  for (const k of Object.keys(match)) match[k] = Number(match[k].toFixed(2));
  // Display-only detail (no weight): the parts of the movement match and the duration fit.
  if (action) {
    match.trajectory = action.trajectory;
    match.regions = action.regions;
    match.camera = action.camera;
    if (action.subject !== null) match.subject = action.subject;
  }
  match.duration = speed;
  return { inMs: Math.round(inMs), outMs: Math.round(outMs), peakMs: c.peakMs, speed, score: Number(score.toFixed(4)), match, action };
}

/** Timings of the matching stages (ms), for the analysis profile. */
export interface SelectionProfile {
  stageA: number;
  stageB: number;
  beam: number;
  rerankedPerShot: number;
}

/** Choose a source moment for every reference shot, globally. */
export function selectShots(
  index: FootageIndex,
  sources: SourceEvidence[],
  reqs: ShotRequirement[],
  mode: RecreationMode,
  beamWidth = 40,
  perShot = 12,
  profile?: SelectionProfile,
  /** Review hook: every shot's reranked candidates, best first. */
  inspect?: (shot: number, ranked: (Scored & { c: FootageCandidate })[]) => void,
): ShotChoice[] {
  const byId = new Map(sources.map((s) => [s.asset.id, s]));
  const roles = reqs.map((r, i) => r.role ?? shotRole(r.shot, i, reqs.length, r.peakSource, reqs[i + 1]?.shot));
  const withRoles = reqs.map((r, i) => ({ ...r, role: roles[i] }));
  // Reference shots that repeat footage may repeat source footage too. A repeat looks the same
  // AND moves the same: two moments of one take look alike but move differently.
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
  type Ranked = Scored & { c: FootageCandidate };
  const dedupe = (list: Ranked[]) => list.filter((x, i, all) => all.findIndex((y) => y.c.sourceId === x.c.sourceId && Math.abs(y.inMs - x.inMs) < 250) === i);
  let t = performance.now();
  // Stage A: cheap terms over every candidate; keep the best 50 per shot.
  const shortlist = withRoles.map((req) =>
    dedupe(
      index.candidates
        .map((c) => {
          const s = scoreCandidate(req, c, byId.get(c.sourceId)!, mode, false);
          return s && { c, ...s };
        })
        .filter((x): x is Ranked => !!x)
        .sort((a, b) => b.score - a.score),
    ).slice(0, 50),
  );
  if (profile) profile.stageA = Math.round(performance.now() - t);
  t = performance.now();
  // Stage B: movement geometry and pose on the shortlist.
  const reranked = withRoles.map((req, i) =>
    shortlist[i]
      .map((x) => {
        const s = scoreCandidate(req, x.c, byId.get(x.c.sourceId)!, mode, true);
        return s && { c: x.c, ...s };
      })
      .filter((x): x is Ranked => !!x)
      .sort((a, b) => b.score - a.score),
  );
  if (profile) {
    profile.stageB = Math.round(performance.now() - t);
    profile.rerankedPerShot = Math.round(mean(shortlist.map((s) => s.length)));
  }
  t = performance.now();
  reranked.forEach((list, i) => inspect?.(i, list));
  const ranked = reranked.map((list) => list.slice(0, perShot));
  type Beam = { total: number; picks: Ranked[] };
  let beams: Beam[] = [{ total: 0, picks: [] }];
  reqs.forEach((_, i) => {
    const next: Beam[] = [];
    for (const beam of beams)
      for (const option of ranked[i]) {
        let bonus = 0;
        const overlaps = beam.picks.some((p, j) => p.c.sourceId === option.c.sourceId && p.inMs < option.outMs && option.inMs < p.outMs && repeats[i] !== j);
        if (overlaps) continue;
        const prev = beam.picks.at(-1);
        if (prev && prev.c.sourceId === option.c.sourceId) {
          // Near-identical neighbours look like a stutter; moving forward keeps progression, but
          // only as a tie-breaker: it never outweighs a real difference in how well shots match.
          if (Math.abs(prev.inMs - option.inMs) < 3000) bonus -= 0.25;
          bonus += option.inMs > prev.inMs ? 0.01 : -0.015;
        }
        // Diversity: a little credit for footage the edit has not used yet.
        if (!beam.picks.some((p) => p.c.sourceId === option.c.sourceId && p.c.sceneStartMs === option.c.sceneStartMs)) bonus += 0.01;
        next.push({ total: beam.total + option.score + bonus, picks: [...beam.picks, option] });
      }
    beams = (next.length ? next : beams.map((b) => ({ ...b, picks: [...b.picks, ranked[i][0]].filter(Boolean) as Ranked[] }))).sort((a, b) => b.total - a.total).slice(0, beamWidth);
  });
  if (profile) profile.beam = Math.round(performance.now() - t);
  const best = beams[0]?.picks ?? [];
  return best.map((p, i) => {
    const req = withRoles[i];
    // Distinct alternatives: another clip first, then another stretch, never a near-duplicate.
    const alternatives: Ranked[] = [];
    for (const x of reranked[i]) {
      if (alternatives.length >= 3) break;
      const near = (y: Ranked) => y.c.sourceId === x.c.sourceId && (y.c.sceneStartMs === x.c.sceneStartMs || Math.abs(y.inMs - x.inMs) < 2500);
      if (near(p) || alternatives.some(near)) continue;
      alternatives.push(x);
    }
    const lostOn = (x: Ranked) => {
      const w = weights[mode];
      const deficits = Object.keys(w)
        .map((k) => ({ k, d: (w[k] ?? 0) * ((p.match[k] ?? 0.5) - (x.match[k] ?? 0.5)) }))
        .filter((e) => e.d > 0.02)
        .sort((a, b) => b.d - a.d)
        .slice(0, 2);
      const parts = deficits.map((e) => `${termLabels[e.k] ?? e.k} (${(x.match[e.k] ?? 0.5).toFixed(2)} vs ${(p.match[e.k] ?? 0.5).toFixed(2)})`);
      if (x.speed < 1) parts.push(`needs ${Math.round((1 - x.speed) * 100)}% slow-down`);
      return parts.length ? "trails on " + parts.join(", ") : "close second overall";
    };
    const why: string[] = [];
    const strongest = Object.keys(weights[mode])
      .filter((k) => (p.match[k] ?? 0) >= 0.7)
      .sort((a, b) => (weights[mode][b] ?? 0) * (p.match[b] ?? 0) - (weights[mode][a] ?? 0) * (p.match[a] ?? 0))
      .slice(0, 3);
    if (strongest.length) why.push("strongest on " + strongest.map((k) => termLabels[k] ?? k).join(", "));
    if (p.action) why.push(`moves like the reference: trajectory ${p.action.trajectory.toFixed(2)}, regions ${p.action.regions.toFixed(2)}${p.action.subject !== null ? `, subject ${p.action.subject.toFixed(2)}` : ""}`);
    why.push(p.speed < 1 ? `cut-safe stretch is ${Math.round((1 - p.speed) * 100)}% short: mildly slowed to fill the shot` : "fits inside one cut-safe stretch");
    if (req.peakSource !== "none") why.push(`${req.peakSource === "audio event" ? "audio event" : "the reference's movement peak"} lands on the source's movement peak`);
    const actionFit = p.action?.overall ?? null;
    const confidence: ShotChoice["confidence"] = p.score >= 0.55 && (actionFit === null || actionFit >= 0.6) ? "high" : p.score >= 0.4 && (actionFit === null || actionFit >= 0.45) ? "medium" : "low";
    const reuse =
      repeats[i] >= 0 && best[repeats[i]]?.c.sourceId === p.c.sourceId && best[repeats[i]].inMs < p.outMs && p.inMs < best[repeats[i]].outMs
        ? { intentional: true, reason: `the reference repeats shot ${repeats[i] + 1}` }
        : null;
    let shortfall: string | null = null;
    if (confidence === "low") shortfall = `Low confidence: no source moment moves like this shot${actionFit !== null ? ` (best action match ${actionFit.toFixed(2)})` : ""}; review the alternatives.`;
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
      alternatives: alternatives.map((x) => ({ sourceId: x.c.sourceId, inMs: x.inMs, outMs: x.outMs, speed: x.speed, score: x.score, match: x.match, lostOn: lostOn(x) })),
      reuse,
      shortfall,
    };
  });
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
