import { describe, expect, it } from "vitest";
import { dissolves, frameCuts } from "../packages/ai/reference/cuts";
import { newClip, newProject } from "../packages/project-schema";
import { History } from "../packages/commands";
import { addReferenceTransition } from "../packages/commands/reference-transition";
import type { VisualFrame } from "../packages/ai/reference/visual";
import { buildFootageIndex } from "../packages/ai/reference/footage-index";
import type { SourceEvidence } from "../packages/ai/reference/planner";
import { applyTitleCache, titleCacheEntry, titleCacheKey } from "../packages/ai/reference/title-cache";
import type { StyleDNA } from "../packages/ai/reference/dna";
import { absorbFlashSlivers } from "../packages/ai/reference/dna";
import { referenceGrammar } from "../packages/ai/reference/grammar";
import { autonomousControls, barred, barredRuns, defaults, takeCurves } from "../packages/ai/reference/planner";

// Per-sample measurements built in code at any sampling step. Each sample gives its change, an
// optional layout shift over some cells (alternating sign so movement oscillates, not drifts),
// and the palette, level, sharpness and flow match after it.
interface Sample {
  change: number;
  shift?: number;
  cells?: number[];
  shadow?: number;
  luma?: number;
  sharp?: number;
  conf?: number;
  expansion?: number;
  panX?: number;
}
function sampled(stepMs: number, samples: Sample[]): VisualFrame[] {
  let layout = Array.from({ length: 16 }, (_, j) => 0.4 + 0.01 * Math.sin(j));
  let shadow = 20,
    luma = 0.33,
    sharp = 0.2;
  return samples.map((s, k) => {
    if (s.shift) layout = layout.map((v, j) => ((s.cells ?? [5, 6, 9, 10]).includes(j) ? v + s.shift! * (j % 2 ? 1 : -1) : v));
    shadow = s.shadow ?? shadow;
    luma = s.luma ?? luma;
    sharp = s.sharp ?? sharp;
    return {
      timeMs: Math.round(k * stepMs),
      luma,
      contrast: 0.2,
      saturation: 0.1,
      temperature: 0,
      sharpness: sharp,
      change: s.change,
      whiteFraction: 0,
      blackFraction: 0.1,
      layout: [...layout],
      shadowRgb: [shadow, shadow, shadow + 2],
      highlightRgb: [160, 156, 152],
      flow: { panX: s.panX ?? 0, panY: 0, expansion: s.expansion ?? 0, confidence: s.conf ?? 0.95 },
    } as VisualFrame;
  });
}
const frozen = (count: number): Sample[] => Array.from({ length: count }, () => ({ change: 0.00005, conf: 1 }));
/** Movement that updates every sample (no repeated frames). */
const moving = (changes: number[]): Sample[] => changes.map((change, k) => ({ change, shift: (k % 2 ? 1 : -1) * 0.004, conf: 0.9 }));
const STEP_15 = 1000 / 15;

