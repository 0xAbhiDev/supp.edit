import { describe, expect, it } from "vitest";
import { buildFootageIndex, selectShots, type ShotRequirement } from "../packages/ai/reference/footage-index";
import type { SourceEvidence } from "../packages/ai/reference/planner";
import type { Shot } from "../packages/ai/reference/dna";

// Ground truth built in code: long raw clips whose best-matching moments are planted at known
// places, with decoys elsewhere (busy but blurred, or plain but unlike any reference shot).
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const unit = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
const vector = () => unit(Array.from({ length: 512 }, rnd));
/** A look shared by a reference shot and its planted source moment (plus a little noise). */
const near = (v: number[]) => unit(v.map((x) => x + 0.15 * rnd() / Math.sqrt(512)));

interface Plant {
  clip: number;
  startMs: number;
  endMs: number;
  peakMs: number;
  look: number[];
}
function clip(id: string, durationMs: number, plants: Plant[], decoys: { startMs: number; endMs: number }[] = []): SourceEvidence {
  const quality = [],
    frames = [],
    scenes = [];
  for (let t = 0; t < durationMs; t += 500) {
    const plant = plants.find((p) => t >= p.startMs && t < p.endMs);
    const decoy = decoys.find((d) => t >= d.startMs && t < d.endMs);
    // Movement: a planted moment rises to a peak; decoys move a lot but are blurred.
    const motion = plant ? 0.03 + 0.12 * Math.exp(-(((t - plant.peakMs) / 500) ** 2)) : decoy ? 0.16 : 0.012;
    quality.push({ timeMs: t, meanLuma: 0.4, laplacianVariance: decoy ? 2 : 60, frameDifference: Math.min(1, motion) });
  }
  for (let t = 250; t < durationMs; t += 1000) {
    const plant = plants.find((p) => t >= p.startMs && t < p.endMs);
    const scene = Math.floor(t / 10000) * 10000;
    frames.push({ timeMs: t, sceneStartMs: scene, sceneEndMs: Math.min(durationMs, scene + 10000), width: 1280, height: 720, orientation: "landscape", description: "", labels: [], detections: [], subject: null, shotScale: "medium", embedding: plant ? near(plant.look) : vector() });
  }
  for (let s = 0; s < durationMs; s += 10000) scenes.push({ startMs: s, endMs: Math.min(durationMs, s + 10000), representativeMs: s + 5000, boundaryScore: 0.9, motion: 0.02, sharpness: 60, blackFraction: 0 });
  const asset = { id, name: id + ".mp4", kind: "video", path: id + ".mp4", size: 1, duration: durationMs / 1000, width: 1280, height: 720, fps: 30, codec: "h264", hasAudio: false, fingerprint: id };
  return { asset, analysis: { assetId: id, fingerprint: id, video: { scenes, quality }, vision: { frames } } } as unknown as SourceEvidence;
}
const requirement = (look: number[], durationMs: number, peakFraction: number): ShotRequirement => ({
  shot: { startMs: 0, endMs: durationMs, motion: 0.06, luma: 0.4, framing: "medium", subject: null, embedding: look, layout: null } as unknown as Shot,
  durationMs,
  peakFraction,
  peakSource: "audio event",
});
const within = (inMs: number, outMs: number, p: Plant) => inMs >= p.startMs - 200 && outMs <= p.endMs + 200;

