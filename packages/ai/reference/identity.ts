/** Same-footage identity: when the reference was cut from the raw footage it is given with, each
 * reference shot's own frames are somewhere in those clips — regraded, zoomed or cropped, a
 * little faster or slower. The native matcher (`source_identity`) finds, per probe frame, where in
 * a clip the picture correlates best at any crop and zoom; this module turns probes into one
 * decision per shot.
 *
 *  - Probes: five frames per shot (8/25/50/75/92%; three under 1.2 s, one under 0.7 s), kept
 *    clear of the shot's ends and of measured transitions (a flash or dissolve is not the footage
 *    itself). The edge probes let a match vouch for continuity over nearly the whole shot.
 *  - A shot is the same footage as a clip when its probes agree on one timing (source times rise
 *    with the reference at a plausible speed), they correlate ≥ 0.85 on average, the clip beats
 *    every other clip by ≥ 0.05, and — where the reference picture moves — the source changes the
 *    same way over the next 200 ms (movement agreement ≥ 0.5). Footage that only looks alike
 *    (another gym, another beach) measured 0.35–0.6 on the supplied gym reel; true matches
 *    0.95–1. Appearance alone cannot tell the very frames from the same scene a moment later
 *    (another repetition, a held copy of a frame; both 0.9+): the movement test does.
 *  - When the timing inside the clip is ambiguous (a near-static picture, a repetition) the clip
 *    is still certain; the match says so (`timingMargin`).
 * Nothing here knows what the footage shows: no names, files, domains or expected answers. */
import { z } from "zod";
import type { Asset } from "../../project-schema";
import type { JobContext } from "../../jobs";

export const identityHitSchema = z
  .object({
    probe: z.number().int().nonnegative(),
    sourceMs: z.number().nonnegative(),
    score: z.number().min(-1.01).max(1.01),
    second: z.number().min(-1.01).max(1.01),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    motion: z.number().min(-1.01).max(1.01).nullable(),
    peaks: z.array(z.tuple([z.number().nonnegative(), z.number().min(-1.01).max(1.01), z.number().min(-1.01).max(1.01).nullable()])).max(16),
  })
  .strict();
export type IdentityHit = z.infer<typeof identityHitSchema>;
export interface IdentityProbe {
  shot: number;
  refMs: number;
}
/** What a source clip told the matcher about the reference's probes. */
export interface SourceIdentity {
  probes: IdentityProbe[];
  hits: IdentityHit[];
  /** Source windows searched (an unsearched moment is unmeasured, not a non-match). */
  windows: { startMs: number; endMs: number }[];
}
export interface IdentityMatch {
  sourceId: string;
  /** Source window that plays the shot at normal speed, aligned on the probes. */
  inMs: number;
  outMs: number;
  /** Mean probe correlation at the chosen timing. */
  score: number;
  /** Lead over the best other clip. */
  margin: number;
  /** Lead over the best other timing at least 600 ms away in the same clip (small = ambiguous;
   * 0 = identical frames, a still picture). */
  timingMargin: number;
  /** Source time where the shot's middle probe matched. */
  anchorMs: number;
  /** Measured speed of the reference against the source (1 = same speed), when probes allow. */
  speed: number | null;
  /** Where the reference's picture sits in the source frame (fractions x, y, w, h). */
  rect: [number, number, number, number];
  probes: number;
  /** Mean movement agreement of the probes that move (null: the reference picture is still). */
  motion: number | null;
  /** Each probe's match at the chosen timing. */
  points: { sourceMs: number; score: number; motion: number | null }[];
}

export const IDENTITY_VERSION = "3";
export const IDENTITY_MIN_SCORE = 0.85;
export const IDENTITY_MIN_MARGIN = 0.05;
export const IDENTITY_MIN_MOTION = 0.5;

