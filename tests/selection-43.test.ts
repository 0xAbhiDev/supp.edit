import { describe, expect, it } from "vitest";
import { actionSignature, effectSpans } from "../packages/ai/reference/action-signature";
import type { VisualFrame } from "../packages/ai/reference/visual";
import { plannedRange, sourceFramesPlayed } from "../packages/ai/reference/planner";
import { consumeRange } from "../packages/ai/reference/matcher";

// A steady movement (per-frame change 0.006) with two colour pulses: each pulse changes the whole
// frame (0.37) and changes it back on the next frame.
const layout = (k: number) => Array.from({ length: 16 }, (_, j) => 0.3 + 0.02 * Math.sin(k / 3 + j));
const frame = (k: number, change: number) =>
  ({ timeMs: Math.round((k * 1000) / 30), luma: 0.2, contrast: 0.2, saturation: 0.2, temperature: 0, sharpness: 0.2, change, whiteFraction: 0, blackFraction: 0, layout: layout(k), flow: { panX: 0, panY: 0, expansion: 0, confidence: 0.2 } }) as VisualFrame;
const pulses = [
  { startMs: 1000, endMs: 1067 },
  { startMs: 1500, endMs: 1567 },
];
const frames = Array.from({ length: 90 }, (_, k) => {
  const t = Math.round((k * 1000) / 30);
  const onset = pulses.some((p) => t === p.startMs),
    back = pulses.some((p) => t === p.endMs);
  return frame(k, onset || back ? 0.37 : 0.006);
});

describe("a reference shot's own movement, without the edit's effects", () => {
  it("leaves colour pulses and the frame returning from each out of the movement level", () => {
    const raw = actionSignature(frames, undefined, 0, 3000, 16 / 9)!;
    const clean = actionSignature(frames, undefined, 0, 3000, 16 / 9, effectSpans({ colorPulses: pulses }))!;
    expect(raw.level).toBeGreaterThan(0.02);
    expect(clean.level).toBeCloseTo(0.006, 4);
  });

  it("takes spans from colour pulses and person flashes, each with the frame returning from it", () => {
    const spans = effectSpans({
      colorPulses: [{ startMs: 1000, endMs: 1067 }],
      personFlashes: [{ startMs: 2000, endMs: 2100 }],
    });
    expect(spans).toEqual([
      { startMs: 1000, endMs: 1101 },
      { startMs: 2000, endMs: 2134 },
    ]);
  });

  it("measures nothing differently when the reference has no effects", () => {
    const steady = frames.map((f) => ({ ...f, change: 0.006 }));
    expect(actionSignature(steady, undefined, 0, 3000, 16 / 9, effectSpans({}))).toEqual(actionSignature(steady, undefined, 0, 3000, 16 / 9));
  });
});

describe("the planner keeps the moments its plan chose", () => {
  const range = (id: string, first: number, end: number) => ({ source: { asset: { id } }, first, end });
  it("places a pick that starts up to two frames before a range at the range, not elsewhere", () => {
    // A scene starting at 36 ms is frame 2 in the pool; the plan's stretch starts at 40 ms (frame 1).
    const pool = [range("squat", 2, 466)];
    expect(plannedRange(pool, "squat", 1, 152)).toEqual({ range: pool[0], first: 2 });
    expect(plannedRange(pool, "squat", 10, 152)).toEqual({ range: pool[0], first: 10 });
    // A pick reaching the clip's end one frame past the range's last frame (gym shot 4, transition
    // case shot 8) starts one frame earlier.
    expect(plannedRange([range("squat", 214, 466)], "squat", 346, 121)).toEqual({ range: { source: { asset: { id: "squat" } }, first: 214, end: 466 }, first: 345 });
    expect(plannedRange([range("cloudy", 217, 363)], "cloudy", 314, 50)?.first).toBe(313);
    // Three frames out is another moment: the local matcher decides.
    expect(plannedRange([range("squat", 4, 466)], "squat", 1, 152)).toBeUndefined();
    expect(plannedRange([range("squat", 214, 464)], "squat", 346, 121)).toBeUndefined();
    expect(plannedRange(pool, "deadlift", 2, 50)).toBeUndefined();
  });

  it("uses only the source frames a slowed shot plays, so the moment after it stays free", () => {
    // Street holdout: shot 2 slowed to ×0.851 plays 26.27–27.54 s; shot 6's plan starts at 27.57 s.
    const pool = [range("street-A", 0, 2460)];
    const first = Math.round(26.27 * 30),
      duration = 45;
    consumeRange(pool as never, pool[0] as never, first, sourceFramesPlayed(duration, 0.851));
    expect(plannedRange(pool, "street-A", Math.round(27.57 * 30), 39)).toBeDefined();
    // Consuming timeline frames (the old rule) blocked it.
    const old = [range("street-A", 0, 2460)];
    consumeRange(old as never, old[0] as never, first, duration);
    expect(plannedRange(old, "street-A", Math.round(27.57 * 30), 39)).toBeUndefined();
    expect(sourceFramesPlayed(45, 1)).toBe(45);
  });
});
