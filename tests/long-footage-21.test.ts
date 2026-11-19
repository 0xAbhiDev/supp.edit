import { describe, expect, it } from "vitest";
import { frameCuts } from "../packages/ai/reference/cuts";
import { actionSignature, actionSimilarity } from "../packages/ai/reference/action-signature";
import { buildFootageIndex, selectShots, sourceIndexKey, type PlanReport, type ShotRequirement } from "../packages/ai/reference/footage-index";
import { calibrate, type Option } from "../packages/ai/reference/sequence-planner";
import type { VisualFrame } from "../packages/ai/reference/visual";
import type { SourceEvidence } from "../packages/ai/reference/planner";
import type { Shot } from "../packages/ai/reference/dna";

// Dense 33 ms frames built in code: a "look" is a 16-cell layout; movement perturbs some cells.
type Look = { layout: number[]; shadow: [number, number, number]; highlight: [number, number, number] };
const look = (base: number, tilt: number, shadow = 20, highlight = 160): Look => ({
  layout: Array.from({ length: 16 }, (_, j) => base + tilt * ((j % 4) - 1.5) * 0.02 + 0.01 * Math.sin(j)),
  shadow: [shadow, shadow, shadow + 2],
  highlight: [highlight, highlight - 4, highlight - 8],
});
interface Span {
  ms: number;
  look: Look;
  moving?: number[];
  strength?: number;
  /** Per-frame flow expansion (a continuous zoom when constant). */
  zoom?: number;
}
function frames(spans: Span[]): VisualFrame[] {
  const out: VisualFrame[] = [];
  let k = 0,
    prev: number[] | undefined,
    prevLook: Look | undefined;
  for (const span of spans) {
    const count = Math.round(span.ms / (1000 / 30));
    for (let i = 0; i < count; i++, k++) {
      const t = (k * 1000) / 30;
      const phase = Math.sin(((t % 900) / 900) * 2 * Math.PI);
      const layout = span.look.layout.map((v, j) => v + (span.moving?.includes(j) ? (span.strength ?? 0.04) * phase : 0) + (span.zoom ? span.zoom * i * ((j % 4) - 1.5) * 0.01 : 0));
      const cut = !!prevLook && prevLook !== span.look;
      const change = prev ? layout.reduce((s, v, j) => s + Math.abs(v - prev![j]), 0) / 16 + (cut ? 0.03 : 0) : 0;
      out.push({
        timeMs: Math.round(t),
        luma: span.look.layout[0],
        contrast: 0.2,
        saturation: 0.1,
        temperature: 0,
        sharpness: 0.15,
        change,
        whiteFraction: 0,
        blackFraction: 0.1,
        layout,
        shadowRgb: span.look.shadow,
        highlightRgb: span.look.highlight,
        flow: { panX: 0, panY: 0, expansion: span.zoom ?? 0, confidence: 0.95 },
      } as VisualFrame);
      prev = layout;
      prevLook = span.look;
    }
  }
  return out;
}
function denseSource(id: string, spans: Span[]): SourceEvidence {
  const visual = frames(spans);
  const durationMs = visual.at(-1)!.timeMs + 33;
  const quality = [];
  for (let t = 0; t < durationMs; t += 500) quality.push({ timeMs: t, meanLuma: 0.3, laplacianVariance: 60, frameDifference: 0.02 });
  const scenes = [{ startMs: 0, endMs: durationMs, representativeMs: durationMs / 2, boundaryScore: 0.9, motion: 0.02, sharpness: 60, blackFraction: 0 }];
  const asset = { id, name: id + ".mp4", kind: "video", path: id + ".mp4", size: 1, duration: durationMs / 1000, width: 1280, height: 720, fps: 30, codec: "h264", hasAudio: false, fingerprint: id };
  return { asset, visual, analysis: { assetId: id, fingerprint: id, video: { scenes, quality }, vision: { frames: [] } } } as unknown as SourceEvidence;
}
const shotFrom = (source: SourceEvidence, ms: number): ShotRequirement => {
  const action = actionSignature(source.visual!, undefined, 70, ms - 70, 16 / 9)!;
  return {
    shot: { startMs: 0, endMs: ms, motion: 0.02, luma: 0.3, framing: null, subject: null, layout: null, action } as unknown as Shot,
    durationMs: ms,
    peakFraction: 0.5,
    peakSource: "none",
  };
};
const hold = look(0.3, 1),
  lift = look(0.31, -1, 26, 150),
  press = look(0.29, 0.5, 18, 170);