describe("frame cuts at the 15 fps dense rate of very long footage", () => {
  it("finds a cut from a held picture into movement whose next sample moves almost as much as the cut", () => {
    // Measured shape at a 15 fps cut into a fast lift: the sample after the cut holds two source
    // frames of the new shot's movement (0.78 of the cut's change).
    const cut: Sample = { change: 0.0296, shift: 0.03, shadow: 30, sharp: 0.216, conf: 0.72 };
    const f = sampled(STEP_15, [...frozen(30), cut, ...moving([0.023, 0.0115, 0.0069, 0.0112, 0.0111, 0.009, 0.0105, 0.0098, 0.011, 0.0102, 0.0095, 0.0108])]);
    expect(frameCuts(f).map((c) => c.timeMs)).toEqual([f[30].timeMs]);
  });
  it("still rejects a dissolve out of a held picture, whose following samples change as much as the first", () => {
    const dissolve: Sample[] = [0.015, 0.016, 0.016, 0.015].map((change) => ({ change, shift: 0.008, shadow: undefined, conf: 0.7 }));
    const f = sampled(STEP_15, [...frozen(30), ...dissolve, ...frozen(30)]);
    expect(frameCuts(f)).toEqual([]);
  });
  it("finds a cut out of movement that updates every sample into a frozen picture, judged at the 30 fps scale", () => {
    // Before the cut each 15 fps sample carries two source frames of movement, so the cut stands
    // only 2.4x above it (at 30 fps the same cut stands 4.4x above).
    const before = moving([0.0053, 0.0063, 0.0065, 0.0062, 0.0057, 0.0055, 0.006, 0.0058, 0.0061, 0.0056, 0.0059, 0.0062, 0.0057, 0.0055]).map((s) => ({ ...s, conf: 0.6 }));
    const cut: Sample = { change: 0.0146, shift: 0.0152, conf: 0.35 };
    const f = sampled(STEP_15, [...before, cut, ...frozen(30)]);
    expect(frameCuts(f).map((c) => c.timeMs)).toEqual([f[before.length].timeMs]);
    // The same movement simply stopping (no new picture) is not a cut.
    const stops = sampled(STEP_15, [...before, { change: 0.0062, shift: 0.004, conf: 0.6 }, ...frozen(30)]);
    expect(frameCuts(stops)).toEqual([]);
  });
  it("judges a one-sample jump against the movement within ±267 ms, whatever the sampling step", () => {
    // Footage below the sampling rate (repeated samples) with fast updates near the jump and slow
    // ones further away: an overlay snapping shut mid-movement. Within ±267 ms (4 samples at
    // 15 fps) the jump is about twice the movement — the same verdict 8 samples give at 30 fps —
    // while 8 samples at 15 fps would reach the slow passage and call it a cut.
    const slow: Sample[] = Array.from({ length: 12 }, (_, k) => (k % 2 ? { change: 0.0002 } : { change: 0.004, shift: (k % 4 ? 1 : -1) * 0.0012 }));
    const fast: Sample[] = [0.016, 0.0002, 0.02, 0.0002].map((change, k) => (change > 0.001 ? { change, shift: (k % 4 ? 1 : -1) * 0.004 } : { change }));
    const jump: Sample = { change: 0.0336, shift: 0.0393, luma: 0.346, sharp: 0.153, shadow: 26, conf: 0.72 };
    const after: Sample[] = [0.0163, 0.0002, 0.0091, 0.0002].map((change, k) => (change > 0.001 ? { change, shift: (k % 4 ? -1 : 1) * 0.004 } : { change }));
    const f = sampled(STEP_15, [...slow, ...fast, jump, ...after, ...slow]);
    expect(frameCuts(f)).toEqual([]);
  });
});

describe("cut safety at the sampling step actually measured", () => {
  it("keeps every usable segment two samples (134 ms at 15 fps) clear of a frame cut", () => {
    const cut: Sample = { change: 0.0296, shift: 0.03, shadow: 30, sharp: 0.216, conf: 0.72 };
    const visual = sampled(STEP_15, [...moving(Array.from({ length: 45 }, (_, k) => 0.006 + 0.0005 * (k % 3))), cut, ...moving(Array.from({ length: 45 }, (_, k) => 0.007 + 0.0005 * (k % 2)))]);
    const durationMs = visual.at(-1)!.timeMs + 67;
    const quality = Array.from({ length: Math.ceil(durationMs / 500) }, (_, k) => ({ timeMs: k * 500, meanLuma: 0.3, laplacianVariance: 60, frameDifference: 0.02 }));
    const scenes = [{ startMs: 0, endMs: durationMs, representativeMs: durationMs / 2, boundaryScore: 0.9, motion: 0.02, sharpness: 60, blackFraction: 0 }];
    const asset = { id: "slow", name: "slow.mp4", kind: "video", path: "slow.mp4", size: 1, duration: durationMs / 1000, width: 1280, height: 720, fps: 30, codec: "h264", hasAudio: false, fingerprint: "slow-15" };
    const source = { asset, visual, analysis: { assetId: "slow", fingerprint: "slow-15", video: { scenes, quality }, vision: { frames: [] } } } as unknown as SourceEvidence;
    const index = buildFootageIndex([source]);
    const at = visual[45].timeMs;
    expect(index.cuts.map((c) => c.timeMs)).toEqual([at]);
    expect(index.segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of index.segments) expect(seg.endMs <= at - 134 || seg.startMs >= at + 133).toBe(true);
  });
});

