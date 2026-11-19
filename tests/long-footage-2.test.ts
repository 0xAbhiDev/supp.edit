import { describe, expect, it } from "vitest";
import { cutSafeSegments, frameCuts } from "../packages/ai/reference/cuts";
import { actionSignature, actionSimilarity } from "../packages/ai/reference/action-signature";
import { buildFootageIndex, infeasibleShots, selectShots, type ShotRequirement } from "../packages/ai/reference/footage-index";
import { pathFit, shapePath } from "../packages/ai/reference/subject-shape";
import type { VisualFrame } from "../packages/ai/reference/visual";
import type { PersonSample } from "../packages/ai/reference/subject-mask";
import type { SourceEvidence } from "../packages/ai/reference/planner";
import type { Shot } from "../packages/ai/reference/dna";

// Dense 33 ms frames built in code. A "look" is a 16-cell layout; movement perturbs some cells.
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
type Look = { layout: number[]; shadow: [number, number, number]; highlight: [number, number, number]; sharpness: number; luma: number };
const look = (base: number, tilt: number, shadow = 20, highlight = 160): Look => ({
  layout: Array.from({ length: 16 }, (_, j) => base + tilt * ((j % 4) - 1.5) * 0.02 + 0.01 * Math.sin(j)),
  shadow: [shadow, shadow, shadow + 2],
  highlight: [highlight, highlight - 4, highlight - 8],
  sharpness: 0.15 + tilt * 0.01,
  luma: base,
});
interface Span {
  ms: number;
  look: Look;
  /** Cells that move, and how strongly (0 = static). */
  moving?: number[];
  strength?: number;
  /** Footage below the delivery rate repeats every other frame. */
  repeated?: boolean;
}
function frames(spans: Span[]): VisualFrame[] {
  const out: VisualFrame[] = [];
  let t = 0,
    prev: number[] | undefined,
    prevLook: Look | undefined;
  for (const span of spans) {
    const end = t + span.ms;
    let k = 0;
    for (; t < end; t += 1000 / 30, k++) {
      const phase = Math.sin(((t % 900) / 900) * 2 * Math.PI);
      const hold = span.repeated && k % 2 === 1;
      const layout = hold && prev ? [...prev] : span.look.layout.map((v, j) => v + (span.moving?.includes(j) ? (span.strength ?? 0.04) * phase : 0) + 0.0002 * rnd());
      const change = prev ? layout.reduce((s, v, j) => s + Math.abs(v - prev![j]), 0) / 16 + (prevLook && prevLook !== span.look ? 0.03 : 0) : 0;
      const cut = !!prevLook && prevLook !== span.look;
      out.push({
        timeMs: Math.round(t),
        luma: span.look.luma,
        contrast: 0.2,
        saturation: 0.1,
        temperature: 0,
        sharpness: span.look.sharpness,
        change,
        whiteFraction: 0,
        blackFraction: 0.1,
        layout,
        shadowRgb: span.look.shadow,
        highlightRgb: span.look.highlight,
        flow: { panX: 0, panY: 0, expansion: 0, confidence: cut ? 0.2 : 0.95 },
      } as VisualFrame);
      prev = layout;
      prevLook = span.look;
    }
  }
  return out;
}

describe("frame-accurate cuts between similar material", () => {
  const darkA = look(0.3, 1),
    darkB = look(0.31, -1, 26, 150);
  it("finds a cut between two similar dark takes, frame-accurate, and none inside low-frame-rate movement", () => {
    const f = frames([
      { ms: 3000, look: darkA, moving: [5, 6, 9, 10], strength: 0.03, repeated: true },
      { ms: 3000, look: darkB, moving: [6, 7], strength: 0.03, repeated: true },
    ]);
    const cuts = frameCuts(f);
    expect(cuts).toHaveLength(1);
    expect(Math.abs(cuts[0].timeMs - 3000)).toBeLessThanOrEqual(34);
    expect(cuts[0].evidence).toEqual(expect.arrayContaining(["layout jump", "palette jump", "flow reset"]));
  });
  it("rejects a flash that returns and a title swap over the same picture", () => {
    const f = frames([{ ms: 4000, look: darkA, moving: [5], strength: 0.01 }]);
    // One white flash frame, then back.
    f[40] = { ...f[40], change: 0.3, layout: f[40].layout.map((v) => v + 0.5), luma: 0.9, highlightRgb: [255, 255, 255] };
    f[41] = { ...f[41], change: 0.3 };
    // A title appears in the top-left cells only.
    for (let i = 80; i < f.length; i++) f[i] = { ...f[i], layout: f[i].layout.map((v, j) => (j === 0 || j === 1 ? v + 0.25 : v)) };
    f[80] = { ...f[80], change: 0.035 };
    const title = { startMs: f[80].timeMs, endMs: 4000, x: 0.02, y: 0.02, width: 0.4, height: 0.15 };
    expect(frameCuts(f, [], [title]).map((c) => c.timeMs)).toEqual([]);
  });
  it("keeps a safety margin of frames on both sides of every cut", () => {
    const segments = cutSafeSegments([{ startMs: 0, endMs: 3000 }], [{ timeMs: 1500, strength: 9, evidence: [] }], 67, 400);
    expect(segments).toEqual([
      { startMs: 0, endMs: 1433, cutBefore: false, cutAfter: true },
      { startMs: 1567, endMs: 3000, cutBefore: true, cutAfter: false },
    ]);
  });
  it("in a finished reference, treats a picture that returns within half a second as an effect", () => {
    const f = frames([{ ms: 3000, look: darkA, moving: [5], strength: 0.01 }]);
    // A 300 ms recoloured subject (palette and flow reset), then the same picture again.
    for (let i = 30; i < 39; i++) f[i] = { ...f[i], layout: f[i].layout.map((v, j) => (j >= 4 && j < 12 ? v + 0.2 : v)), highlightRgb: [180, 240, 220] };
    f[30] = { ...f[30], change: 0.08, flow: { panX: 0, panY: 0, expansion: 0, confidence: 0.2 } };
    f[39] = { ...f[39], change: 0.08, flow: { panX: 0, panY: 0, expansion: 0, confidence: 0.2 } };
    expect(frameCuts(f, [], [], true)).toEqual([]);
  });
});

