import { describe, expect, it } from "vitest";
import { classifySourceText, textSimilarity, unrelatedTextPenalty, type SourceTextWindow } from "../packages/ai/reference/source-text";

const region = (text: string, x: number, y: number, width: number, height: number, burned = true, frames = 3) => ({ text, x, y, width, height, frames, sampled: 3, drift: 0, confidence: burned ? 0.95 : 0.55, likelyBurnedIn: burned });
const label = region("BENCH PRESS", 0.6, 0.69, 0.3, 0.07);
const window = (regions: SourceTextWindow["regions"]): SourceTextWindow[] => [{ startMs: 1000, endMs: 2500, regions }];
const title = { content: "BENCH PRESS", x: 0.6, y: 0.7, width: 0.3, height: 0.06 };

describe("text burned into the raw footage", () => {
  it("finds the reference's own words already in the source (keep them, add no duplicate)", () => {
    const v = classifySourceText(window([label]), 1200, 2300, [title]);
    expect(v.status).toBe("equivalent");
    expect(v.equivalent[0].reference).toBe(title);
    expect(textSimilarity("INCLINEPRESS", "Incline Press")).toBe(1);
  });
  it("separates unrelated text, a measured absence, passing text and an unmeasured window", () => {
    expect(classifySourceText(window([label]), 1200, 2300, [{ ...title, content: "TRAIN HARD" }]).status).toBe("unrelated");
    expect(classifySourceText(window([]), 1200, 2300, [title]).status).toBe("absent");
    expect(classifySourceText(window([region("OPEN", 0.1, 0.2, 0.1, 0.05, false, 1)]), 1200, 2300, []).status).toBe("uncertain");
    // Nothing was read here: unmeasured, never "clean".
    expect(classifySourceText(window([label]), 6000, 7000, [title]).status).toBe("unmeasured");
  });
  it("penalises large, central text under a title and spares a small corner watermark", () => {
    const big = unrelatedTextPenalty([region("SALE 50%", 0.3, 0.4, 0.4, 0.15)], [{ content: "NEW", x: 0.35, y: 0.42, width: 0.3, height: 0.1 }]);
    const watermark = unrelatedTextPenalty([region("@brand", 0.88, 0.94, 0.08, 0.03)], []);
    expect(big).toBeGreaterThan(0.06);
    expect(watermark).toBeLessThan(0.006);
    expect(big).toBeLessThanOrEqual(0.08);
  });
});

import { cameraSignature, cameraSimilarity } from "../packages/ai/reference/camera-signature";
import { actionSignature, actionSimilarity } from "../packages/ai/reference/action-signature";
import { sceneSimilarity, type SceneSignature } from "../packages/ai/reference/scene-signature";
import type { VisualFrame } from "../packages/ai/reference/visual";

/** Frames at 30 fps with a given camera flow per frame, a level of change, and a layout. */
const frames = (count: number, at: (k: number) => { fineX?: number; fineY?: number; fineZoom?: number; change?: number; confidence?: number }) =>
  Array.from({ length: count }, (_, k) => {
    const f = at(k);
    return {
      timeMs: Math.round((k * 1000) / 30),
      luma: 0.4,
      contrast: 0.2,
      saturation: 0.2,
      temperature: 0,
      sharpness: 0.15,
      change: f.change ?? 0.004,
      whiteFraction: 0,
      blackFraction: 0,
      layout: Array.from({ length: 16 }, (_, j) => 0.4 + 0.02 * Math.sin(j + k * 0.05)),
      flow: { panX: 0, panY: 0, expansion: 0, confidence: f.confidence ?? 0.9, fineX: f.fineX ?? 0, fineY: f.fineY ?? 0, fineZoom: f.fineZoom ?? 0 },
    } as VisualFrame;
  });

