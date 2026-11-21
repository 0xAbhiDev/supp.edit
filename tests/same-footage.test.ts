import { describe, expect, it } from "vitest";
import { identityProbes, matchIdentity, mergeIdentity, type IdentityHit, type SourceIdentity } from "../packages/ai/reference/identity";

// One reference shot 1000–3000 ms; its five probes.
const shots = [{ startMs: 1000, endMs: 3000 }];
const probes = identityProbes(shots);
/** Hits for every probe of the shot, at source times start + (ref - 1000) * speed + offset. */
const hits = (start: number, score: number, motion: number | null, speed = 1): IdentityHit[] =>
  probes.map((p, i) => {
    const t = Math.round(start + (p.refMs - 1000) * speed);
    return { probe: i, sourceMs: t, score, second: score - 0.004, rect: [0.1, 0, 0.8, 1], motion, peaks: [[t, score, motion], [t + 900, score - 0.004, motion === null ? null : -0.2]] };
  });
const clip = (id: string, identity: SourceIdentity | undefined, durationMs = 20_000) => ({ id, durationMs, identity });
const measured = (h: IdentityHit[]): SourceIdentity => ({ probes, hits: h, windows: [{ startMs: 0, endMs: 20_000 }] });

describe("same-footage identity", () => {
  it("probes a shot at five frames clear of its ends and of transitions", () => {
    expect(probes.map((p) => p.refMs)).toEqual([1160, 1500, 2000, 2500, 2840]);
    const around = identityProbes(shots, [{ startMs: 1900, endMs: 2100 }]);
    expect(around.every((p) => p.refMs < 1840 || p.refMs > 2160)).toBe(true);
    expect(identityProbes([{ startMs: 0, endMs: 600 }]).length).toBe(1);
  });
  it("finds the shot in the clip whose frames match and move like the reference", () => {
    const m = matchIdentity(0, 1000, 3000, [clip("look-alike", measured(hits(4000, 0.9, 0.2))), clip("source", measured(hits(7300, 0.99, 0.9)))]);
    expect(m?.sourceId).toBe("source");
    expect(m?.inMs).toBe(7300);
    expect(m?.outMs).toBe(9300);
    expect(m?.margin).toBeCloseTo(0.09, 3);
    expect(m?.points.length).toBe(5);
  });
  it("rejects a frozen copy of the frame and footage that only looks alike", () => {
    // Right picture, held still: it does not move like the reference.
    expect(matchIdentity(0, 1000, 3000, [clip("held", measured(hits(500, 0.995, 0)))])).toBeNull();
    // Moves alike but correlates below the bar (another gym, another beach).
    expect(matchIdentity(0, 1000, 3000, [clip("similar", measured(hits(500, 0.6, 0.9)))])).toBeNull();
    // Two clips equally good: no clip is established.
    expect(matchIdentity(0, 1000, 3000, [clip("a", measured(hits(500, 0.97, 0.9))), clip("b", measured(hits(900, 0.96, 0.9)))])).toBeNull();
  });
  it("keeps a still reference shot (no movement to compare) to appearance", () => {
    const m = matchIdentity(0, 1000, 3000, [clip("still", measured(hits(10_000, 0.98, null)))]);
    expect(m?.sourceId).toBe("still");
    expect(m?.motion).toBeNull();
  });
  it("reports the measured speed when the reference is retimed", () => {
    const m = matchIdentity(0, 1000, 3000, [clip("source", measured(hits(2000, 0.99, 0.9, 1.1)))]);
    expect(m?.speed).toBeCloseTo(1.1, 2);
  });
  it("merges two measurements of one clip, keeping the stronger match per probe", () => {
    const a = measured(hits(2000, 0.9, 0.8)),
      b = measured(hits(6000, 0.99, 0.9));
    const merged = mergeIdentity(a, b);
    expect(merged.hits[0].sourceMs).toBe(6160);
    expect(merged.hits[0].peaks.some((p) => p[0] === 2160)).toBe(true);
    expect(merged.windows.length).toBe(2);
  });
});