const liftMove = { moving: [5, 6, 9, 10], strength: 0.05 },
  pressMove = { moving: [1, 2, 13, 14], strength: 0.05 };
const refLift = denseSource("refLift", [{ ms: 2000, look: look(0.5, 0.2, 60, 200), ...liftMove }]);
const refPress = denseSource("refPress", [{ ms: 2000, look: look(0.5, 0.2, 60, 200), ...pressMove }]);
const within = (c: { inMs: number; outMs: number }, a: number, b: number) => c.inMs >= a && c.outMs <= b;
const takes = (raw: SourceEvidence) => {
  // Where each take starts and ends (frames where the look changes).
  const v = raw.visual!;
  const edges = v.filter((f, i) => i && f.highlightRgb !== v[i - 1].highlightRgb).map((f) => f.timeMs);
  return edges;
};

describe("global planning with scarce and repeated actions", () => {
  it("lets two shots repeating one action share one long repetition phase by phase, never substituting another action", () => {
    const raw = denseSource("raw", [{ ms: 6000, look: hold }, { ms: 3300, look: lift, ...liftMove }, { ms: 6000, look: hold }, { ms: 2600, look: press, ...pressMove }, { ms: 5000, look: hold }]);
    const [liftIn, liftOut, pressIn, pressOut] = takes(raw);
    let report: PlanReport | undefined;
    const choices = selectShots(buildFootageIndex([raw]), [raw], [shotFrom(refLift, 1200), shotFrom(refPress, 1200), shotFrom(refLift, 1400)], "Close Match", 40, 16, undefined, undefined, (r) => (report = r));
    expect(within(choices[0], liftIn, liftOut)).toBe(true);
    expect(within(choices[1], pressIn, pressOut)).toBe(true);
    expect(within(choices[2], liftIn, liftOut)).toBe(true);
    // No frame is played twice.
    expect(choices[0].outMs <= choices[2].inMs || choices[2].outMs <= choices[0].inMs).toBe(true);
    expect(choices.every((c) => c.reuse === null)).toBe(true);
    expect(report!.groups.find((g) => g.shots.includes(0) && g.shots.includes(2))?.outcome).toBe("shared one stretch");
    expect(report!.resources.some((r) => r.compatibleShots.includes(0) && r.compatibleShots.includes(2))).toBe(true);
  });
  it("reuses one interval, and says so, when the reference repeats an action the footage holds once and too briefly to share", () => {
    const raw = denseSource("raw", [{ ms: 6000, look: hold }, { ms: 1700, look: lift, ...liftMove }, { ms: 6000, look: hold }, { ms: 2600, look: press, ...pressMove }, { ms: 5000, look: hold }]);
    const [liftIn, liftOut] = takes(raw);
    const choices = selectShots(buildFootageIndex([raw]), [raw], [shotFrom(refLift, 1300), shotFrom(refPress, 1200), shotFrom(refLift, 1400)], "Close Match");
    expect(within(choices[0], liftIn, liftOut)).toBe(true);
    expect(within(choices[2], liftIn, liftOut)).toBe(true);
    expect(choices[2].reuse?.permitted).toBe(true);
    expect(choices[2].reuse?.reason).toMatch(/reference-repeat/);
  });
  it("never reuses when a second equivalent repetition exists", () => {
    const raw = denseSource("raw", [{ ms: 6000, look: hold }, { ms: 1700, look: lift, ...liftMove }, { ms: 6000, look: hold }, { ms: 2600, look: press, ...pressMove }, { ms: 5000, look: hold }, { ms: 1800, look: lift, ...liftMove }, { ms: 4000, look: hold }]);
    const choices = selectShots(buildFootageIndex([raw]), [raw], [shotFrom(refLift, 1300), shotFrom(refPress, 1200), shotFrom(refLift, 1400)], "Close Match");
    expect(choices.every((c) => c.reuse === null)).toBe(true);
    expect(Math.abs(choices[0].inMs - choices[2].inMs)).toBeGreaterThan(5000);
  });
});

