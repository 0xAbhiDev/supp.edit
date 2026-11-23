import { describe, expect, it } from "vitest";
import { planSequence, type Option } from "../packages/ai/reference/sequence-planner";
import type { ShotRequirement } from "../packages/ai/reference/footage-index";

// One 20 s clip cut into 2 s windows; four 4 s shots that all score best on the same few seconds.
const window = (inMs: number, score: number): Option =>
  ({
    c: { sourceId: "raw", startMs: inMs, endMs: inMs + 4000, sceneStartMs: 0, sceneEndMs: 20000, peakMs: inMs + 2000, kind: "action", motion: 0.01, quality: 1, qualityIssues: [], luma: 0.5, frozen: false },
    inMs,
    outMs: inMs + 4000,
    score,
  }) as unknown as Option;
const req = { durationMs: 4000, shot: { framing: null } } as unknown as ShotRequirement;

describe("spending footage when the reel is longer than it", () => {
  it("plays unused footage before replaying any moment", () => {
    // Every shot's best windows are 4–8 s; the rest of the clip scores lower and is not among them.
    const best = [window(4000, 0.9), window(6000, 0.85), window(5000, 0.8)];
    const rest = [0, 8000, 12000, 16000].map((ms) => window(ms, 0.4));
    const options = Array.from({ length: 4 }, () => [...best, ...rest]);
    const plan = planSequence([req, req, req, req], options, [], [-1, -1, -1, -1], 40, 3);
    const starts = plan.picks.map((p) => p.inMs);
    const overlaps = starts.flatMap((a, i) => starts.slice(i + 1).filter((b) => Math.abs(a - b) < 4000)).length;
    expect(overlaps).toBe(0);
    expect(plan.reuse.every((r) => r === null)).toBe(true);
  });

  it("when every moment is taken, reuses the one used least", () => {
    const options = Array.from({ length: 4 }, () => [window(0, 0.9), window(4000, 0.5)]);
    const plan = planSequence([req, req, req, req], options, [], [-1, -1, -1, -1], 40, 2);
    const starts = plan.picks.map((p) => p.inMs);
    // Two windows for four shots: each plays twice rather than the best one three times.
    expect(starts.filter((s) => s === 0).length).toBe(2);
    expect(starts.filter((s) => s === 4000).length).toBe(2);
  });
});
