/** Structural alignment of a reference soundtrack with replacement music.
 *
 * The reference's editing grammar lives in musical coordinates (beat 3 of a bar, two beats
 * before the drop, 80 ms before an impact), so the alignment works on beats, not seconds:
 *  1. start: choose the replacement beat where the reference interval begins, by global agreement
 *     of linked event types, section labels and downbeat phase;
 *  2. landmarks: warp onto matching drops, sweep peaks and silence edges nearby;
 *  3. events: map the linked reference anchors to replacement anchors with an order-preserving
 *     dynamic programme whose cost combines type, section, bar phase, strength and position;
 *  4. constraints: place each visual event at its mapped anchor plus the measured offset. When
 *     an anchor has no counterpart the event follows the beat map and is reported, never left at
 *     its old absolute time.
 * Weights are generic; nothing refers to a particular reference or song. */
import type { AudioTimeline } from "../audio/timeline";
import { beatClock, labelCost, segmentAt, segmentsOf, type Segment } from "../audio/structure";
import { audioAnchors, type EventGraph } from "./event-graph";

/** Anchor kinds that can stand in for each other, closest first. */
export const families: Record<string, string[]> = {
  impact: ["impact", "drop", "bass_hit", "kick", "downbeat"],
  drop: ["drop", "impact", "bass_hit", "downbeat", "kick"],
  bass_hit: ["bass_hit", "impact", "kick", "downbeat"],
  kick: ["kick", "downbeat", "beat", "bass_hit", "snare"],
  snare: ["snare", "beat", "kick", "onset"],
  hat: ["hat", "onset", "snare"],
  downbeat: ["downbeat", "kick", "beat", "impact"],
  beat: ["beat", "downbeat", "kick", "snare"],
  onset: ["onset", "kick", "snare", "hat", "beat"],
  section: ["section", "drop", "downbeat"],
  whoosh_end: ["whoosh_end", "riser_end", "drop", "impact", "downbeat"],
  riser_end: ["riser_end", "whoosh_end", "drop", "impact", "downbeat"],
  silence_start: ["silence_start", "section"],
  silence_end: ["silence_end", "drop", "section", "downbeat"],
  // Without vocals in the replacement, a lyric cue may land on the rhythm instead (weakly).
  word: ["word", "onset", "snare", "kick", "beat", "hat"],
  word_match: ["word", "onset", "snare", "kick", "beat", "hat"],
  word_end: ["word_end", "silence_start", "onset", "beat"],
};
const typeSimilarity = (ref: string, rep: string) => {
  const list = families[ref] ?? [ref];
  const k = list.indexOf(rep);
  return k < 0 ? 0 : k === 0 ? 1 : Math.max(0.3, 0.85 - 0.12 * (k - 1));
};
const landmarkKinds = ["drop", "whoosh_end", "riser_end", "silence_start", "silence_end"];

export interface Reasons {
  type: number;
  section: number;
  phrase: number;
  strength: number;
  position: number;
}
export interface MappedEvent {
  anchorId: string;
  kind: string;
  refMs: number;
  repMs?: number;
  repKind?: string;
  reasons?: Reasons;
  confidence: number;
  status: "mapped" | "unmatched";
}
export interface VisualMove {
  visualId: string;
  visualKind: string;
  fromMs: number;
  /** Reference-clock time after adaptation (interval start + replacement time − offset). */
  toMs: number;
  anchor?: string;
  replacement?: string;
  relation: string;
  offsetMs: number;
  confidence: number;
  status: "anchored" | "no-replacement" | "free";
  reasons?: Reasons;
}
export interface StructuralAlignment {
  method: "beats" | "time";
  /** Replacement time where the reference interval starts. */
  offsetMs: number;
  /** Replacement milliseconds covered by the interval. */
  spanMs: number;
  /** Replacement beat period over reference beat period. */
  beatRatio: number;
  sections: { ref: Pick<Segment, "label" | "startMs" | "endMs">; rep: Pick<Segment, "label" | "startMs" | "endMs">; cost: number }[];
  landmarks: { kind: string; refMs: number; repMs: number }[];
  events: MappedEvent[];
  moves: VisualMove[];
  score: number;
  /** Reference time to replacement time. */
  map: (refMs: number) => number;
}