/** A person outline (96 points on an ellipse) at a centre and size. */
const outline = (cx: number, cy: number, w: number, h: number) =>
  Array.from({ length: 96 }, (_, k) => {
    const a = (k / 96) * 2 * Math.PI;
    return [Math.min(1, Math.max(0, cx + (w / 2) * Math.cos(a))), Math.min(1, Math.max(0, cy + (h / 2) * Math.sin(a)))] as [number, number];
  });
const person = (ms: number, at: (t: number) => { cx: number; cy: number; w: number; h: number }): PersonSample[] =>
  Array.from({ length: Math.floor(ms / 100) }, (_, k) => {
    const p = at(k * 100);
    return { timeMs: k * 100, points: outline(p.cx, p.cy, p.w, p.h) };
  });

describe("temporal action signatures", () => {
  it("tells movement in different places and along different axes apart, whatever the look", () => {
    const same = look(0.3, 0);
    const top = frames([{ ms: 2000, look: same, moving: [0, 1, 4, 5], strength: 0.04 }]);
    const bottom = frames([{ ms: 2000, look: same, moving: [10, 11, 14, 15], strength: 0.04 }]);
    const up = person(2000, (t) => ({ cx: 0.5, cy: 0.5 + 0.12 * Math.sin(t / 150), w: 0.2, h: 0.6 }));
    const side = person(2000, (t) => ({ cx: 0.5 + 0.12 * Math.sin(t / 150), cy: 0.5, w: 0.2, h: 0.6 }));
    const ref = actionSignature(top, up, 0, 2000, 16 / 9)!;
    const sameMove = actionSignature(top, up, 0, 2000, 16 / 9)!;
    const elsewhere = actionSignature(bottom, side, 0, 2000, 16 / 9)!;
    const a = actionSimilarity(ref, sameMove),
      b = actionSimilarity(ref, elsewhere);
    expect(a.regions).toBeGreaterThan(b.regions + 0.3);
    expect(a.subject!).toBeGreaterThan(b.subject! + 0.2);
    expect(a.overall).toBeGreaterThan(b.overall + 0.15);
  });
  it("matches pose trajectories performed a little later, but not a different pose sequence", () => {
    const squat = (delay: number) => person(1600, (t) => ({ cx: 0.5, cy: 0.55, w: 0.25, h: 0.7 - 0.3 * Math.max(0, Math.sin((t - delay) / 300)) }));
    const lying = person(1600, (t) => ({ cx: 0.5, cy: 0.7, w: 0.7 - 0.1 * Math.sin(t / 300), h: 0.2 }));
    const ref = shapePath(squat(0), 0, 1600, 16 / 9);
    expect(pathFit(ref, shapePath(squat(150), 0, 1600, 16 / 9))!).toBeGreaterThan(pathFit(ref, shapePath(lying, 0, 1600, 16 / 9))! + 0.3);
  });
});