describe("title tracing cache", () => {
  const tone = { shadows: [0.1, 0.1, 0.12], midtones: [0.4, 0.42, 0.41], highlights: [0.8, 0.8, 0.82] };
  const shots = [
    { startMs: 0, endMs: 1400, motion: 0.02 },
    { startMs: 1400, endMs: 3000, motion: 0.02 },
  ];
  const before = { width: 1280, height: 720, shots, text: [{ startMs: 2500, endMs: 2900, content: "II", x: 0.5, y: 0.7, width: 0.3, height: 0.1, evidence: { status: "uncertain" } }], personFlashes: [] } as unknown as StyleDNA;
  const traced = {
    ...before,
    text: [{ startMs: 2500, endMs: 2900, content: "DEADLIFT", x: 0.5, y: 0.7, width: 0.3, height: 0.1 }],
    personFlashes: [{ startMs: 100, endMs: 200 }],
    shots: [
      { ...shots[0], tone },
      { ...shots[1], tone, plateTint: "#a0b0c0" },
    ],
  } as unknown as StyleDNA;
  const inputs = { fingerprint: "ref:1:2", interval: { startMs: 0, endMs: 3000 }, dna: before, contours: 12, transcript: [] };
  it("reproduces everything tracing changed: text, person flashes, shot tone and plate tint", () => {
    const rebuilt = applyTitleCache(before, titleCacheEntry(traced, ["note"]))!;
    expect(rebuilt.text).toEqual(traced.text);
    expect(rebuilt.personFlashes).toEqual(traced.personFlashes);
    expect(rebuilt.shots.map((s) => [s.tone, s.plateTint])).toEqual(traced.shots.map((s) => [s.tone, s.plateTint]));
  });
  it("refuses an entry measured on other shot boundaries", () => {
    const other = { ...before, shots: [shots[0], { ...shots[1], startMs: 1500 }] } as unknown as StyleDNA;
    expect(applyTitleCache(other, titleCacheEntry(traced, []))).toBeUndefined();
  });
  it("re-keys on a reviewed word, the shot boundaries or the interval, and on nothing from raw footage", () => {
    const key = titleCacheKey(inputs);
    expect(titleCacheKey({ ...inputs })).toBe(key);
    expect(titleCacheKey({ ...inputs, reviewedTitleCues: "2.7 DEADLIFT" })).not.toBe(key);
    expect(titleCacheKey({ ...inputs, dna: { ...before, shots: [shots[0], { ...shots[1], startMs: 1500 }] } as unknown as StyleDNA })).not.toBe(key);
    expect(titleCacheKey({ ...inputs, interval: { startMs: 0, endMs: 2500 } })).not.toBe(key);
    expect(Object.keys(inputs)).not.toContain("sources");
  });
});

describe("strict reference cuts between set-ups of one unchanged scene", () => {
  const STEP_30 = 1000 / 30;
  /** Small steady movement of one set-up: every frame updates a little, flow matches well. */
  const steady = (count: number): Sample[] => Array.from({ length: count }, (_, k) => ({ change: 0.002, shift: (k % 2 ? 1 : -1) * 0.002, conf: 0.9 }));
  // A new framing of the same scene: no palette or level change, but the layout jumps, flow loses
  // its match and the frame jumps in scale for this one frame.
  const reframe: Sample = { change: 0.03, shift: 0.03, conf: 0.3, expansion: -0.06 };
  it("finds the cut when the geometry breaks twice over (flow reset and a one-frame scale jump)", () => {
    const f = sampled(STEP_30, [...steady(45), reframe, ...steady(45)]);
    expect(frameCuts(f, [], [], true).map((c) => c.timeMs)).toEqual([f[45].timeMs]);
  });
  it("rejects the same jump when the picture snaps back (a zoom pulse, not a shot)", () => {
    const back: Sample = { change: 0.03, shift: -0.03, conf: 0.3, expansion: 0.06 };
    const f = sampled(STEP_30, [...steady(45), reframe, ...steady(5), back, ...steady(45)]);
    expect(frameCuts(f, [], [], true)).toEqual([]);
  });
  it("does not split camera shake (jumps in every frame) or a flow reset without a transform jump", () => {
    const shake: Sample[] = Array.from({ length: 60 }, (_, k) => ({ change: 0.025, shift: (k % 2 ? 1 : -1) * 0.02, conf: 0.5, expansion: (k % 2 ? 1 : -1) * 0.06, panX: (k % 3) - 1 }));
    expect(frameCuts(sampled(STEP_30, [...steady(30), ...shake, ...steady(30)]), [], [], true)).toEqual([]);
    const resetOnly: Sample = { change: 0.03, shift: 0.03, conf: 0.3 };
    expect(frameCuts(sampled(STEP_30, [...steady(45), resetOnly, ...steady(45)]), [], [], true)).toEqual([]);
  });
});