/** Probe frames per reference shot. */
export function identityProbes(shots: { startMs: number; endMs: number }[], transitions: { startMs?: number; endMs?: number; cutMs?: number }[] = []): IdentityProbe[] {
  const spans = transitions.filter((t) => t.startMs !== undefined && t.endMs !== undefined && (t.endMs as number) > (t.startMs as number)).map((t) => [t.startMs as number, t.endMs as number]);
  const out: IdentityProbe[] = [];
  shots.forEach((s, shot) => {
    const lo = s.startMs + 120,
      hi = s.endMs - 120;
    if (hi <= lo) return;
    const length = s.endMs - s.startMs;
    const fractions = length < 700 ? [0.5] : length < 1200 ? [0.25, 0.5, 0.75] : [0.08, 0.25, 0.5, 0.75, 0.92];
    for (const f of fractions) {
      let at = Math.round(s.startMs + (s.endMs - s.startMs) * f);
      // Off any transition: move to the nearest clear moment inside the shot.
      const inside = spans.find(([a, b]) => at >= a - 60 && at <= b + 60);
      if (inside) at = at - inside[0] < inside[1] - at ? Math.round(inside[0] - 80) : Math.round(inside[1] + 80);
      if (at < lo || at > hi) continue;
      if (out.some((p) => p.shot === shot && Math.abs(p.refMs - at) < 120)) continue;
      out.push({ shot, refMs: at });
    }
  });
  return out;
}

const hashOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
};

/** Measure (or read from cache) where the probes come from in one source clip. */
export async function sourceIdentity(reference: Asset, source: Asset, probes: IdentityProbe[], windows: { startMs: number; endMs: number }[], job: JobContext): Promise<SourceIdentity> {
  const { readDerived, writeDerived } = await import("../../platform/derived");
  const grid = windows.map((w) => ({ startMs: Math.max(0, Math.round(w.startMs / 100) * 100), endMs: Math.round(w.endMs / 100) * 100 })).filter((w) => w.endMs > w.startMs);
  const key = `identity-v${IDENTITY_VERSION}:${reference.fingerprint}:${source.fingerprint}:${hashOf(JSON.stringify([probes.map((p) => p.refMs), grid]))}`;
  const cached = z.array(identityHitSchema).safeParse(await readDerived(key).catch(() => undefined));
  if (cached.success) return { probes, hits: cached.data, windows: grid };
  const { nativeJob } = await import("../media-analysis/service");
  const hits = z.array(identityHitSchema).parse(await nativeJob("source_identity", { reference: reference.path, probes: probes.map((p) => Math.round(p.refMs)), path: source.path, windows: grid }, job));
  await writeDerived(key, hits, JSON.stringify(hits).length * 2 + 256).catch(() => {});
  return { probes, hits, windows: grid };
}

interface Alignment {
  /** The chosen peak per probe: source time, correlation, movement agreement. */
  points: [number, number, number | null][];
  score: number;
  /** Mean movement agreement of the probes that move; null when none does. */
  motion: number | null;
  inMs: number;
  /** Source time of the middle probe's match. */
  anchorMs: number;
  speed: number | null;
  rect: [number, number, number, number];
  probes: number;
}

/** The best consistent timing of one shot's probes in one clip: every combination of their
 * peaks whose source times rise with the reference at 0.7–1.4× speed (±160 ms jitter allowed),
 * highest mean correlation first; plus the best one at least 600 ms away. */
function align(shotStartMs: number, mine: { probe: IdentityProbe; hit: IdentityHit }[]): { best: Alignment; other: number } | null {
  if (!mine.length) return null;
  const lists = mine.map((m) => (m.hit.peaks.length ? m.hit.peaks : [[m.hit.sourceMs, m.hit.score, m.hit.motion] as [number, number, number | null]]).slice(0, mine.length > 3 ? 4 : 6));
  const found: Alignment[] = [];
  const walk = (k: number, chosen: [number, number, number | null][]) => {
    if (k === lists.length) {
      const first = chosen[0],
        last = chosen.at(-1)!;
      const dRef = mine.at(-1)!.probe.refMs - mine[0].probe.refMs;
      const speed = dRef > 250 ? (last[0] - first[0]) / dRef : null;
      // Each probe implies a shot start; they must agree.
      const starts = chosen.map((c, i) => c[0] - (mine[i].probe.refMs - shotStartMs));
      const spread = Math.max(...starts) - Math.min(...starts);
      if (speed !== null && (speed < 0.7 || speed > 1.4) && spread > 320) return;
      if (spread > Math.max(320, 0.45 * dRef)) return;
      const middle = Math.floor(chosen.length / 2);
      const moving = chosen.map((c) => c[2]).filter((v): v is number => v !== null);
      found.push({
        points: chosen,
        score: chosen.reduce((s, c) => s + c[1], 0) / chosen.length,
        motion: moving.length ? moving.reduce((s, v) => s + v, 0) / moving.length : null,
        inMs: starts[middle],
        anchorMs: chosen[middle][0],
        speed: speed !== null && speed >= 0.7 && speed <= 1.4 ? Number(speed.toFixed(3)) : null,
        rect: mine[middle].hit.rect,
        probes: chosen.length,
      });
      return;
    }
    for (const p of lists[k]) walk(k + 1, [...chosen, p]);
  };
  walk(0, []);
  if (!found.length) {
    // No consistent timing: the single strongest probe still says which clip and where.
    const top = mine.reduce((a, b) => (b.hit.score > a.hit.score ? b : a));
    found.push({ points: [[top.hit.sourceMs, top.hit.score, top.hit.motion]], score: top.hit.score - 0.05, motion: top.hit.motion, inMs: top.hit.sourceMs - (top.probe.refMs - shotStartMs), anchorMs: top.hit.sourceMs, speed: null, rect: top.hit.rect, probes: 1 });
  }
  // The very frames move like the reference: among timings that look alike, the one that also
  // moves alike wins.
  const rank = (a: Alignment) => a.score + 0.3 * (a.motion ?? 0);
  found.sort((a, b) => rank(b) - rank(a));
  const best = found[0];
  const other = found.find((f) => Math.abs(f.inMs - best.inMs) >= 600)?.score ?? Math.max(-1, ...mine.map((m) => m.hit.second));
  return { best, other };
}