describe("camera language: a shared camera signature", () => {
  it("reads a slow pan, a still camera, a push-in and an unreliable estimate", () => {
    expect(cameraSignature(frames(60, () => ({ fineX: 0.3 })), 0, 2000)?.kind).toBe("pan");
    expect(cameraSignature(frames(60, () => ({ fineY: -0.3 })), 0, 2000)?.kind).toBe("tilt");
    expect(cameraSignature(frames(60, () => ({})), 0, 2000)?.kind).toBe("static");
    expect(cameraSignature(frames(60, () => ({ fineZoom: 0.004 })), 0, 2000)?.kind).toBe("push-in");
    expect(cameraSignature(frames(60, () => ({ fineX: 0.3, confidence: 0.2 })), 0, 2000)?.kind).toBe("uncertain");
  });
  it("orders matches: the same pan, then the opposite pan, then a still camera; uncertainty is neutral", () => {
    const pan = cameraSignature(frames(60, () => ({ fineX: 0.3 })), 0, 2000)!;
    const same = cameraSimilarity(pan, cameraSignature(frames(60, () => ({ fineX: 0.25 })), 0, 2000)!);
    const opposite = cameraSimilarity(pan, cameraSignature(frames(60, () => ({ fineX: -0.3 })), 0, 2000)!);
    const still = cameraSimilarity(pan, cameraSignature(frames(60, () => ({})), 0, 2000)!);
    const unsure = cameraSimilarity(pan, cameraSignature(frames(60, () => ({ fineX: 0.3, confidence: 0.2 })), 0, 2000)!);
    expect(same).toBeGreaterThan(opposite);
    expect(opposite).toBeGreaterThan(still);
    expect(unsure).toBe(0.5);
  });
  it("lets the camera decide a camera-driven shot: a matching pan beats a still scene that changes as much", () => {
    const ref = actionSignature(frames(60, () => ({ fineX: 0.3, change: 0.004 })), undefined, 0, 2000, 16 / 9)!;
    const pan = actionSignature(frames(60, () => ({ fineX: 0.28, change: 0.004 })), undefined, 0, 2000, 16 / 9)!;
    const still = actionSignature(frames(60, () => ({ change: 0.004 })), undefined, 0, 2000, 16 / 9)!;
    expect(ref.cameraPath?.kind).toBe("pan");
    expect(actionSimilarity(ref, pan).overall).toBeGreaterThan(actionSimilarity(ref, still).overall + 0.25);
  });
});

describe("still shots are told apart by what they show", () => {
  const base = (edges: number[]): SceneSignature => ({ structure: Array.from({ length: 16 }, (_, j) => (j % 5) / 5 - 0.4), rows: [0.1, 0.4, -0.2, -0.3], horizon: 0.5, localized: 0.2, camera: 0, level: 0, subjectSize: null, edges, role: "object detail" });
  // A centred object (edges around the middle) against a hand at the lower left.
  const centred = Array.from({ length: 64 }, (_, k) => ([2, 3, 4, 5].includes(k % 8) && [2, 3, 4, 5].includes(Math.floor(k / 8)) ? 1 / 16 : 0));
  const lowerLeft = Array.from({ length: 64 }, (_, k) => ([0, 1, 2].includes(k % 8) && [5, 6, 7].includes(Math.floor(k / 8)) ? 1 / 9 : 0));
  it("prefers the picture with the same structure when the brightness layout cannot tell", () => {
    const ref = base(centred);
    expect(sceneSimilarity(ref, base(centred)).overall).toBeGreaterThan(sceneSimilarity(ref, base(lowerLeft)).overall + 0.1);
    // Without the edge layout the two are indistinguishable (the brightness layout is the same).
    const { edges: _e, ...plain } = ref;
    expect(sceneSimilarity(plain, { ...plain }).overall).toBe(sceneSimilarity(plain, { ...base(lowerLeft), edges: undefined }).overall);
  });
});

describe("activity envelopes compare when a shot is active", () => {
  const busy = (k: number) => ({ change: 0.012 + 0.006 * Math.sin(k / 2) });
  const idle = () => ({ change: 0.00005 });
  it("rejects an interval that goes idle halfway when the reference stays active", () => {
    const ref = actionSignature(frames(60, busy), undefined, 0, 2000, 16 / 9)!;
    const active = actionSignature(frames(60, (k) => busy(k + 7)), undefined, 0, 2000, 16 / 9)!;
    const idleTail = actionSignature(frames(60, (k) => (k < 30 ? busy(k) : idle())), undefined, 0, 2000, 16 / 9)!;
    expect(actionSimilarity(ref, active).envelope!).toBeGreaterThan(actionSimilarity(ref, idleTail).envelope! + 0.3);
  });
  it("keeps an intentional hold: a reference that moves into a hold matches a source that does the same", () => {
    const ref = actionSignature(frames(60, (k) => (k < 30 ? busy(k) : idle())), undefined, 0, 2000, 16 / 9)!;
    const sameHold = actionSignature(frames(60, (k) => (k < 28 ? busy(k + 3) : idle())), undefined, 0, 2000, 16 / 9)!;
    const allActive = actionSignature(frames(60, busy), undefined, 0, 2000, 16 / 9)!;
    expect(actionSimilarity(ref, sameHold).envelope!).toBeGreaterThan(actionSimilarity(ref, allActive).envelope!);
  });
});