describe("strict reference cuts out of a moving or handheld shot", () => {
  const STEP_30 = 1000 / 30;
  // A handheld shot: every frame moves and global flow only matches moderately (0.45).
  const handheld = (count: number): Sample[] => Array.from({ length: count }, (_, k) => ({ change: 0.012, shift: (k % 2 ? 1 : -1) * 0.006, conf: 0.45, panX: -1 }));
  it("finds a cut when the moderate flow match collapses and the picture changes", () => {
    const cut: Sample = { change: 0.13, shift: 0.05, shadow: 40, luma: 0.62, conf: 0.05, panX: 3 };
    const after: Sample[] = Array.from({ length: 40 }, (_, k) => ({ change: 0.003, shift: (k % 2 ? 1 : -1) * 0.001, conf: 0.7 }));
    const f = sampled(STEP_30, [...handheld(40), cut, ...after]);
    expect(frameCuts(f, [], [], true).map((c) => c.timeMs)).toEqual([f[40].timeMs]);
  });
  it("does not cut a handheld shot whose match dips without the picture changing", () => {
    const dip: Sample = { change: 0.05, shift: 0.01, conf: 0.1, panX: -1 };
    expect(frameCuts(sampled(STEP_30, [...handheld(40), dip, ...handheld(40)]), [], [], true)).toEqual([]);
  });
});

describe("reference grammar keeps measurement, confidence, interpretation and generated value apart", () => {
  const dna = {
    width: 1080,
    height: 1920,
    bpm: 120,
    shots: [
      { startMs: 0, endMs: 1400, motion: 0.02, framing: "wide", boundaryConfidence: null },
      { startMs: 1400, endMs: 3000, motion: 0.0, framing: "close", boundaryConfidence: 0.8, tone: { shadows: [0.1, 0.1, 0.1], midtones: [0.4, 0.4, 0.4], highlights: [0.8, 0.8, 0.8] }, plateTint: "#a0b0c0" },
    ],
    transitions: [{ cutMs: 1400, startMs: 1330, endMs: 1470, kind: "flash", confidence: 0.7, strength: 0.9, direction: null, evidence: ["4 bright samples"] }],
    text: [
      { startMs: 200, endMs: 900, content: "II", evidence: { status: "uncertain", kind: "title", wordStartsMs: [], beatDistanceMs: null } },
      { startMs: 1500, endMs: 2800, content: "NEW HEIGHTS", evidence: { status: "visual-consensus", kind: "title", wordStartsMs: [], beatDistanceMs: null }, depth: { relation: "behind", observations: [{ timeMs: 1600, insideRetention: 0.1, outsideRetention: 0.9 }] } },
    ],
    colorPulses: [{ startMs: 2000, endMs: 2100, confidence: 0.6 }],
    personFlashes: [],
  } as unknown as StyleDNA;
  const g = referenceGrammar(dna);
  it("never promotes an uncertain reading to a fact", () => {
    expect(g.text[0]).toMatchObject({ measurement: { read: "II", status: "uncertain" }, confidence: 0.3, interpretation: "lettering, word not established", generated: { text: null, flagged: true } });
    expect(g.text[1]).toMatchObject({ confidence: 0.8, interpretation: "title", generated: { text: "NEW HEIGHTS", flagged: false } });
  });
  it("links transitions, depth, tone, roles and effects with their evidence", () => {
    expect(g.version).toBe(2);
    expect(g.shots[1].cutIn).toMatchObject({ measurement: { atMs: 1400, evidence: ["4 bright samples"] }, confidence: 0.7, interpretation: "transition", generated: { kind: "flash" } });
    expect(g.depth).toEqual([{ measurement: { textIndex: 1, observations: 1 }, confidence: null, interpretation: "behind" }]);
    expect(g.shots[1].tone.interpretation).toContain("title band masked");
    expect(g.shots.map((s) => s.role.interpretation).every((r) => typeof r === "string" && r.length > 0)).toBe(true);
    expect(g.effects.colorPulses[0]).toMatchObject({ measurement: { startMs: 2000, endMs: 2100 }, confidence: 0.6 });
  });
});