/** First frame of each new take: where the true cuts are. */
const boundaries = (source: SourceEvidence) => source.visual!.filter((f, i) => i && f.highlightRgb !== source.visual![i - 1].highlightRgb).map((f) => f.timeMs);
function denseSource(id: string, spans: Span[]): SourceEvidence {
  const visual = frames(spans);
  const durationMs = visual.at(-1)!.timeMs + 33;
  const quality = [];
  for (let t = 0; t < durationMs; t += 500) quality.push({ timeMs: t, meanLuma: 0.3, laplacianVariance: 60, frameDifference: 0.02 });
  // The scene pass misses every cut: one scene for the whole clip.
  const scenes = [{ startMs: 0, endMs: durationMs, representativeMs: durationMs / 2, boundaryScore: 0.9, motion: 0.02, sharpness: 60, blackFraction: 0 }];
  const asset = { id, name: id + ".mp4", kind: "video", path: id + ".mp4", size: 1, duration: durationMs / 1000, width: 1280, height: 720, fps: 30, codec: "h264", hasAudio: false, fingerprint: id };
  return { asset, visual, analysis: { assetId: id, fingerprint: id, video: { scenes, quality }, vision: { frames: [] } } } as unknown as SourceEvidence;
}
const shotFrom = (source: SourceEvidence, startMs: number, endMs: number): ShotRequirement => {
  const action = actionSignature(source.visual!, undefined, startMs, endMs, 16 / 9)!;
  return {
    shot: { startMs: 0, endMs: endMs - startMs, motion: 0.02, luma: 0.3, framing: null, subject: null, layout: null, action } as unknown as Shot,
    durationMs: endMs - startMs,
    peakFraction: 0.5,
    peakSource: "none",
  };
};

describe("cut-safe, duration-feasible selection from long footage", () => {
  const hold = look(0.3, 1),
    lift = look(0.31, -1, 26, 150),
    press = look(0.29, 0.5, 18, 170);
  it("never trims across a cut the scene pass missed, and explains every choice", () => {
    const raw = denseSource("raw", [
      { ms: 8000, look: hold },
      { ms: 2200, look: lift, moving: [5, 6, 9, 10], strength: 0.05 },
      { ms: 6000, look: hold },
      { ms: 2500, look: press, moving: [1, 2, 13, 14], strength: 0.05 },
      { ms: 5000, look: hold },
    ]);
    const index = buildFootageIndex([raw]);
    const truth = boundaries(raw);
    expect(index.cuts.map((c) => c.timeMs)).toEqual(truth);
    const refLift = denseSource("refLift", [{ ms: 1600, look: lift, moving: [5, 6, 9, 10], strength: 0.05 }]);
    const refPress = denseSource("refPress", [{ ms: 1800, look: press, moving: [1, 2, 13, 14], strength: 0.05 }]);
    const reqs = [shotFrom(refPress, 0, 1800), shotFrom(refLift, 0, 1600)];
    const choices = selectShots(index, [raw], reqs, "Close Match");
    // Each shot comes from the stretch that moves the same way, inside it, clear of its cuts.
    expect(choices[0].inMs).toBeGreaterThanOrEqual(truth[2] + 67);
    expect(choices[0].outMs).toBeLessThanOrEqual(truth[3] - 67);
    expect(choices[1].inMs).toBeGreaterThanOrEqual(truth[0] + 67);
    expect(choices[1].outMs).toBeLessThanOrEqual(truth[1] - 67);
    for (const c of choices) {
      expect(c.why.length).toBeGreaterThan(1);
      for (const alt of c.alternatives) {
        expect(alt.lostOn).toMatch(/trails on|close second/);
        // Alternatives are distinct takes, not the same moment shifted a few frames.
        expect(alt.sourceId !== c.sourceId || Math.abs(alt.inMs - c.inMs) >= 2500 || alt.inMs >= c.outMs || alt.outMs <= c.inMs).toBe(true);
      }
    }
  });
  it("fills a shot slightly longer than any cut-safe stretch by a mild retime, and reports one that nothing can fill", () => {
    const raw = denseSource("short", [
      { ms: 6000, look: hold },
      { ms: 2000, look: lift, moving: [5, 6, 9, 10], strength: 0.05 },
      { ms: 6000, look: hold },
    ]);
    const index = buildFootageIndex([raw]);
    const ref = denseSource("ref", [{ ms: 4000, look: lift, moving: [5, 6, 9, 10], strength: 0.05 }]);
    const slightly = shotFrom(ref, 0, 2050);
    const [choice] = selectShots(index, [raw], [slightly], "Close Match");
    const [start, end] = boundaries(raw);
    expect(choice.inMs).toBeGreaterThanOrEqual(start + 67);
    expect(choice.outMs).toBeLessThanOrEqual(end - 67);
    expect(choice.speed).toBeLessThan(1);
    expect(choice.speed).toBeGreaterThanOrEqual(0.85);
    const far = { ...shotFrom(ref, 0, 3500), durationMs: 9000 };
    expect(infeasibleShots(index, [slightly, far]).map((x) => x.shot)).toEqual([1]);
  });
});
