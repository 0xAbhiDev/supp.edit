/** Long-footage selection. All supplied raw clips are one searchable pool, indexed once from the
 * cached analysis (quality every 500 ms over the whole clip, scenes, vision embeddings, layout,
 * people), so the reference can be rematched without decoding again.
 *
 *  - Candidates: action windows around motion peaks and calm windows for holds, inside every
 *    scene of every clip, each with measured quality (sharpness, exposure, stability, black).
 *  - Requirements: each reference shot's duration, look, framing, pose, motion, layout, luma and
 *    the moment inside it that matters (its strongest linked audio event, else its motion peak).
 *  - Selection: a beam search over the whole edit scores similarity per shot and penalises reuse
 *    of the same source interval, near-identical neighbours and backwards progression within one
 *    clip; repeated footage is allowed only where the reference itself repeats a shot.
 *  - Trimming: the chosen source window is cut so its action peak lands where the reference
 *    shot's peak is, not centred.
 * Every choice keeps its scoring terms and the best alternatives for review. */
import type { Shot, RecreationMode } from "./dna";
import { averageEmbedding, embeddingSimilarity, layoutSimilarity, measuredColor, measuredLayout } from "./visual";
import { describeShots } from "./dna";
import { shapeFit, shapeOver } from "./subject-shape";
import type { SourceEvidence } from "./planner";

export interface FootageCandidate {
  sourceId: string;
  /** Window considered for this candidate and the scene it lies in (source milliseconds). */
  startMs: number;
  endMs: number;
  sceneStartMs: number;
  sceneEndMs: number;
  /** The moment of strongest movement (or the window centre for a calm hold). */
  peakMs: number;
  kind: "action" | "hold";
  motion: number;
  /** 0–1 share of sampled frames that are sharp, exposed, stable and not black. */
  quality: number;
  qualityIssues: string[];
  luma: number | null;
}
export interface FootageIndex {
  candidates: FootageCandidate[];
  coverage: { clips: number; suppliedMs: number; analyzedMs: number; candidates: number };
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);

export function buildFootageIndex(sources: SourceEvidence[]): FootageIndex {
  const candidates: FootageCandidate[] = [];
  let suppliedMs = 0,
    analyzedMs = 0;
  for (const source of sources) {
    const durationMs = source.asset.duration * 1000;
    suppliedMs += durationMs;
    const quality = source.analysis.video?.quality ?? [];
    if (quality.length) analyzedMs += Math.min(durationMs, quality.at(-1)!.timeMs - quality[0].timeMs + (quality[1]?.timeMs ?? 500) - quality[0].timeMs);
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
    // Scene detection can miss cuts between similar-looking material (a held frame and the live
    // action of the same subject). An isolated one-sample spike of frame difference is such a
    // cut, not movement: split there, so no candidate straddles it and no spike counts as action.
    const segments: { startMs: number; endMs: number; motion: number | null }[] = [];
    for (const scene of scenes) {
      const inside = quality.filter((q) => q.timeMs >= scene.startMs && q.timeMs < scene.endMs);
      let start = scene.startMs;
      inside.forEach((q, k) => {
        const around = [inside[k - 2], inside[k - 1], inside[k + 1], inside[k + 2]].filter(Boolean).map((x) => x!.frameDifference);
        if (k > 0 && around.length && q.frameDifference >= 0.05 && q.frameDifference >= 2.5 * median(around)) {
          // The cut lies between the previous sample and this one: end before it, start after it.
          const before = inside[k - 1].timeMs;
          if (before - start >= 400) segments.push({ startMs: start, endMs: before, motion: scene.motion });
          start = q.timeMs;
        }
      });
      if (scene.endMs - start >= 400) segments.push({ startMs: start, endMs: scene.endMs, motion: scene.motion });
    }
    for (const scene of segments) {
      // Samples at a cut measure the cut itself; they are left out of the segment's motion.
      const frames = quality.filter((q) => q.timeMs > scene.startMs && q.timeMs < scene.endMs);
      if (!frames.length) continue;
      const window = (a: number, b: number, peakMs: number, kind: FootageCandidate["kind"]) => {
        const inside = frames.filter((q) => q.timeMs >= a && q.timeMs < b);
        const issues = inside.map(good);
        const ok = inside.length ? issues.filter((i) => !i.length).length / inside.length : 0;
        const counts = new Map<string, number>();
        for (const list of issues) for (const i of list) counts.set(i, (counts.get(i) ?? 0) + 1);
        candidates.push({
          sourceId: source.asset.id,
          startMs: a,
          endMs: b,
          sceneStartMs: scene.startMs,
          sceneEndMs: scene.endMs,
          peakMs,
          kind,
          motion: inside.length ? inside.reduce((s, q) => s + q.frameDifference, 0) / inside.length : (scene.motion ?? 0),
          quality: Number(ok.toFixed(3)),
          qualityIssues: [...counts].filter(([, n]) => n >= Math.max(1, inside.length * 0.3)).map(([i]) => i),
          luma: inside.length ? inside.reduce((s, q) => s + q.meanLuma, 0) / inside.length : null,
        });
      };
      // Action: local motion peaks clearly above the scene's typical movement.
      const motion = frames.map((q) => q.frameDifference);
      const typical = median(motion),
        top = Math.max(...motion);
      const peaks: number[] = [];
      for (let k = 0; k < frames.length; k++) {
        const v = motion[k];
        if (v < Math.max(typical * 1.4, top * 0.55) || v < 0.004) continue;
        if (k > 0 && motion[k - 1] > v) continue;
        if (k + 1 < frames.length && motion[k + 1] >= v) continue;
        // Parabolic refinement between the 500 ms samples.
        const a = motion[k - 1] ?? v,
          c = motion[k + 1] ?? v,
          denom = a - 2 * v + c,
          shift = denom ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0,
          step = (frames[1]?.timeMs ?? frames[0].timeMs + 500) - frames[0].timeMs;
        peaks.push(Math.round(frames[k].timeMs + shift * step));
      }
      for (const p of peaks) window(Math.max(scene.startMs, p - 1500), Math.min(scene.endMs, p + 1500), p, "action");
      // Holds: calm windows every 2 s, for shots that need little movement.
      for (let a = scene.startMs; a < scene.endMs - 400; a += 2000) {
        const b = Math.min(scene.endMs, a + 3000);
        if (!peaks.some((p) => p >= a && p < b)) window(a, b, Math.round((a + b) / 2), "hold");
      }
    }
  }
  return { candidates, coverage: { clips: sources.length, suppliedMs: Math.round(suppliedMs), analyzedMs: Math.round(analyzedMs), candidates: candidates.length } };
}

