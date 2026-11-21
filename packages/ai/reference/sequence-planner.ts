/** Global semantic planning: the whole reference sequence against the whole source inventory.
 *
 *  1. Source resources: cut-safe stretches grouped by which reference shots they can play, with
 *     their usable duration and the demand on them (scarcity = demanded / available time).
 *  2. Repeat groups: reference shots that perform the same action (same movement geometry and
 *     pose, competing for the same stretches), with a decision: distinct repetitions exist, the
 *     shots share one stretch phase by phase, the reference repetition is played by reusing one
 *     interval, or another action must substitute.
 *  3. Action-phase inventory: rest points and movement peaks of a stretch, from its movement
 *     curve; extra windows start and end on phase boundaries so several shots can share one long
 *     repetition without overlapping frames, each window holding a real movement phase.
 *  4. Future-aware sequence search: a beam over the shots whose priority adds, for every later
 *     shot, the best score it could still get from what is left, so a shot never greedily spends
 *     footage a later shot needs. Overlap is allowed only as controlled reuse inside a repeat
 *     group (or where the reference repeats the very same shot), always penalised and reported.
 *  5. Near ties: when the best stretches score within a semantic margin, a deeper temporal review
 *     (best-aligned pose trajectory, body orientation, outline deformation, foreground/background
 *     movement split, movement regions over the stretch) decides instead of rounding noise.
 *  6. Context: adjacent picks should change framing and movement the way the reference does.
 *  7. Calibration: confidence from the margin to the best distinct alternative, semantic
 *     agreement, quality and duration fit; coverage excellent / good / weak / missing. */
import type { FootageCandidate, Scored, ShotRequirement } from "./footage-index";
import type { SourceEvidence } from "./planner";
import { actionSignature, actionSimilarity, smoothedChange } from "./action-signature";
import { pathFit, shapeFit, shapePath } from "./subject-shape";
import { embeddingSimilarity } from "./visual";

export type Option = Scored & { c: FootageCandidate; phase?: string; tiebreak?: number; identity?: import("./identity").IdentityMatch };
export const stretchOf = (o: { c: FootageCandidate }) => `${o.c.sourceId}:${o.c.sceneStartMs}`;
const overlapping = (a: Option, b: Option) => a.c.sourceId === b.c.sourceId && a.inMs < b.outMs && b.inMs < a.outMs;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Agreement on what the shot does: movement geometry and pose where measured. */
export const semanticOf = (o: Scored) => {
  const parts = [o.action?.overall, o.pose ?? undefined].filter((v): v is number => v !== undefined);
  return parts.length ? mean(parts) : null;
};

// ---- 1. Source resources -------------------------------------------------------------------
export interface SourceResource {
  clusterId: number;
  usableIntervals: { sourceId: string; startMs: number; endMs: number }[];
  totalMs: number;
  compatibleShots: number[];
  demandMs: number;
  /** Demanded over available time: above 1 the shots that need it cannot all have their own. */
  scarcity: number;
}
/** Stretches each shot can play well: options within `margin` of its best. */
export function compatibleStretches(options: Option[][], margin = 0.04) {
  return options.map((list) => {
    const top = list[0]?.score ?? 0;
    return new Set(list.filter((o) => o.score >= top - margin).map(stretchOf));
  });
}
/** Stretches that play a shot well: close to its best AND agreeing on what the shot does (a
 * second, slightly weaker repetition of the same action still counts). */
export function strongStretches(options: Option[][]) {
  return options.map((list) => {
    const top = list[0]?.score ?? 0;
    return new Set(list.filter((o) => o.score >= top - 0.1 && (semanticOf(o) ?? 1) >= 0.6).map(stretchOf));
  });
}
export function sourceResources(options: Option[][], reqs: ShotRequirement[], margin = 0.04): SourceResource[] {
  const compat = compatibleStretches(options, margin);
  const stretches = new Map<string, { sourceId: string; startMs: number; endMs: number; shots: Set<number> }>();
  options.forEach((list, i) =>
    list.forEach((o) => {
      const k = stretchOf(o);
      if (!compat[i].has(k)) return;
      const s = stretches.get(k) ?? { sourceId: o.c.sourceId, startMs: o.c.sceneStartMs, endMs: o.c.sceneEndMs, shots: new Set<number>() };
      s.shots.add(i);
      stretches.set(k, s);
    }),
  );
  // One resource per distinct set of compatible shots (stretches that serve the same shots).
  const clusters = new Map<string, SourceResource>();
  for (const s of stretches.values()) {
    const shots = [...s.shots].sort((a, b) => a - b);
    const key = shots.join(",");
    const r = clusters.get(key) ?? { clusterId: clusters.size, usableIntervals: [], totalMs: 0, compatibleShots: shots, demandMs: shots.reduce((n, i) => n + reqs[i].durationMs * 0.85, 0), scarcity: 0 };
    r.usableIntervals.push({ sourceId: s.sourceId, startMs: s.startMs, endMs: s.endMs });
    r.totalMs += s.endMs - s.startMs;
    clusters.set(key, r);
  }
  for (const r of clusters.values()) r.scarcity = Number((r.demandMs / Math.max(1, r.totalMs)).toFixed(2));
  return [...clusters.values()];
}

