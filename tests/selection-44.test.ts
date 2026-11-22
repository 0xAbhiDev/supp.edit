import { describe, expect, it } from "vitest";
import { bodyFit, bodyPresence, bodySignature, poseFeatures, type PoseSample } from "../packages/ai/reference/body-pose";
import { dissolveLeadIn } from "../packages/ai/reference/footage-index";

type V = [number, number, number];
/** A body from a few key joints (picture: x, y fractions; world: metres), all clearly visible. */
function body(timeMs: number, picture: Record<number, [number, number]>, world: Record<number, V>, aspect = 16 / 9): PoseSample {
  const points = Array.from({ length: 33 }, (_, i) => [...(picture[i] ?? [0.5, 0.5]), picture[i] ? 0.99 : 0.1] as V);
  const w = Array.from({ length: 33 }, (_, i) => world[i] ?? ([0, 0, 0] as V));
  return { timeMs, score: 0.95, aspect, points, world: w };
}
// Joint indices: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, ankles 27/28.
const standingWorld: Record<number, V> = {
  11: [-0.2, -0.5, 0], 12: [0.2, -0.5, 0], 13: [-0.22, -0.25, 0], 14: [0.22, -0.25, 0], 15: [-0.23, 0, 0], 16: [0.23, 0, 0],
  23: [-0.1, 0, 0], 24: [0.1, 0, 0], 25: [-0.1, 0.45, 0], 26: [0.1, 0.45, 0], 27: [-0.1, 0.9, 0], 28: [0.1, 0.9, 0],
};
const standingPicture: Record<number, [number, number]> = { 11: [0.45, 0.3], 12: [0.55, 0.3], 13: [0.44, 0.42], 14: [0.56, 0.42], 15: [0.44, 0.52], 16: [0.56, 0.52], 23: [0.47, 0.55], 24: [0.53, 0.55], 25: [0.47, 0.72], 26: [0.53, 0.72], 27: [0.47, 0.9], 28: [0.53, 0.9] };
// Lying on a bench pressing: torso horizontal in the picture, hips and knees bent, arms up.
const lyingWorld: Record<number, V> = {
  11: [-0.2, -0.5, 0], 12: [0.2, -0.5, 0], 13: [-0.25, -0.5, -0.25], 14: [0.25, -0.5, -0.25], 15: [-0.2, -0.5, -0.5], 16: [0.2, -0.5, -0.5],
  23: [-0.1, 0, 0], 24: [0.1, 0, 0], 25: [-0.1, 0.1, -0.4], 26: [0.1, 0.1, -0.4], 27: [-0.1, 0.5, -0.45], 28: [0.1, 0.5, -0.45],
};
const lyingPicture: Record<number, [number, number]> = { 11: [0.3, 0.55], 12: [0.3, 0.58], 13: [0.3, 0.45], 14: [0.3, 0.47], 15: [0.3, 0.35], 16: [0.3, 0.37], 23: [0.55, 0.55], 24: [0.55, 0.58], 25: [0.65, 0.45], 26: [0.65, 0.47], 27: [0.72, 0.6], 28: [0.72, 0.62] };
const clip = (world: Record<number, V>, picture: Record<number, [number, number]>, from = 0, to = 2000) => Array.from({ length: (to - from) / 200 }, (_, k) => body(from + k * 200, picture, world));

describe("what a body does, from its joints", () => {
  it("reads an upright body as upright and a body lying on a bench as lying", () => {
    const up = poseFeatures(body(0, standingPicture, standingWorld))!;
    const flat = poseFeatures(body(0, lyingPicture, lyingWorld))!;
    expect(up[8]!).toBeLessThan(0.1); // lean ≈ 0 (upright)
    expect(flat[8]!).toBeGreaterThan(0.4); // lean ≈ 0.5 (horizontal)
    expect(up[0]!).toBeGreaterThan(0.95); // straight knees
    expect(flat[0]!).toBeLessThan(0.8); // bent knees
  });

  it("is the same body seen from the other side (mirror)", () => {
    const mirrorWorld = Object.fromEntries(Object.entries(standingWorld).map(([k, [x, y, z]]) => [k, [-x, y, z] as V]));
    expect(poseFeatures(body(0, standingPicture, mirrorWorld))).toEqual(poseFeatures(body(0, standingPicture, standingWorld)));
  });

  it("ignores joints the model does not see clearly", () => {
    const hidden = body(0, standingPicture, standingWorld);
    hidden.points[25][2] = hidden.points[26][2] = 0.1;
    const f = poseFeatures(hidden)!;
    expect(f[0]).toBeNull(); // knees
    expect(f[2]).toBeNull(); // hips are measured shoulder–hip–knee
    expect(f[4]).not.toBeNull(); // elbows still count
  });

  it("fits the same action far better than another one", () => {
    const standing = bodySignature(clip(standingWorld, standingPicture), 0, 2000);
    const standing2 = bodySignature(clip(standingWorld, standingPicture, 5000, 7000), 5000, 7000);
    const lying = bodySignature(clip(lyingWorld, lyingPicture), 0, 2000);
    expect(bodyFit(standing, standing2)!).toBeGreaterThan(0.95);
    // Both bodies hold still, so how much each joint moves agrees; the posture does not.
    expect(bodyFit(standing, lying)!).toBeLessThan(0.45);
  });

  it("knows a measured empty window from an unmeasured one", () => {
    const empty = Array.from({ length: 10 }, (_, k) => ({ timeMs: k * 200, score: 0, aspect: 1, points: [], world: [] }));
    expect(bodyPresence(bodySignature(empty, 0, 2000))).toBe("absent");
    expect(bodyPresence(bodySignature(clip(standingWorld, standingPicture), 0, 2000))).toBe("present");
    expect(bodyPresence(bodySignature([], 0, 2000))).toBe("unknown");
    expect(bodyFit(bodySignature(empty, 0, 2000), bodySignature(clip(standingWorld, standingPicture), 0, 2000))).toBeUndefined();
  });
});

describe("a shot entered by a dissolve", () => {
  it("asks for the blend's length of footage before its in-point", () => {
    const transitions = [
      { kind: "cut", cutMs: 1600, startMs: 1600, endMs: 1600 },
      { kind: "dissolve", cutMs: 6500, startMs: 6200, endMs: 6800 },
    ];
    expect(dissolveLeadIn(transitions, { startMs: 6430 })).toBe(600);
    expect(dissolveLeadIn(transitions, { startMs: 1600 })).toBe(0);
    expect(dissolveLeadIn(undefined, { startMs: 6500 })).toBe(0);
  });
});