export interface ShotRequirement {
  shot: Shot;
  /** Wanted duration in source milliseconds. */
  durationMs: number;
  /** Where inside the shot its important moment falls (0–1), and why. */
  peakFraction: number;
  peakSource: "audio event" | "reference motion" | "none";
}
export interface ShotChoice {
  sourceId: string;
  /** Chosen trim (source milliseconds). */
  inMs: number;
  outMs: number;
  peakMs: number;
  score: number;
  /** 0–1 per criterion, for display. */
  match: Record<string, number>;
  alternatives: { sourceId: string; inMs: number; outMs: number; score: number; match: Record<string, number> }[];
  reuse: { intentional: boolean; reason: string } | null;
}

/** Close Match weights follow the stated priority: action/pose, framing, motion, audio-event
 * alignment, composition, tone, quality. Remix leans on action, Smart in between. */
const weights: Record<RecreationMode, Record<string, number>> = {
  "Close Match": { pose: 1.0, look: 0.9, framing: 0.8, motion: 0.75, peak: 0.65, composition: 0.55, tone: 0.4, quality: 0.6 },
  "Smart Adaptation": { pose: 0.8, look: 0.8, framing: 0.6, motion: 0.7, peak: 0.6, composition: 0.4, tone: 0.3, quality: 0.6 },
  "Creative Remix": { pose: 0.3, look: 0.4, framing: 0.3, motion: 1.0, peak: 0.5, composition: 0.2, tone: 0.2, quality: 0.6 },
};

/** Score one candidate for one reference shot, trimmed so its peak lands on the shot's peak. */
export function scoreCandidate(req: ShotRequirement, c: FootageCandidate, source: SourceEvidence, mode: RecreationMode) {
  const len = req.durationMs;
  const lo = c.sceneStartMs,
    hi = c.sceneEndMs;
  if (hi - lo < len * 0.9) return undefined;
  // Trim: the peak at the reference's peak position, kept inside the scene.
  let inMs = c.peakMs - req.peakFraction * len;
  inMs = Math.max(lo, Math.min(hi - len, inMs));
  const outMs = inMs + Math.min(len, hi - lo);
  const achieved = (c.peakMs - inMs) / Math.max(1, outMs - inMs);
  // Look: semantic embeddings where a vision frame lies near the window; otherwise (vision is
  // sampled sparsely on long clips) the dense per-frame colour signature stands in.
  const vision = source.analysis.vision?.frames ?? [];
  const frames = vision.filter((f) => f.timeMs >= inMs - 1500 && f.timeMs < outMs + 1500);
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
  const shotScale = frames[0]?.shotScale ?? null;
  const shape = req.shot.subjectShape && source.people?.length ? shapeOver(source.people, inMs, outMs, source.asset.width / Math.max(1, source.asset.height)) : undefined;
  const pose = req.shot.subjectShape && shape ? shapeFit(req.shot.subjectShape, shape) : null;
  const motionFit = req.shot.motion !== null ? Math.exp(-Math.abs(Math.log((0.008 + c.motion) / (0.008 + req.shot.motion)))) : 0.5;
  const match: Record<string, number> = {
    look: look === null ? 0.5 : (look + 1) / 2,
    pose: pose ?? 0.5,
    framing: req.shot.framing && shotScale ? (req.shot.framing === shotScale ? 1 : 0.35) : 0.5,
    motion: motionFit,
    peak: req.peakSource === "none" ? 0.5 : Math.exp(-Math.abs(achieved - req.peakFraction) / 0.15) * (c.kind === "action" ? 1 : 0.6),
    composition: layout ?? 0.5,
    tone: req.shot.luma !== null && c.luma !== null ? Math.exp(-Math.abs(req.shot.luma - c.luma) / 0.15) : 0.5,
    quality: c.quality,
  };
  const w = weights[mode];
  const total = Object.entries(match).reduce((s, [k, v]) => s + (w[k] ?? 0) * v, 0) / Object.values(w).reduce((a, b) => a + b, 0);
  // Static footage cannot play an action shot: when the reference shot moves, the whole score is
  // scaled by how well the candidate moves. Mostly unusable footage is rejected outright.
  const moving = (req.shot.motion ?? 0) >= 0.01;
  const gated = moving ? total * (0.4 + 0.6 * motionFit) : total;
  const score = c.quality < 0.35 ? gated * 0.3 : gated;
  for (const k of Object.keys(match)) match[k] = Number(match[k].toFixed(2));
  return { inMs: Math.round(inMs), outMs: Math.round(outMs), peakMs: c.peakMs, score: Number(score.toFixed(4)), match };
}

