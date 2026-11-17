import { expect, it } from "vitest";
import {
  glyphRows,
  inkBounds,
  inkRuns,
  negativeInk,
  titleStrokes,
  voteInk,
} from "../packages/ai/reference/title-ink";
import {
  castTreatment,
  frameTone,
  medianTone,
  type Tone,
} from "../packages/ai/reference/tone";
import { restrictReference } from "../packages/ai/reference/interval";
import {
  plateTintSchema,
  referencePlateTint,
} from "../packages/commands/reference-layers";
import { History } from "../packages/commands";
import {
  newClip,
  newProject,
  parseProject,
  assetSchema,
} from "../packages/project-schema";
import type { StyleDNA } from "../packages/ai/reference/dna";

// Synthetic fixtures. A deterministic generator stands in for a graded plate; no footage or
// reference wording is embedded here.
const W = 160,
  H = 96,
  BAND = { x: 30, y: 28, width: 100, height: 40 };
function random(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
/** Dark green-cast plate with a few bright cool fixtures, like a graded interior. */
function plate(seed: number) {
  const next = random(seed),
    data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const light = (x + 2 * y) % 37 < 3,
        base = light ? 170 + next() * 50 : 12 + next() * 55,
        i = (y * W + x) * 3;
      data[i] = base * (light ? 0.86 : 0.55);
      data[i + 1] = base;
      data[i + 2] = base * (light ? 0.95 : 0.78);
    }
  return data;
}
/** Composite white lettering in difference mode: the plate's photographic negative. */
function stamp(data: Uint8Array, bars: [number, number, number, number][]) {
  const out = data.slice();
  for (const [x0, y0, x1, y1] of bars)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        for (let c = 0; c < 3; c++) out[(y * W + x) * 3 + c] = 255 - data[(y * W + x) * 3 + c];
  return out;
}
const WORD_A: [number, number, number, number][] = [
  [40, 38, 48, 58],
  [54, 38, 62, 58],
  [68, 38, 90, 44],
];
const WORD_B: [number, number, number, number][] = [
  [36, 40, 44, 60],
  [50, 52, 100, 60],
  [106, 40, 114, 60],
];
const truth = (bars: [number, number, number, number][]) => {
  const m = new Uint8Array(BAND.width * BAND.height);
  for (const [x0, y0, x1, y1] of bars)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) m[(y - BAND.y) * BAND.width + x - BAND.x] = 1;
  return m;
};
const iou = (a: Uint8Array, b: Uint8Array) => {
  let both = 0,
    any = 0;
  for (let i = 0; i < a.length; i++) {
    both += a[i] & b[i];
    any += a[i] | b[i];
  }
  return both / Math.max(1, any);
};

it("isolates difference-composited lettering from a graded plate without a color threshold", () => {
  const masks = [1, 2, 3, 4, 5].map((seed) => negativeInk(stamp(plate(seed), WORD_A), W, H, 3, BAND));
  const vote = voteInk(masks, 0.5);
  expect(iou(vote, truth(WORD_A))).toBeGreaterThan(0.85);
  // The bare plate yields no title.
  const empty = voteInk(
    [6, 7, 8].map((seed) => negativeInk(plate(seed), W, H, 3, BAND)),
    0.5,
  );
  expect(empty.reduce((s, v) => s + v, 0)).toBeLessThan(BAND.width * BAND.height * 0.01);
});

it("splits stationary words into runs and ignores an empty frame", () => {
  const frames = [
    ...[1, 2, 3, 4].map((seed) => stamp(plate(seed), WORD_A)),
    plate(5),
    ...[6, 7, 8].map((seed) => stamp(plate(seed), WORD_B)),
    ...[9, 10, 11].map((seed) => stamp(plate(seed), WORD_A)),
  ];
  const samples = frames.map((data, i) => ({
    timeMs: Math.round((i * 1000) / 30),
    mask: negativeInk(data, W, H, 3, BAND),
  }));
  const runs = inkRuns(samples, Math.round((frames.length * 1000) / 30), 30);
  expect(runs.map((r) => r.frames.length)).toEqual([4, 3, 3]);
  expect(runs[1].startMs).toBe(Math.round((5 * 1000) / 30));
  // The second and third words differ although both follow each other without a gap.
  expect(runs[2].startMs).toBe(runs[1].endMs);
});

it("keeps a detached swash near the word and discards distant marks", () => {
  const mask = truth(WORD_A);
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * BAND.width + x] = 1;
  };
  mark(12, 5, 40, 8); // a crossbar swash just above the letters
  mark(88, 0, 99, 3); // a small label in the far corner
  const strokes = titleStrokes(mask, BAND.width, BAND.height, 20, 9, 6);
  const box = inkBounds(strokes, BAND.width, BAND.height)!;
  expect(box.y).toBe(5);
  expect(strokes[1 * BAND.width + 90]).toBe(0);
  expect(glyphRows(strokes, BAND.width, box)).toHaveLength(16);
});