export function alignStructure(graph: EventGraph, reference: AudioTimeline, replacement: AudioTimeline, intervalStartMs: number, intervalEndMs: number): StructuralAlignment {
  const R = beatClock(reference),
    P = beatClock(replacement);
  const useBeats = R.reliable && P.reliable;
  // Without reliable beats on both sides, 500 ms "beats" make this a plain time alignment.
  // One reference beat maps to ½, 1 or 2 replacement beats, whichever keeps the beat length
  // nearest the reference (the same grammar at the nearest musically equivalent speed).
  const scale = useBeats ? 2 ** Math.round(Math.log2(R.medianPeriod / P.medianPeriod)) : 1;
  const rPos = (ms: number) => (useBeats ? R.position(ms) : ms / 500),
    pPos = (ms: number) => (useBeats ? P.position(ms) / scale : ms / 500),
    pTime = (b: number) => (useBeats ? P.time(b * scale) : b * 500);
  const refSegs = segmentsOf(reference),
    repSegs = segmentsOf(replacement);
  const anchorsById = new Map(graph.anchors.map((a) => [a.id, a]));
  const visualById = new Map(graph.visual.map((v) => [v.id, v]));
  const linked = [
    ...new Map(
      graph.links
        .filter((l) => l.anchorId && l.relation !== "unanchored" && l.relation !== "offbeat")
        .map((l) => [l.anchorId!, anchorsById.get(l.anchorId!)!] as const)
        .filter(([, a]) => a && a.timeMs >= intervalStartMs - 200 && a.timeMs <= intervalEndMs + 200),
    ).values(),
  ].sort((a, b) => a.timeMs - b.timeMs);
  const target = audioAnchors(replacement).sort((a, b) => a.timeMs - b.timeMs);
  const targetBeats = target.map((t) => pPos(t.timeMs));
  const bStart = rPos(intervalStartMs),
    bEnd = rPos(intervalEndMs),
    spanBeats = bEnd - bStart;
  const repBeatsTotal = pPos(replacement.durationMs);
  const near = (beat: number, radius: number) => {
    const out: number[] = [];
    for (let j = 0; j < target.length; j++) if (Math.abs(targetBeats[j] - beat) <= radius) out.push(j);
    return out;
  };

  // ---- 1. Start beat: global agreement of events, sections and bar phase.
  const refDownbeats = reference.beats.filter((b) => b.downbeat && b.timeMs >= intervalStartMs && b.timeMs < intervalEndMs).map((b) => rPos(b.timeMs) - bStart);
  const repDownbeatBeats = replacement.beats.filter((b) => b.downbeat).map((b) => pPos(b.timeMs));
  const refMid = refSegs.filter((s) => s.endMs > intervalStartMs && s.startMs < intervalEndMs);
  const scoreStart = (k0: number) => {
    let s = 0;
    for (const a of linked) {
      const want = k0 + rPos(a.timeMs) - bStart;
      let best = 0;
      for (const j of near(want, 0.35)) best = Math.max(best, typeSimilarity(a.kind, target[j].kind) * Math.exp(-Math.abs(targetBeats[j] - want) / 0.15));
      s += best * (0.5 + 0.5 * a.strength);
    }
    for (const seg of refMid) {
      const mid = (Math.max(seg.startMs, intervalStartMs) + Math.min(seg.endMs, intervalEndMs)) / 2;
      const rep = segmentAt(repSegs, pTime(k0 + rPos(mid) - bStart));
      s -= 0.6 * labelCost(seg.label, rep.label);
    }
    for (const d of refDownbeats) if (repDownbeatBeats.some((x) => Math.abs(x - (k0 + d)) <= 0.25)) s += 0.3;
    return s;
  };
  let k0 = 0,
    bestStart = -Infinity;
  const maxStart = Math.max(0, repBeatsTotal - spanBeats);
  const stride = useBeats ? 1 : 0.02;
  for (let k = 0; k <= maxStart + 1e-9; k += stride) {
    const s = scoreStart(k);
    if (s > bestStart + 1e-9) [bestStart, k0] = [s, k];
  }

  // ---- 2. Control points in the beat domain: start, end, matched landmarks.
  const points: [number, number][] = [[bStart, k0]];
  const landmarks: StructuralAlignment["landmarks"] = [];
  const predict = (refBeat: number) => {
    const sorted = [...points].sort((x, y) => x[0] - y[0]);
    let lo = sorted[0];
    for (const p of sorted) if (p[0] <= refBeat) lo = p;
    const hi = sorted.find((p) => p[0] > refBeat);
    if (!hi) return lo[1] + (refBeat - lo[0]);
    return lo[1] + ((refBeat - lo[0]) * (hi[1] - lo[1])) / Math.max(1e-6, hi[0] - lo[0]);
  };
  const monotonicWith = (rb: number, pb: number) => points.every(([r, p]) => (r < rb ? p < pb : r > rb ? p > pb : true));
  for (const a of graph.anchors.filter((x) => landmarkKinds.includes(x.kind) && x.timeMs > intervalStartMs + 100 && x.timeMs < intervalEndMs).sort((x, y) => x.timeMs - y.timeMs)) {
    const rb = rPos(a.timeMs),
      want = predict(rb);
    const cand = near(want, 4)
      .filter((j) => target[j].kind === a.kind)
      .sort((x, y) => Math.abs(targetBeats[x] - want) - Math.abs(targetBeats[y] - want))[0];
    if (cand !== undefined && monotonicWith(rb, targetBeats[cand])) {
      points.push([rb, targetBeats[cand]]);
      landmarks.push({ kind: a.kind, refMs: a.timeMs, repMs: target[cand].timeMs });
    }
  }

  // ---- 3. Events: order-preserving dynamic programme over linked anchors.
  const reasonsFor = (a: (typeof linked)[number], j: number, want: number): Reasons => {
    // Same section: the candidate lies in the replacement section the map predicts for this
    // event (crossing into another section costs, scaled by how different its label is).
    const refSeg = segmentAt(refSegs, a.timeMs),
      predicted = segmentAt(repSegs, pTime(want)),
      repSeg = segmentAt(repSegs, target[j].timeMs);
    const sectionSim = repSeg === predicted ? 1 : 0.5 * (1 - labelCost(refSeg.label, repSeg.label));
    const rb = R.barPosition(rPos(a.timeMs)),
      pb = P.barPosition(targetBeats[j] * scale);
    const phase = rb && pb ? 1 - Math.min(Math.abs(rb.beatInBar - pb.beatInBar), 4 - Math.abs(rb.beatInBar - pb.beatInBar)) / 2 : 0.5;
    return {
      type: Number(typeSimilarity(a.kind, target[j].kind).toFixed(2)),
      section: Number(sectionSim.toFixed(2)),
      phrase: Number(Math.max(0, phase).toFixed(2)),
      strength: Number((1 - Math.abs(a.strength - target[j].strength)).toFixed(2)),
      position: Number(Math.exp(-Math.abs(targetBeats[j] - want) / 0.3).toFixed(2)),
    };
  };
  const costOf = (r: Reasons) => 1.0 * (1 - r.type) + 0.4 * (1 - r.section) + 0.3 * (1 - r.phrase) + 0.2 * (1 - r.strength) + 0.8 * (1 - r.position);
  const SKIP = 1.1;
  type State = { cost: number; last: number; prev: State | null; pick: number | null; reasons?: Reasons };
  let states: State[] = [{ cost: 0, last: -Infinity, prev: null, pick: null }];
  for (const a of linked) {
    const want = predict(rPos(a.timeMs));
    const options = near(want, 0.75).map((j) => ({ j, reasons: reasonsFor(a, j, want) }));
    const next: State[] = [];
    // Skip: keep the best predecessor per distinct last time.
    for (const s of states) next.push({ cost: s.cost + SKIP, last: s.last, prev: s, pick: null });
    for (const o of options) {
      const c = costOf(o.reasons);
      let best: State | null = null;
      for (const s of states) if (target[o.j].timeMs > s.last && (!best || s.cost < best.cost)) best = s;
      if (best) next.push({ cost: best.cost + c, last: target[o.j].timeMs, prev: best, pick: o.j, reasons: o.reasons });
    }
    // Prune: the cheapest state per last time.
    const byLast = new Map<number, State>();
    for (const s of next) if (!byLast.has(s.last) || byLast.get(s.last)!.cost > s.cost) byLast.set(s.last, s);
    states = [...byLast.values()].sort((x, y) => x.cost - y.cost).slice(0, 64);
  }
  const path: State[] = [];
  for (let s: State | null = states.sort((x, y) => x.cost - y.cost)[0] ?? null; s && s.prev; s = s.prev) path.unshift(s);
  const events: MappedEvent[] = linked.map((a, i) => {
    const s = path[i];
    if (!s || s.pick === null) return { anchorId: a.id, kind: a.kind, refMs: a.timeMs, confidence: 0, status: "unmatched" };
    const conf = Math.max(0, Math.min(1, 1 - costOf(s.reasons!) / 1.6));
    return { anchorId: a.id, kind: a.kind, refMs: a.timeMs, repMs: target[s.pick].timeMs, repKind: target[s.pick].kind, reasons: s.reasons, confidence: Number(conf.toFixed(2)), status: "mapped" };
  });
  for (const e of events) if (e.status === "mapped" && monotonicWith(rPos(e.refMs), pPos(e.repMs!))) points.push([rPos(e.refMs), pPos(e.repMs!)]);
  points.sort((x, y) => x[0] - y[0]);
  const map = (refMs: number) => pTime(predict(rPos(refMs)));
  const offsetMs = Math.round(map(intervalStartMs));

  // ---- 4. Constraints: each visual event at its mapped anchor plus the measured offset.
  const mapped = new Map(events.filter((e) => e.status === "mapped").map((e) => [e.anchorId, e]));
  const refPeriod = (ms: number) => (useBeats ? R.periodAt(ms) : 500),
    repPeriod = (ms: number) => (useBeats ? P.periodAt(ms) * scale : 500);
  const moves: VisualMove[] = graph.links
    .filter((l) => {
      const v = visualById.get(l.visualId);
      return v && v.timeMs >= intervalStartMs && v.timeMs <= intervalEndMs;
    })
    .map((l): VisualMove => {
      const v = visualById.get(l.visualId)!;
      const m = l.anchorId ? mapped.get(l.anchorId) : undefined;
      let repMs: number,
        status: VisualMove["status"];
      if (m && l.relation !== "offbeat") {
        // Small offsets are kept in milliseconds (a title 80 ms before a hit); longer ones are
        // musical (two beats before a drop) and scale with the replacement's beat length.
        const off = Math.abs(l.offsetMs) <= 120 ? l.offsetMs : (l.offsetMs / refPeriod(m.refMs)) * repPeriod(m.repMs!);
        repMs = m.repMs! + off;
        status = "anchored";
      } else {
        repMs = map(v.timeMs);
        status = l.anchorId && l.relation !== "offbeat" ? "no-replacement" : "free";
      }
      return {
        visualId: v.id,
        visualKind: v.kind,
        fromMs: v.timeMs,
        toMs: Math.round(intervalStartMs + repMs - offsetMs),
        ...(l.anchorId ? { anchor: String(l.inferred.anchor) } : {}),
        ...(m ? { replacement: m.repKind, reasons: m.reasons } : {}),
        relation: l.relation,
        offsetMs: l.offsetMs,
        confidence: m ? m.confidence : 0,
        status,
      };
    })
    .sort((a, b) => a.fromMs - b.fromMs);
  // No event may move before an earlier one.
  for (let i = 1; i < moves.length; i++) {
    if (moves[i].fromMs === moves[i - 1].fromMs) moves[i].toMs = Math.max(moves[i].toMs, moves[i - 1].toMs);
    else if (moves[i].toMs <= moves[i - 1].toMs) moves[i].toMs = moves[i - 1].toMs + 1;
  }
  const sections = refMid.map((seg) => {
    const mid = (Math.max(seg.startMs, intervalStartMs) + Math.min(seg.endMs, intervalEndMs)) / 2;
    const rep = segmentAt(repSegs, map(mid));
    return { ref: { label: seg.label, startMs: seg.startMs, endMs: seg.endMs }, rep: { label: rep.label, startMs: rep.startMs, endMs: rep.endMs }, cost: Number(labelCost(seg.label, rep.label).toFixed(2)) };
  });
  const spanMs = Math.round(map(intervalEndMs) - offsetMs);
  const repBeat = useBeats ? P.medianPeriod * scale : 500,
    refBeat = useBeats ? R.medianPeriod : 500;
  return {
    method: useBeats ? "beats" : "time",
    offsetMs,
    spanMs,
    beatRatio: Number((repBeat / Math.max(1, refBeat)).toFixed(3)),
    sections,
    landmarks,
    events,
    moves,
    score: Number(bestStart.toFixed(3)),
    map,
  };
}