/** Choose a source moment for every reference shot, globally. */
export function selectShots(index: FootageIndex, sources: SourceEvidence[], reqs: ShotRequirement[], mode: RecreationMode, beamWidth = 10, perShot = 12): ShotChoice[] {
  const byId = new Map(sources.map((s) => [s.asset.id, s]));
  // Reference shots that repeat footage (near-identical looks) may repeat source footage too.
  const repeats = reqs.map((r, i) =>
    reqs.findIndex((o, j) => j < i && r.shot.embedding && o.shot.embedding && (embeddingSimilarity(r.shot.embedding, o.shot.embedding) ?? 0) > 0.97),
  );
  const ranked = reqs.map((req) =>
    index.candidates
      .map((c) => {
        const s = scoreCandidate(req, c, byId.get(c.sourceId)!, mode);
        return s && { c, ...s };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      // Several candidates can trim to the same moment; keep the best of each.
      .sort((a, b) => b.score - a.score)
      .filter((x, i, all) => all.findIndex((y) => y.c.sourceId === x.c.sourceId && Math.abs(y.inMs - x.inMs) < 250) === i)
      .slice(0, perShot),
  );
  type Pick = (typeof ranked)[number][number];
  type Beam = { total: number; picks: Pick[] };
  let beams: Beam[] = [{ total: 0, picks: [] }];
  reqs.forEach((_, i) => {
    const next: Beam[] = [];
    for (const beam of beams)
      for (const option of ranked[i]) {
        let penalty = 0;
        const overlaps = beam.picks.some((p, j) => p.c.sourceId === option.c.sourceId && p.inMs < option.outMs && option.inMs < p.outMs && repeats[i] !== j);
        if (overlaps) continue;
        const prev = beam.picks.at(-1);
        if (prev && prev.c.sourceId === option.c.sourceId) {
          // Near-identical neighbours look like a stutter; going backwards breaks progression.
          if (Math.abs(prev.inMs - option.inMs) < 3000) penalty += 0.25;
          if (option.inMs < prev.inMs) penalty += 0.04;
        }
        next.push({ total: beam.total + option.score - penalty, picks: [...beam.picks, option] });
      }
    beams = (next.length ? next : beams.map((b) => ({ ...b, picks: [...b.picks, ranked[i][0]].filter(Boolean) as Pick[] }))).sort((a, b) => b.total - a.total).slice(0, beamWidth);
  });
  const best = beams[0]?.picks ?? [];
  return best.map((p, i) => ({
    sourceId: p.c.sourceId,
    inMs: p.inMs,
    outMs: p.outMs,
    peakMs: p.peakMs,
    score: p.score,
    match: p.match,
    alternatives: ranked[i]
      .filter((x) => !(x.c.sourceId === p.c.sourceId && Math.abs(x.inMs - p.inMs) < 250))
      .slice(0, 3)
      .map((x) => ({ sourceId: x.c.sourceId, inMs: x.inMs, outMs: x.outMs, score: x.score, match: x.match })),
    reuse:
      repeats[i] >= 0 && best[repeats[i]]?.c.sourceId === p.c.sourceId && best[repeats[i]].inMs < p.outMs && p.inMs < best[repeats[i]].outMs
        ? { intentional: true, reason: `the reference repeats shot ${repeats[i] + 1}` }
        : null,
  }));
}