it("measures tone percentiles and solves a cast that lands the median and highlights", () => {
  const tone = frameTone(plate(3), W, H, 3);
  expect(tone).toHaveLength(5);
  expect(tone[2][1]).toBeGreaterThan(tone[2][0]); // green-cast median
  expect(medianTone([tone, tone, tone])).toEqual(tone);
  const source: Tone = [
    [9, 9, 9],
    [40, 38, 30],
    [66, 61, 49],
    [95, 81, 66],
    [195, 197, 197],
  ];
  const target: Tone = [
    [7, 15, 10],
    [15, 28, 24],
    [21, 41, 33],
    [58, 87, 57],
    [125, 158, 128],
  ];
  const cast = castTreatment(source, target, 1);
  const [median, highlight] = cast.predicted;
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(median[c] - target[2][c])).toBeLessThan(4);
    expect(Math.abs(highlight[c] - target[4][c])).toBeLessThan(25);
  }
  // The shadow cast is deeper than the highlight cast: the grade fades toward neutral whites.
  const level = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  expect(level(cast.shadow)[0]).toBeLessThan(level(cast.highlight)[0]);
  expect(castTreatment(source, target, 0).gain).toBe(1);
});

it("builds measured casts as ordinary editable layers that undo and survive saving", () => {
  const p = newProject("Focused grade");
  p.assets.push(
    assetSchema.parse({
      id: "raw",
      name: "raw.mp4",
      kind: "video",
      path: "raw.mp4",
      size: 1,
      duration: 4,
      width: 1280,
      height: 720,
      fps: 30,
      codec: "h264",
      hasAudio: false,
      fingerprint: "raw:1",
    }),
  );
  const track = p.tracks.find((t) => t.kind === "video")!;
  const clip = newClip(track.id, 0, 60, "media");
  clip.assetId = "raw";
  p.clips.push(clip);
  const history = new History(p);
  const shadow = plateTintSchema.parse({
    tool: "sequence.plateTint",
    sequenceId: "main",
    id: "shadow",
    trackId: "cast-track",
    sourceId: clip.id,
    color: "#23889c",
    strength: 1,
    treatment: "shadow-cast",
  });
  let next = history.execute(p, "Shadow cast", referencePlateTint(shadow));
  next = history.execute(
    next,
    "Highlight cast",
    referencePlateTint({ ...shadow, id: "highlight", trackId: "balance-track", color: "#caffd3", treatment: "highlight-cast" }),
  );
  const made = (id: string) => next.clips.find((c) => c.id === id)!;
  expect(made("shadow")).toMatchObject({
    kind: "shape",
    blendMode: "multiply",
    start: 0,
    duration: 60,
    matte: { layerId: clip.id, mode: "luma-inverted", keepSourceVisible: true },
  });
  expect(made("highlight")).toMatchObject({ blendMode: "multiply", matte: { mode: "alpha" } });
  // Both casts sit above the raw shot, each on its own track.
  const order = (id: string) => next.tracks.findIndex((t) => t.id === made(id).trackId);
  expect(order("shadow")).toBeLessThan(next.tracks.findIndex((t) => t.id === track.id));
  expect(order("shadow")).not.toBe(order("highlight"));
  expect(parseProject(JSON.parse(JSON.stringify(next))).clips).toHaveLength(3);
  const undone = history.undo(next);
  expect(undone.clips.map((c) => c.id)).toEqual([clip.id, "shadow"]);
  expect(history.redo(undone).clips).toHaveLength(3);
});

it("restricts a reference to a focused interval and rejects an oversized one", () => {
  const dna = {
    shots: [
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 9000 },
    ],
    transitions: [{ cutMs: 3000 }, { cutMs: 9000 }],
    colorPulses: [],
    text: [{ startMs: 2500, endMs: 3600, content: "ONE", x: 0, y: 0, width: 0.1, height: 0.1, words: 1 }],
  } as unknown as StyleDNA;
  const focused = restrictReference(dna, { startMs: 1000, endMs: 3500 });
  expect(focused.shots.map((s) => [s.startMs, s.endMs])).toEqual([
    [1000, 3000],
    [3000, 3500],
  ]);
  expect(focused.transitions).toHaveLength(1);
  expect(focused.text![0]).toMatchObject({ startMs: 2500, endMs: 3500 });
  expect(() => restrictReference(dna, { startMs: 0, endMs: 8500 })).toThrow(/eight seconds/);
});