/** Decide whether reference shot `shot` is the same footage as one of the clips. */
export function matchIdentity(shot: number, startMs: number, endMs: number, sources: { id: string; durationMs: number; identity?: SourceIdentity }[]): IdentityMatch | null {
  const perSource = sources
    .map((s) => {
      if (!s.identity) return null;
      const mine = s.identity.probes
        .map((probe, i) => ({ probe, hit: s.identity!.hits.find((h) => h.probe === i) }))
        .filter((m): m is { probe: IdentityProbe; hit: IdentityHit } => m.probe.shot === shot && !!m.hit);
      const a = align(startMs, mine);
      return a && { id: s.id, durationMs: s.durationMs, ...a };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.best.score - a.best.score);
  // Same footage moves like the reference where the reference moves; a clip that only looks
  // like it (a held copy of a frame, another repetition) does not count.
  const candidates = perSource.filter((x) => x.best.motion === null || x.best.motion >= IDENTITY_MIN_MOTION);
  const top = candidates[0];
  if (!top || top.best.score < IDENTITY_MIN_SCORE) return null;
  const margin = top.best.score - (perSource.find((x) => x !== top)?.best.score ?? 0);
  if (margin < IDENTITY_MIN_MARGIN) return null;
  const length = endMs - startMs;
  const inMs = Math.max(0, Math.min(top.durationMs - length, top.best.inMs));
  return {
    sourceId: top.id,
    inMs: Math.round(inMs),
    outMs: Math.round(inMs + length),
    score: Number(top.best.score.toFixed(3)),
    margin: Number(margin.toFixed(3)),
    timingMargin: Number((top.best.score - top.other).toFixed(3)),
    anchorMs: Math.round(top.best.anchorMs),
    speed: top.best.speed,
    rect: top.best.rect,
    probes: top.best.probes,
    motion: top.best.motion === null ? null : Number(top.best.motion.toFixed(3)),
    points: top.best.points.map(([sourceMs, score, motion]) => ({ sourceMs, score, motion })),
  };
}

/** Two measurements of one clip (different windows): per probe the stronger match, with both
 * measurements' peaks. */
export function mergeIdentity(a: SourceIdentity | undefined, b: SourceIdentity): SourceIdentity {
  if (!a) return b;
  const hits: IdentityHit[] = [];
  for (let i = 0; i < b.probes.length; i++) {
    const x = a.hits.find((h) => h.probe === i),
      y = b.hits.find((h) => h.probe === i);
    if (!x || !y) {
      if (x ?? y) hits.push((x ?? y)!);
      continue;
    }
    const top = x.score >= y.score ? x : y;
    const peaks = [...x.peaks, ...y.peaks].sort((p, q) => q[1] - p[1]).filter((p, k, all) => all.findIndex((r) => Math.abs(r[0] - p[0]) < 300) === k).slice(0, 8);
    const second = Math.max(-1, ...peaks.filter((p) => Math.abs(p[0] - top.sourceMs) >= 600).map((p) => p[1]));
    hits.push({ ...top, peaks, second });
  }
  return { probes: b.probes, hits, windows: [...a.windows, ...b.windows] };
}