describe("one click: a reference and raw footage alone produce the full recreation", () => {
  const ref = { duration: 15, hasAudio: true };
  it("defaults to recreating the reference: Close Match, its own words, its own framing", () => {
    expect(defaults).toMatchObject({ mode: "Close Match", wording: "original", format: "reference" });
  });
  it("traces titles over the whole reference and keeps its soundtrack when nothing was chosen", () => {
    const { controls, chosen } = autonomousControls(defaults, ref, false);
    expect(controls.interval).toEqual({ startMs: 0, endMs: 15000 });
    expect(controls.audio).toBe("reference");
    expect(chosen.length).toBe(2);
  });
  it("never overrides a choice the user made, and stays within its limits", () => {
    expect(autonomousControls({ ...defaults, interval: { startMs: 1000, endMs: 3000 }, audio: "recreate" }, ref, true).controls).toMatchObject({ interval: { startMs: 1000, endMs: 3000 }, audio: "recreate" });
    expect(autonomousControls(defaults, ref, true).controls.audio).toBe("music");
    expect(autonomousControls(defaults, { duration: 600, hasAudio: true }, false).controls.interval).toBeUndefined();
    expect(autonomousControls({ ...defaults, mode: "Creative Remix" }, ref, false).controls.interval).toBeUndefined();
    expect(autonomousControls(defaults, { duration: 15, hasAudio: false }, false).controls.audio).toBe("music");
  });
});

describe("dissolves in a finished reference", () => {
  const STEP_30 = 1000 / 30;
  // Two steady shots with different layout, palette and level.
  const shotA = (count: number): Sample[] => Array.from({ length: count }, (_, k) => ({ change: 0.001, shift: (k % 2 ? 1 : -1) * 0.0005, conf: 0.95 }));
  const shotB = (count: number): Sample[] => Array.from({ length: count }, (_, k) => ({ change: 0.001, shift: (k % 2 ? 1 : -1) * 0.0005, conf: 0.95 }));
  it("finds a linear blend of two shots and its span, and nothing in a hard cut", () => {
    // 18 frames (0.6 s): each moves the layout 1/18 of the way, palette and level follow.
    const blend: Sample[] = Array.from({ length: 18 }, (_, k) => ({ change: 0.008, shift: 0.24 / 18, cells: [0, 1, 2, 3, 4, 5, 6, 7], shadow: 20 + Math.round((k + 1) * (16 / 18)), luma: 0.33 + ((k + 1) * 0.2) / 18, conf: 0.7 }));
    const f = sampled(STEP_30, [...shotA(40), ...blend, ...shotB(40)]);
    const found = dissolves(f);
    expect(found).toHaveLength(1);
    expect(found[0].startMs).toBeGreaterThanOrEqual(f[38].timeMs);
    expect(found[0].endMs).toBeLessThanOrEqual(f[60].timeMs);
    expect(found[0].residual).toBeLessThan(0.06);
    const cut: Sample = { change: 0.12, shift: 0.24, cells: [0, 1, 2, 3, 4, 5, 6, 7], shadow: 36, luma: 0.53, conf: 0.2 };
    expect(dissolves(sampled(STEP_30, [...shotA(40), cut, ...shotB(40)]))).toEqual([]);
  });
  it("does not take a camera move or a fade to black for a dissolve", () => {
    // A pan: the layout keeps moving before and after (no steady sides), cells shift in turn.
    const pan: Sample[] = Array.from({ length: 90 }, (_, k) => ({ change: 0.006, shift: 0.006, cells: [k % 16, (k + 1) % 16], conf: 0.8 }));
    expect(dissolves(sampled(STEP_30, pan))).toEqual([]);
    // A fade to black ends in a black picture: a shot's fade-out, not a new shot.
    const fade = sampled(STEP_30, [...shotA(40), ...Array.from({ length: 18 }, () => ({ change: 0.008, shift: -0.3 / 18, cells: [0, 1, 2, 3, 4, 5, 6, 7], luma: 0.1, shadow: 4, conf: 0.7 })), ...shotB(40)]);
    for (const x of fade.slice(55)) (x as { blackFraction: number }).blackFraction = 0.95;
    expect(dissolves(fade)).toEqual([]);
  });
  it("rebuilds a dissolve as the incoming shot fading in above the outgoing one, silent", () => {
    const build = (retimed: boolean) => {
      const p = newProject("Dissolve", 640, 360);
      const asset = { id: "raw", name: "raw.mp4", path: "raw.mp4", kind: "video", width: 640, height: 360, fps: 30, duration: 10, size: 1, hasAudio: true, fingerprint: "t", codec: "h264" } as const;
      p.assets = [asset];
      const left = newClip(p.tracks[0].id, 0, 60, "media", asset),
        right = newClip(p.tracks[0].id, 60, 60, "media", asset);
      right.sourceIn = 120;
      right.keyframes.scale = [{ frame: 0, value: 1.4, easing: "linear" }];
      // A retimed incoming shot has no clean earlier frames to borrow.
      if (retimed) right.timeRemap = { sourceOffset: 0, keys: [{ frame: 0, speed: 0.8, easing: "smooth" }, { frame: 60, speed: 0.8, easing: "smooth" }] };
      p.clips = [left, right];
      const call = { tool: "sequence.transition" as const, sequenceId: "main", id: "dx", trackId: "fx", leftId: left.id, rightId: right.id, before: 18, after: 2, strength: 0.9, kind: "dissolve" as const };
      return { next: new History(p).execute(p, "dissolve", addReferenceTransition(call)), right };
    };
    const { next, right } = build(false);
    const layer = next.clips.find((c) => c.id === "dx")!;
    expect(layer).toMatchObject({ start: 42, duration: 18, sourceIn: 102, gain: -60, assetId: "raw" });
    expect(layer.keyframes.scale).toEqual(right.keyframes.scale);
    expect(layer.keyframes.opacity?.map((k) => k.value)).toEqual([0, 1]);
    expect(next.tracks.findIndex((t) => t.id === "fx")).toBeLessThan(next.tracks.findIndex((t) => t.id === right.trackId));
    expect(build(true).next.clips.some((c) => c.id === "dx")).toBe(false);
  });
});