// ---- 2. Repeat groups ------------------------------------------------------------------------
export interface RepeatGroup {
  shots: number[];
  /** The reference repeats the very same moment (same look and same movement). */
  sameMoment: boolean;
  similarity: number;
  /** Distinct stretches that can play the group well. */
  stretches: number;
  decision: "distinct repetitions" | "share one stretch" | "reuse" | "substitute";
  /** What the plan did: separate repetitions, phases of one stretch, a reused interval, or a substitute. */
  outcome?: "separate repetitions" | "shared one stretch" | "reused one interval" | "substituted another action";
}
export function repeatGroups(reqs: ShotRequirement[], options: Option[][], margin = 0.04): RepeatGroup[] {
  const parent = reqs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const compat = compatibleStretches(options, margin);
  const sims = new Map<string, { motion: number; same: boolean }>();
  for (let i = 0; i < reqs.length; i++)
    for (let j = i + 1; j < reqs.length; j++) {
      const a = reqs[i].shot,
        b = reqs[j].shot;
      if (!a.action || !b.action) continue;
      const motion = actionSimilarity(a.action, b.action).overall;
      const pose = a.subjectShape && b.subjectShape ? shapeFit(a.subjectShape, b.subjectShape) : undefined;
      const shared = [...compat[i]].some((k) => compat[j].has(k));
      // Two shots whose clear best match is the same stretch perform the same action; moderate
      // movement or pose agreement confirms it (different phases of one lift still agree).
      if (shared && (motion >= 0.6 || (pose !== undefined && pose >= 0.6)) && (pose === undefined || pose >= 0.5)) {
        parent[find(j)] = find(i);
        const same = !!a.embedding && !!b.embedding && (embeddingSimilarity(a.embedding, b.embedding) ?? 0) > 0.97 && motion >= 0.9;
        sims.set(`${i}:${j}`, { motion, same });
      }
    }
  const groups = new Map<number, number[]>();
  reqs.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((shots) => {
      const pairs = shots.flatMap((i) => shots.filter((j) => j > i).map((j) => sims.get(`${i}:${j}`))).filter(Boolean) as { motion: number; same: boolean }[];
      // Stretches that can play the group well: close to a shot's best AND agreeing on what the
      // shot does — a second, slightly weaker repetition still counts, so reuse is a last resort.
      // Any repetition that agrees on what the shot does counts as a second repetition (a little
      // wider than strong stretches: weights differ by mode), so reuse stays a last resort.
      const union = new Set(
        shots.flatMap((i) => {
          const top = options[i][0]?.score ?? 0;
          return options[i].filter((o) => o.score >= top - 0.15 && (semanticOf(o) ?? 1) >= 0.6).map(stretchOf);
        }),
      );
      const lengths = [...union].map((k) => {
        const o = options.flat().find((x) => stretchOf(x) === k)!;
        return o.c.sceneEndMs - o.c.sceneStartMs;
      });
      const need = shots.reduce((n, i) => n + reqs[i].durationMs * 0.85, 0);
      const best = shots.map((i) => (options[i][0] ? semanticOf(options[i][0]) : null)).filter((v): v is number => v !== null);
      const decision: RepeatGroup["decision"] =
        union.size >= shots.length ? "distinct repetitions" : Math.max(0, ...lengths) >= need ? "share one stretch" : !best.length || mean(best) >= 0.6 ? "reuse" : "substitute";
      return { shots, sameMoment: pairs.some((p) => p.same), similarity: Number(mean(pairs.map((p) => p.motion)).toFixed(3)), stretches: union.size, decision };
    });
}