describe("long raw footage", () => {
  it("finds the planted moments of a 90 s clip for a 6-shot reference, never the first seconds", () => {
    const plants: Plant[] = [
      { clip: 0, startMs: 12000, endMs: 14000, peakMs: 13000, look: vector() },
      { clip: 0, startMs: 31000, endMs: 34000, peakMs: 32000, look: vector() },
      { clip: 0, startMs: 46000, endMs: 48000, peakMs: 47000, look: vector() },
      { clip: 0, startMs: 67000, endMs: 70000, peakMs: 68500, look: vector() },
      { clip: 0, startMs: 82000, endMs: 85000, peakMs: 83500, look: vector() },
    ];
    // The reference plays them in its own order; shot 6 reuses the look of shot 2's moment later in it.
    const order = [3, 0, 4, 1, 2];
    const reqs = order.map((k, i) => requirement(plants[k].look, [1300, 900, 1500, 1100, 1300][i], [0.4, 0.5, 0.3, 0.6, 0.45][i]));
    const source = clip("raw90", 90000, plants, [{ startMs: 0, endMs: 9000 }]);
    const index = buildFootageIndex([source]);
    expect(index.coverage).toMatchObject({ clips: 1, suppliedMs: 90000 });
    expect(index.coverage.analyzedMs).toBeGreaterThanOrEqual(89000);
    expect(index.candidates.length).toBeGreaterThan(20);
    const choices = selectShots(index, [source], reqs, "Close Match");
    expect(choices).toHaveLength(reqs.length);
    choices.forEach((c, i) => {
      const p = plants[order[i]];
      expect(within(c.inMs, c.outMs, p)).toBe(true);
      // Action-peak alignment: the source peak sits where the reference wants it (±250 ms).
      expect(Math.abs(c.inMs + reqs[i].peakFraction * (c.outMs - c.inMs) - p.peakMs)).toBeLessThanOrEqual(250);
      expect(c.inMs).toBeGreaterThanOrEqual(9000);
      expect(c.alternatives.length).toBeGreaterThan(0);
      expect(c.match.quality).toBeGreaterThan(0.5);
    });
    // No accidental reuse: chosen intervals are disjoint.
    for (let i = 0; i < choices.length; i++)
      for (let j = i + 1; j < choices.length; j++) expect(choices[i].inMs < choices[j].outMs && choices[j].inMs < choices[i].outMs).toBe(false);
  });

  it("uses moments from anywhere in a multi-clip pool, in the reference's order, without file order", () => {
    const durations = [130000, 100000, 200000];
    const plants: Plant[] = [
      { clip: 2, startMs: 151000, endMs: 154000, peakMs: 152000, look: vector() },
      { clip: 0, startMs: 21000, endMs: 24000, peakMs: 22500, look: vector() },
      { clip: 1, startMs: 77000, endMs: 79000, peakMs: 78000, look: vector() },
      { clip: 2, startMs: 12000, endMs: 15000, peakMs: 13000, look: vector() },
      { clip: 0, startMs: 104000, endMs: 107000, peakMs: 105500, look: vector() },
      { clip: 2, startMs: 88000, endMs: 90000, peakMs: 89000, look: vector() },
      { clip: 1, startMs: 33000, endMs: 36000, peakMs: 34000, look: vector() },
      { clip: 0, startMs: 63000, endMs: 66000, peakMs: 64000, look: vector() },
      { clip: 2, startMs: 187000, endMs: 190000, peakMs: 188500, look: vector() },
    ];
    const sources = durations.map((d, k) => clip("clip" + "ABC"[k], d, plants.filter((p) => p.clip === k)));
    const reqs = plants.map((p, i) => requirement(p.look, 1000 + (i % 3) * 300, 0.5));
    const index = buildFootageIndex(sources);
    expect(index.coverage.suppliedMs).toBe(430000);
    const choices = selectShots(index, sources, reqs, "Close Match");
    choices.forEach((c, i) => {
      const p = plants[i];
      expect(c.sourceId).toBe(sources[p.clip].asset.id);
      expect(within(c.inMs, c.outMs, p)).toBe(true);
    });
    // Choices jump between files as the reference requires.
    expect(new Set(choices.map((c) => c.sourceId)).size).toBe(3);
  });

  it("rejects blurred or shaky footage when usable footage exists", () => {
    const look = vector();
    const good: Plant = { clip: 0, startMs: 50000, endMs: 53000, peakMs: 51500, look };
    // The same look also appears in a blurred stretch earlier in the clip.
    const source = clip("blurry", 60000, [{ ...good, startMs: 5000, endMs: 8000, peakMs: 6500 }, good], [{ startMs: 4000, endMs: 9000 }]);
    const [choice] = selectShots(buildFootageIndex([source]), [source], [requirement(look, 1200, 0.5)], "Close Match");
    expect(within(choice.inMs, choice.outMs, good)).toBe(true);
  });
});