describe("a chosen alternative take carries its own look", () => {
  it("fits the reference shot's tone to the take's own measured tone, or none without samples", () => {
    const tone = (k: number) => [[10 * k, 10 * k, 10 * k], [60 * k, 60 * k, 60 * k], [100 * k, 100 * k, 100 * k], [150 * k, 150 * k, 150 * k], [200 * k, 200 * k, 200 * k]];
    const samples = [0, 500, 1000, 1500].map((timeMs) => ({ timeMs, tone: tone(1) })) as unknown as Parameters<typeof takeCurves>[0];
    const target = tone(1.1) as unknown as Parameters<typeof takeCurves>[3];
    const curves = takeCurves(samples, 0, 1500, target)!;
    expect(curves.red.length).toBeGreaterThan(2);
    expect(curves.red.find(([x]) => Math.abs(x - 100 / 255) < 1e-3)?.[1]).toBeCloseTo(110 / 255, 2);
    expect(takeCurves([], 0, 1500, target)).toBeNull();
  });
});

describe("bars follow the reference shots that show them", () => {
  it("counts a shot as barred only when most of its samples show bars, and letterboxes only those spans", () => {
    expect(barred({ letterbox: 0.9 })).toBe(true);
    expect(barred({ letterbox: 0.077 })).toBe(false);
    const shots = [0, 1333, 2667, 3933, 5667].map((startMs, k) => ({ startMs, camera: { letterbox: [0, 0.9, 0, 0.08, 0.82][k] } }));
    const matches = [0, 1333, 2667, 3933, 5667].map((referenceMs, k) => ({ referenceMs, start: k * 40, duration: 40 }));
    expect(barredRuns(matches, shots)).toEqual([{ start: 40, duration: 40 }, { start: 160, duration: 40 }]);
  });
});

describe("a flash's own ramp is not a shot", () => {
  const tr = (cutMs: number, kind: string, startMs: number, endMs: number) => ({ cutMs, kind, startMs, endMs, confidence: 0.8, strength: 0.8, direction: null, evidence: [] });
  it("joins a sliver between two flash boundaries to the outgoing shot and keeps one flash at the cut", () => {
    const shots = [{ startMs: 0, endMs: 4933 }, { startMs: 4933, endMs: 5000 }, { startMs: 5000, endMs: 6900 }];
    const out = absorbFlashSlivers(shots, [tr(4933, "flash", 4900, 5000), tr(5000, "flash", 4933, 5134)] as never);
    expect(shots).toEqual([{ startMs: 0, endMs: 5000 }, { startMs: 5000, endMs: 6900 }]);
    expect(out).toEqual([expect.objectContaining({ cutMs: 5000, kind: "flash", startMs: 4900, endMs: 5134 })]);
  });
  it("keeps a short shot that is not inside a flash (a flash-frame insert of other picture)", () => {
    const shots = [{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 2100 }, { startMs: 2100, endMs: 4000 }];
    absorbFlashSlivers(shots, [tr(2000, "cut", 2000, 2000), tr(2100, "cut", 2100, 2100)] as never);
    expect(shots).toHaveLength(3);
  });
});