// ---- 3. Action-phase inventory --------------------------------------------------------------
export interface ActionPhase {
  startMs: number;
  endMs: number;
  kind: "rest" | "build" | "peak" | "release";
}
/** Phases of the movement inside [startMs, endMs): rests (low points), builds, peaks, releases. */
export function actionPhases(source: SourceEvidence, startMs: number, endMs: number): { phases: ActionPhase[]; rests: number[]; peaks: number[] } {
  const frames = (source.visual ?? []).filter((f) => f.timeMs >= startMs && f.timeMs < endMs);
  if (frames.length < 8) return { phases: [], rests: [startMs, endMs], peaks: [] };
  const raw = smoothedChange(frames);
  // A second, wider smoothing (~230 ms) so a repetition reads as one rise and one fall.
  const e = raw.map((_, i) => mean(raw.slice(Math.max(0, i - 3), i + 4)));
  const top = Math.max(...e);
  const rests: number[] = [startMs],
    peaks: number[] = [];
  for (let i = 2; i < e.length - 2; i++) {
    if (e[i] <= e[i - 1] && e[i] < e[i + 1] && e[i] <= Math.min(e[i - 2], e[i + 2]) && e[i] < 0.6 * top) rests.push(frames[i].timeMs);
    if (e[i] >= e[i - 1] && e[i] > e[i + 1] && e[i] >= Math.max(e[i - 2], e[i + 2]) && e[i] >= 0.5 * top) peaks.push(frames[i].timeMs);
  }
  rests.push(endMs);
  const phases: ActionPhase[] = [];
  const marks = [...rests.map((t) => ({ t, k: "rest" as const })), ...peaks.map((t) => ({ t, k: "peak" as const }))].sort((a, b) => a.t - b.t);
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i],
      b = marks[i + 1];
    phases.push({ startMs: a.t, endMs: b.t, kind: a.k === b.k ? (a.k === "rest" ? "rest" : "peak") : a.k === "rest" ? "build" : "release" });
  }
  return { phases, rests, peaks };
}
/** Windows of `len` inside a stretch that start or end on a rest point and hold at least one
 * movement peak: sub-intervals one repetition can lend to several shots. */
export function phaseWindows(source: SourceEvidence, c: FootageCandidate, len: number, minSpeed = 0.85) {
  const { rests, peaks } = actionPhases(source, c.sceneStartMs, c.sceneEndMs);
  const out: { inMs: number; outMs: number; peakMs: number; label: string }[] = [];
  const add = (a: number, b: number) => {
    a = Math.max(c.sceneStartMs, a);
    b = Math.min(c.sceneEndMs, b);
    if (b - a < len * minSpeed - 1) return;
    const inside = peaks.filter((p) => p > a + 50 && p < b - 50);
    if (!inside.length) return;
    if (out.some((w) => Math.abs(w.inMs - a) < 150 && Math.abs(w.outMs - b) < 150)) return;
    const restsInside = rests.filter((r) => r > a && r < b).length;
    out.push({ inMs: Math.round(a), outMs: Math.round(b), peakMs: inside[0], label: `${inside.length} movement peak${inside.length > 1 ? "s" : ""}${restsInside ? `, ${restsInside} rest` : ""}` });
  };
  // Windows start or end on a rest point or a stretch edge, at full length or at the shortest
  // length a mild retime can fill: tight windows let two shots pack into one repetition.
  for (const r of rests)
    for (const l of [len, len * minSpeed + 1]) {
      add(r, r + l);
      add(r - l, r);
    }
  return out;
}