import { effectLevel, ownRelation, placeSound, synthShape } from "../packages/ai/reference/audio-structure";

describe("recreated effects keep their own level relative to the music", () => {
  // 4.2: the effect's own level over the bed is reproduced (the bed's share of the reference mix
  // peak removed); a beat of the replacement music where it lands is the music's, not the
  // effect's. The 4.1 model lowered the effect for that beat and left impacts and risers 3–6 dB
  // under the reference in the controlled measurement (scripts/measure-effect-placement.mjs).
  it("reproduces the effect's own relation, whatever the music does where it lands", () => {
    const own = ownRelation(9);
    for (const musicAtEventDb of [-24, -18]) {
      const l = effectLevel({ bedDb: -24, musicAtEventDb, relativeDb: 9, musicGainDb: -12 });
      expect(l.effectDb).toBeCloseTo(-36 + own, 1);
      expect(l.note).toBeUndefined();
    }
    expect(own).toBeCloseTo(8.4, 1);
    expect(ownRelation(0)).toBe(-12);
  });
  it("warns when the replacement music is louder than the effect where it lands", () => {
    const l = effectLevel({ bedDb: -24, musicAtEventDb: -10, relativeDb: 9, musicGainDb: -12 });
    expect(l.effectDb).toBeCloseTo(-36 + ownRelation(9), 1);
    expect(l.note).toMatch(/louder than the effect where it lands/);
  });
  it("falls back to a stated music level when the bed is silent", () => {
    const l = effectLevel({ bedDb: -90, musicAtEventDb: -90, relativeDb: 15, musicGainDb: -12 });
    expect(l.effectDb).toBeCloseTo(-32 + ownRelation(15), 1);
    expect(l.note).toMatch(/no measurable music bed/);
  });
});

describe("generated rising sounds land on the reference's moment", () => {
  const frames = (ms: number) => Math.round((ms * 30) / 1000);
  it("puts a whoosh's own peak, not its end, on the landing, with its lead-in before it", () => {
    const shape = synthShape("whoosh");
    expect(shape.peakMs).toBeGreaterThan(400);
    expect(shape.peakMs).toBeLessThan(600);
    const placed = placeSound({ kind: "whoosh", startMs: 6700, durationMs: 600, sourceInMs: shape.peakMs - 300, landingMs: 7000, gainDb: -20, relativeGainDb: 9, attackMs: 300, releaseMs: 300, reason: "" }, 1000, 30, frames, 1000)!;
    // The asset's peak plays at: start + (peak − source in).
    const peakFrame = placed.at + frames(shape.peakMs) - placed.sourceIn;
    expect(Math.abs(peakFrame - frames(7000))).toBeLessThanOrEqual(1);
  });
  it("never fades a riser out before its climax", () => {
    const shape = synthShape("riser");
    const placed = placeSound({ kind: "riser", startMs: 5000, durationMs: 2000, sourceInMs: shape.peakMs - 2000, landingMs: 7000, gainDb: -18, relativeGainDb: 9, attackMs: 2000, releaseMs: 3000, reason: "" }, 4000, 30, frames, 1000)!;
    expect(placed.keys.every(([, db]) => db === -18)).toBe(true);
    // With a measured shortfall in rise depth, a ramp into the landing; still no fade before it.
    const ramped = placeSound({ kind: "riser", startMs: 5000, durationMs: 2000, sourceInMs: shape.peakMs - 2000, landingMs: 7000, gainDb: -18, startGainDb: -30, relativeGainDb: 9, attackMs: 2000, releaseMs: 3000, reason: "" }, 4000, 30, frames, 1000)!;
    expect(ramped.keys[0]).toEqual([frames(5000), -30]);
    expect(ramped.keys.at(-1)![1]).toBe(-18);
  });
  it("lands on the landing moment at its own speed when the edit's clock is warped", () => {
    // The reference clock runs 2.5× slower on this timeline around the riser (recreated audio).
    const warped = (ms: number) => Math.round(((ms <= 6600 ? ms : 6600 + (ms - 6600) * 2.5) * 30) / 1000);
    const shape = synthShape("riser");
    const placed = placeSound({ kind: "riser", startMs: 6600, durationMs: 400, sourceInMs: shape.peakMs - 400, landingMs: 7000, gainDb: -18, relativeGainDb: 9, attackMs: 400, releaseMs: 3000, reason: "" }, 4000, 30, warped, 1000)!;
    // It ends at its landing (its peak), not 0.6 s early, and plays 0.4 s, not a stretched 1 s.
    expect(placed.at + placed.duration).toBeGreaterThanOrEqual(warped(7000) - 1);
    expect(placed.at + placed.duration).toBeLessThanOrEqual(warped(7000) + 1);
    expect(placed.duration).toBe(12);
  });
  it("keeps the measured attack and release for a hit", () => {
    const placed = placeSound({ kind: "impact", startMs: 7000, durationMs: 1200, gainDb: -20, relativeGainDb: 9, attackMs: 70, releaseMs: 600, reason: "" }, 1400, 30, frames, 1000)!;
    expect(placed.keys[0]).toEqual([frames(7000), -40]);
    expect(placed.keys.at(-1)![1]).toBe(-40);
  });
});

