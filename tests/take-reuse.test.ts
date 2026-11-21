import { describe, expect, it } from "vitest";
import { newProject } from "../packages/project-schema";
import { playedIntervals, reuseOf, type PlayedInterval } from "../packages/ai/reference/take-reuse";

const shot = (clipId: string, sourceId: string, inMs: number, outMs: number): PlayedInterval => ({ clipId, sourceId, inMs, outMs });
const others = [shot("s2", "clip-a", 10_000, 12_000), shot("s3", "clip-a", 40_000, 41_500), shot("s4", "clip-b", 5_000, 6_000)];

describe("alternative takes that repeat another shot's moment", () => {
  it("flags full and partial overlap with the shot it repeats", () => {
    expect(reuseOf({ sourceId: "clip-a", inMs: 10_000, outMs: 12_000 }, others)).toEqual([{ clipId: "s2", overlapMs: 2000, share: 1 }]);
    const partial = reuseOf({ sourceId: "clip-a", inMs: 11_400, outMs: 13_400 }, others);
    expect(partial.map((r) => r.clipId)).toEqual(["s2"]);
    expect(partial[0].overlapMs).toBe(600);
  });
  it("does not flag adjacent intervals, a sliver of overlap, or separate moments of one long clip", () => {
    expect(reuseOf({ sourceId: "clip-a", inMs: 12_000, outMs: 14_000 }, others)).toEqual([]);
    expect(reuseOf({ sourceId: "clip-a", inMs: 8_100, outMs: 10_100 }, others)).toEqual([]);
    expect(reuseOf({ sourceId: "clip-a", inMs: 20_000, outMs: 22_000 }, others)).toEqual([]);
    // Same time in another asset is another moment.
    expect(reuseOf({ sourceId: "clip-b", inMs: 10_000, outMs: 12_000 }, others)).toEqual([]);
  });
  it("counts a short overlap that is most of a short shot", () => {
    const r = reuseOf({ sourceId: "clip-b", inMs: 5_800, outMs: 6_100 }, others);
    expect(r[0]?.clipId).toBe("s4");
    expect(r[0].share).toBeCloseTo(0.67, 2);
  });
  it("reads each shot's played interval after trims and speed changes, from the current timeline", () => {
    const p = newProject("t", 1080, 1920);
    const comp = {
      id: "rec",
      name: "Recreation",
      settings: p.settings,
      duration: 300,
      background: "#000000",
      tracks: p.tracks,
      markers: [],
      layers: [
        { ...baseLayer("a", 0, 60), sourceIn: 300 },
        // Half speed for its whole length: 60 frames play 30 source frames.
        { ...baseLayer("b", 60, 60), sourceIn: 900, timeRemap: { sourceOffset: 0, keys: [{ frame: 0, speed: 0.5, easing: "smooth" as const }, { frame: 60, speed: 0.5, easing: "smooth" as const }] } },
      ],
    };
    const project = { ...p, compositions: [comp] } as unknown as Parameters<typeof playedIntervals>[0];
    const played = playedIntervals(project, "rec", new Set(["a", "b"]));
    expect(played[0]).toMatchObject({ clipId: "a", inMs: 10_000, outMs: 12_000 });
    expect(played[1].inMs).toBeCloseTo(30_000, 0);
    expect(played[1].outMs).toBeCloseTo(31_000, 0);
  });
});

function baseLayer(id: string, start: number, duration: number) {
  return { id, kind: "media" as const, name: id, assetId: "clip-a", trackId: "v1", start, duration, sourceIn: 0, effectStack: [], keyframes: {}, opacity: 1, blendMode: "normal" };
}