// ---- 5. Near-tie review ---------------------------------------------------------------------
const pearson = (a: readonly number[], b: readonly number[]) => {
  const ma = mean([...a]),
    mb = mean([...b]);
  let s = 0,
    va = 0,
    vb = 0;
  for (let i = 0; i < a.length; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 1e-9 && vb > 1e-9 ? s / Math.sqrt(va * vb) : 0;
};
/** Deeper temporal agreement of a stretch with a shot: the best-aligned window (sliding through
 * the whole stretch, not only the peak-placed trim) on pose trajectory, body orientation change,
 * outline deformation, foreground/background movement split and movement regions. */
export function deepTemporal(req: ShotRequirement, c: FootageCandidate, source: SourceEvidence, around?: { inMs: number; outMs: number }) {
  const ref = req.shot.action;
  if (!ref || !source.visual?.length) return undefined;
  const aspect = source.asset.width / Math.max(1, source.asset.height);
  const len = Math.min(req.durationMs, c.sceneEndMs - c.sceneStartMs);
  let best = -1;
  // Longer context than the trim, but near it: up to 2 s either side (a whole minute-long stretch
  // would cost far more and say little more).
  const from = around ? Math.max(c.sceneStartMs, around.inMs - 2000) : c.sceneStartMs,
    to = around ? Math.min(c.sceneEndMs, around.outMs + 2000) : c.sceneEndMs;
  for (let a = from; a + len <= to + 1; a += 200) {
    const sig = actionSignature(source.visual, source.people, a, a + len, aspect);
    if (!sig) continue;
    // With person outlines, where things move complements the pose path and orientation below.
    // Without them, "where" alone ranked a circling spoon above a falling stream whenever the
    // reference sat at another position (cooking case, shot 1: the review reversed stage B's
    // correct order), so the whole movement comparison — direction, trajectory, rhythm and
    // envelope as well as regions — is the review's evidence there.
    const sim = actionSimilarity(ref, sig);
    const parts: [number, number][] = [[source.people?.length ? sim.regions : sim.overall, 0.25]];
    const rs = ref.subject,
      cs = sig.subject;
    if (req.shot.subjectPath && source.people?.length) {
      const p = pathFit(req.shot.subjectPath.map((x) => x ?? undefined), shapePath(source.people, a, a + len, aspect));
      if (p !== undefined) parts.push([p, 0.3]);
    }
    if (rs?.orientation && cs?.orientation) parts.push([(pearson(rs.orientation, cs.orientation) + 1) / 2, 0.15]);
    if (rs?.deformation !== undefined && cs?.deformation !== undefined) parts.push([Math.exp(-Math.abs(rs.deformation - cs.deformation) / 0.15), 0.15]);
    if (rs?.foreground !== undefined && cs?.foreground !== undefined) parts.push([Math.exp(-Math.abs(rs.foreground - cs.foreground) / 0.2), 0.15]);
    const v = parts.reduce((s, [x, w]) => s + x * w, 0) / parts.reduce((s, [, w]) => s + w, 0);
    if (v > best) best = v;
  }
  return best >= 0 ? best : undefined;
}
/** Margin under which two stretches are a near tie for a shot. */
export const SEMANTIC_MARGIN = 0.02;
/** When a shot's best stretches are nearly tied, re-score them by the deeper temporal review.
 * Returns the shots that were reviewed and by how much the top changed. */
export function breakNearTies(reqs: ShotRequirement[], options: Option[][], byId: Map<string, SourceEvidence>) {
  const reviewed: { shot: number; margin: number; changed: boolean }[] = [];
  options.forEach((list, i) => {
    const bestPer = new Map<string, Option>();
    for (const o of list) if (!bestPer.has(stretchOf(o))) bestPer.set(stretchOf(o), o);
    const tops = [...bestPer.values()];
    if (tops.length < 2 || tops[0].score - tops[1].score >= SEMANTIC_MARGIN) return;
    const tied = tops.filter((o) => o.score >= tops[0].score - 1.5 * SEMANTIC_MARGIN).slice(0, 6);
    const tb = tied.map((o) => deepTemporal(reqs[i], o.c, byId.get(o.c.sourceId)!, o));
    const known = tb.filter((v): v is number => v !== undefined);
    if (known.length < 2) return;
    const m = mean(known);
    const before = tops[0];
    tied.forEach((o, k) => {
      if (tb[k] === undefined) return;
      const delta = 0.15 * (tb[k]! - m);
      // The whole stretch moves together: every option in it shares the review's verdict.
      for (const x of list) if (stretchOf(x) === stretchOf(o)) {
        x.score = Number((x.score + delta).toFixed(4));
        x.tiebreak = Number(tb[k]!.toFixed(3));
      }
    });
    list.sort((a, b) => b.score - a.score);
    reviewed.push({ shot: i, margin: Number((tops[0].score - tops[1].score).toFixed(4)), changed: stretchOf(list[0]) !== stretchOf(before) });
  });
  return reviewed;
}

// ---- 6. Context between adjacent shots ------------------------------------------------------
const framingScale = (f: string | null | undefined) => (f === "close" ? 0.9 : f === "medium" ? 0.6 : f === "wide" ? 0.3 : null);
/** 0–1: whether moving from one pick to the next changes framing and movement level the way the
 * reference moves between the same two shots. */
export function transitionFit(prevReq: ShotRequirement, req: ShotRequirement, prev: Option, cur: Option) {
  const parts: number[] = [];
  const rs = (r: ShotRequirement) => r.shot.subjectShape?.height ?? framingScale(r.shot.framing);
  const a = rs(prevReq),
    b = rs(req);
  if (a !== null && b !== null && prev.scale != null && cur.scale != null) parts.push(Math.exp(-Math.abs(b - a - (cur.scale - prev.scale)) / 0.25));
  const la = prevReq.shot.action?.level,
    lb = req.shot.action?.level;
  if (la !== undefined && lb !== undefined) {
    const e = 0.0015;
    parts.push(Math.exp(-Math.abs(Math.log((e + lb) / (e + la)) - Math.log((e + cur.c.motion) / (e + prev.c.motion)))));
  }
  return parts.length ? mean(parts) : 0.5;
}

// ---- 4. Future-aware sequence search --------------------------------------------------------
export interface Plan {
  picks: Option[];
  reuse: ({ permitted: true; reason: string; confidence: number; ofShot: number } | null)[];
}
export function planSequence(
  reqs: ShotRequirement[],
  options: Option[][],
  groups: RepeatGroup[],
  sameMoment: number[],
  beamWidth = 40,
  perShot = 16,
  /** Contested stretches: the shots that need them would use most of them (scarcity ≥ 0.6). */
  scarce: Set<string> = new Set(),
): Plan {
  const groupOf = reqs.map((_, i) => groups.findIndex((g) => g.shots.includes(i)));
  // Semantic mismatch: a pick from a stretch that does not play the shot well, when one that does
  // exists, costs extra, so substitution never wins on rounding.
  const strong = strongStretches(options);
  // The cost grows with how much worse the substitute agrees on what the shot does than the
  // shot's best strong stretch: a slightly different stretch costs little, a different action a lot.
  const bestSemantic = options.map((list, i) => Math.max(0, ...list.filter((o) => strong[i].has(stretchOf(o))).map((o) => semanticOf(o) ?? 0)));
  const mismatch = (i: number, o: Option) => (strong[i].size === 0 || strong[i].has(stretchOf(o)) ? 0 : 0.08 + 0.8 * Math.max(0, bestSemantic[i] - (semanticOf(o) ?? bestSemantic[i])));
  // The best options per shot, plus its phase windows (the windows that let shots share one
  // repetition) even when they rank lower on their own.
  const lists = options.map((l) => [...l.slice(0, perShot), ...l.slice(perShot).filter((o) => o.phase).slice(0, 12)]);
  /** Overlap between shot i's option and an earlier pick of shot j: forbidden, or controlled reuse. */
  const reuseCost = (i: number, j: number) => {
    if (sameMoment[i] === j) return 0;
    const g = groupOf[i];
    if (g >= 0 && g === groupOf[j] && groups[g].decision === "reuse") return 0.06;
    return null;
  };
  const admissible = (i: number, o: Option, picks: Option[]) => {
    let cost = 0;
    for (let j = 0; j < picks.length; j++) {
      if (!overlapping(picks[j], o)) continue;
      const c = reuseCost(i, j);
      if (c === null) return null;
      cost += c;
    }
    return cost;
  };
  const neighbour = (i: number, prev: Option | undefined, o: Option, picks: Option[]) => {
    let bonus = 0;
    if (prev && prev.c.sourceId === o.c.sourceId) {
      if (Math.abs(prev.inMs - o.inMs) < 3000 && !overlapping(prev, o)) bonus -= 0.25;
      bonus += o.inMs > prev.inMs ? 0.01 : -0.015;
    }
    if (!picks.some((p) => stretchOf(p) === stretchOf(o))) bonus += 0.01;
    if (prev && i > 0) bonus += 0.06 * (transitionFit(reqs[i - 1], reqs[i], prev, o) - 0.5);
    return bonus;
  };
  /** The best each later shot could still get from what is left: the planner looks ahead before
   * spending footage another shot needs. */
  const future = (from: number, picks: Option[]) => {
    let h = 0;
    for (let k = from; k < reqs.length; k++) {
      for (const o of lists[k]) {
        const cost = admissible(k, o, picks);
        if (cost === null) continue;
        h += o.score - cost - mismatch(k, o);
        break;
      }
    }
    return h;
  };
  type Beam = { total: number; priority: number; picks: Option[]; reuse: Plan["reuse"] };
  let beams: Beam[] = [{ total: 0, priority: 0, picks: [], reuse: [] }];
  reqs.forEach((_, i) => {
    const next: Beam[] = [];
    for (const beam of beams)
      for (const o of lists[i]) {
        const cost = admissible(i, o, beam.picks);
        if (cost === null) continue;
        const total = beam.total + o.score - cost - mismatch(i, o) + neighbour(i, beam.picks.at(-1), o, beam.picks);
        const picks = [...beam.picks, o];
        const reusedOf = beam.picks.findIndex((p) => overlapping(p, o));
        const reuse = [
          ...beam.reuse,
          reusedOf >= 0
            ? { permitted: true as const, reason: sameMoment[i] === reusedOf ? `the reference repeats shot ${reusedOf + 1}` : `reference-repeat: shot ${reusedOf + 1} performs the same action and the footage holds one usable repetition`, confidence: Number((semanticOf(o) ?? o.score).toFixed(2)), ofShot: reusedOf }
            : null,
        ];
        next.push({ total, priority: total + future(i + 1, picks), picks, reuse });
      }
    if (!next.length) {
      // Nothing admissible (everything consumed): fall back to the shot's best, flagged as reuse.
      for (const beam of beams) {
        const o = lists[i][0];
        if (!o) continue;
        const reusedOf = beam.picks.findIndex((p) => overlapping(p, o));
        next.push({ total: beam.total + o.score - 0.2, priority: beam.total + o.score - 0.2, picks: [...beam.picks, o], reuse: [...beam.reuse, reusedOf >= 0 ? { permitted: true, reason: `no other usable footage for this shot; reuses shot ${reusedOf + 1}'s interval`, confidence: 0.2, ofShot: reusedOf } : null] });
      }
    }
    // Diversity in how scarce footage is spent: beams that use a scarce stretch differently are
    // different states, each keeping a few survivors, so a plan that spends less of it early
    // (and wins later) is not crowded out by variations of the greedy one.
    const stateOf = (b: Beam) => b.picks.map((p) => (scarce.has(stretchOf(p)) ? `${stretchOf(p)}@${p.inMs}` : "")).join("|");
    // Only beams that spend a contested stretch the same way compete for a state's few places.
    const contested = (k: string) => k.replace(/\|/g, "") !== "";
    const perState = new Map<string, number>();
    const kept: Beam[] = [];
    for (const b of next.sort((a, b) => b.priority - a.priority)) {
      const k = stateOf(b);
      const n = perState.get(k) ?? 0;
      if (contested(k) && n >= 4) continue;
      perState.set(k, n + 1);
      kept.push(b);
      if (kept.length >= beamWidth) break;
    }
    beams = kept;
  });
  const best = beams.sort((a, b) => b.total - a.total)[0];
  return { picks: best?.picks ?? [], reuse: best?.reuse ?? [] };
}

// ---- 7. Calibration -------------------------------------------------------------------------
export type Coverage = "excellent" | "good" | "weak" | "missing";
export function calibrate(pick: Option, alternatives: Option[]) {
  const other = alternatives.find((o) => stretchOf(o) !== stretchOf(pick));
  const margin = other ? pick.score - other.score : 0.1;
  // The best different moment anywhere, the same stretch included: when another window of the
  // same clip scores as well, the clip may be right but the moment is not established.
  const rivalOption = alternatives.find((o) => o !== pick && !overlapping(o, pick));
  const rival = rivalOption ? pick.score - rivalOption.score : 0.1;
  const semantic = semanticOf(pick);
  // Confidence rests on measured agreement about what the shot does, plus quality and duration
  // fit. The score margin is not evidence of correctness: across the graded cases (60 shots,
  // 13 wrong) a small margin mostly meant several equally right repetitions, and the margin alone
  // ranked right picks above wrong ones less often than chance (AUC 0.42; this form 0.69). The
  // margin stays in the explanation (near ties, a better stretch spent elsewhere).
  const confidence = Math.max(
    0,
    Math.min(
      1,
      0.7 * (semantic === null ? 0.5 : Math.max(0, Math.min(1, (semantic - 0.45) / 0.4))) +
        0.15 * pick.c.quality +
        0.15 * (pick.speed >= 1 ? 1 : 0.5),
    ),
  );
  const coverage: Coverage =
    (semantic !== null && semantic < 0.5) || pick.score < 0.3 ? "missing" : confidence >= 0.7 && (semantic ?? 0.7) >= 0.7 ? "excellent" : confidence >= 0.5 || (semantic ?? 0) >= 0.65 ? "good" : "weak";
  return { certainty: Number(confidence.toFixed(2)), margin: Number(margin.toFixed(4)), rival: Number(rival.toFixed(4)), semantic, coverage, nearest: other };
}