describe("calibration and coverage", () => {
  const option = (score: number, action: number, stretch: number): Option =>
    ({
      inMs: stretch * 10000,
      outMs: stretch * 10000 + 1000,
      peakMs: 0,
      speed: 1,
      score,
      match: {},
      action: { trajectory: action, regions: action, camera: 1, rhythm: 0.6, subject: null, overall: action },
      pose: null,
      c: { sourceId: "a", sceneStartMs: stretch * 10000, sceneEndMs: stretch * 10000 + 3000, quality: 1 },
    }) as unknown as Option;
  it("reports lower confidence for a near tie than for a clear lead, whatever the absolute score", () => {
    const tie = calibrate(option(0.9, 0.8, 0), [option(0.9, 0.8, 0), option(0.894, 0.8, 1)]);
    const lead = calibrate(option(0.7, 0.8, 0), [option(0.7, 0.8, 0), option(0.55, 0.8, 1)]);
    expect(tie.margin).toBeLessThan(0.01);
    expect(lead.certainty).toBeGreaterThan(tie.certainty);
  });
  it("calls a shot missing when nothing performs it", () => {
    expect(calibrate(option(0.6, 0.35, 0), [option(0.6, 0.35, 0)]).coverage).toBe("missing");
    expect(calibrate(option(0.8, 0.85, 0), [option(0.8, 0.85, 0), option(0.6, 0.5, 1)]).coverage).toBe("excellent");
  });
});

describe("cut versus zoom, still pictures, file-identity caches", () => {
  it("finds a punch-in cut (one-frame scale jump) in a finished reference but not a continuous zoom", () => {
    const a = look(0.6, 0.4),
      b = look(0.615, 0.6);
    const f = frames([{ ms: 1500, look: a }, { ms: 1500, look: b }]);
    const at = f.findIndex((x, i) => i && x.highlightRgb !== f[i - 1].highlightRgb);
    // The cut frame: a scale jump in the flow measurement, palette unchanged, low flow confidence before.
    for (const x of f) x.flow = { panX: 0, panY: 0, expansion: 0, confidence: 0.42 };
    f[at] = { ...f[at], flow: { panX: 0, panY: 0, expansion: -0.1, confidence: 0.4 }, shadowRgb: f[at - 1].shadowRgb, highlightRgb: f[at - 1].highlightRgb };
    for (let i = at + 1; i < f.length; i++) f[i] = { ...f[i], shadowRgb: f[at - 1].shadowRgb, highlightRgb: f[at - 1].highlightRgb };
    expect(frameCuts(f, [], [], true).map((c) => c.timeMs)).toEqual([f[at].timeMs]);
    const zoom = frames([{ ms: 3000, look: a, zoom: 0.08 }]);
    expect(frameCuts(zoom, [], [], true)).toEqual([]);
  });
  it("matches two still pictures as moving alike, and a still against a moving one as not", () => {
    const still = frames([{ ms: 1500, look: hold }]);
    const moving = frames([{ ms: 1500, look: hold, ...liftMove }]);
    const s = actionSignature(still, undefined, 0, 1500, 16 / 9)!,
      m = actionSignature(moving, undefined, 0, 1500, 16 / 9)!;
    expect(actionSimilarity(s, s).overall).toBe(1);
    expect(actionSimilarity(s, m).overall).toBeLessThan(0.5);
  });
  it("keys each clip's index by that file alone, so changing one file or the reference invalidates nothing else", () => {
    const a = denseSource("a", [{ ms: 2000, look: hold }]),
      b = denseSource("b", [{ ms: 2000, look: hold }]);
    const before = [sourceIndexKey(a), sourceIndexKey(b)];
    const changed = { ...b, asset: { ...b.asset, fingerprint: "b-modified" } } as SourceEvidence;
    expect(sourceIndexKey(a)).toBe(before[0]);
    expect(sourceIndexKey(changed)).not.toBe(before[1]);
    expect(before[0]).not.toContain("ref");
  });
});