import { whipAt } from "../packages/ai/reference/cuts";

describe("whips are told from hard cuts and from pans", () => {
  // A 4×4 brightness layout whose columns can be rolled sideways by whole or partial columns.
  const columns = [0.2, 0.45, 0.7, 0.35];
  const layoutAt = (offset: number) => Array.from({ length: 16 }, (_, j) => {
    const col = (j % 4) + offset;
    const lo = Math.floor(col),
      f = col - lo;
    const v = (c: number) => columns[((c % 4) + 4) % 4] + 0.05 * Math.floor(j / 4);
    return v(lo) * (1 - f) + v(lo + 1) * f;
  });
  const frame = (k: number, offset: number, change: number) => ({ timeMs: Math.round((k * 1000) / 30), luma: 0.4, contrast: 0.2, saturation: 0.2, temperature: 0, sharpness: 0.12, change, whiteFraction: 0, blackFraction: 0, layout: layoutAt(offset), flow: { panX: 0, panY: 0, expansion: 0, confidence: 0.2 } }) as VisualFrame;
  const build = (offsets: number[]) => offsets.map((o, k) => frame(k, o, k && Math.abs(o - offsets[k - 1]) > 0.01 ? 0.08 : 0.001));
  it("finds a six-frame sweep across the boundary, with its direction and span", () => {
    // Steady, then the picture sweeps one column per frame (content moving left), then steady.
    const f = build([...Array(30).fill(0), 1, 2, 3, 4, 5, 6, ...Array(30).fill(6)]);
    const w = whipAt(f, f[33].timeMs)!;
    expect(w.direction).toBe("left");
    expect(w.travel).toBeGreaterThanOrEqual(1);
    expect(w.startMs).toBeLessThanOrEqual(f[30].timeMs);
    expect(w.endMs).toBe(f[35].timeMs);
  });
  it("is not a hard cut (one frame) nor a continuous pan (no steady sides)", () => {
    const cut = build([...Array(30).fill(0), ...Array(30).fill(2)]);
    expect(whipAt(cut, cut[30].timeMs)).toBeUndefined();
    const pan = build(Array.from({ length: 60 }, (_, k) => k * 0.5));
    expect(whipAt(pan, pan[30].timeMs)).toBeUndefined();
  });
});

import { matchingCurve, MAX_CURVE_SLOPE } from "../packages/effects/curves";

describe("matched tone curves cannot band smooth gradients", () => {
  const slopes = (pts: [number, number][]) => pts.slice(1).map(([x, y], i) => (y - pts[i][1]) / Math.max(1e-6, x - pts[i][0]));
  it("caps a near-vertical segment from a source level cluster, and leaves an ordinary grade alone", () => {
    // Source highlights clustered (178 and 191) mapped onto far-apart target levels (115 and 204).
    const steep = matchingCurve([20, 64, 110, 178, 191], [8, 51, 87, 115, 204]);
    expect(Math.max(...slopes(steep))).toBeLessThanOrEqual(MAX_CURVE_SLOPE + 1e-6);
    const gentle = matchingCurve([20, 64, 110, 160, 220], [26, 72, 120, 168, 226]);
    expect(gentle.slice(1, -1)).toEqual([20, 64, 110, 160, 220].map((s, i) => [Number((s / 255).toFixed(4)), Number(([26, 72, 120, 168, 226][i] / 255).toFixed(4))]));
  });
});
