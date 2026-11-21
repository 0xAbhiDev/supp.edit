import { expect, it } from "vitest";
import {
  baselineAngle,
  distinctInk,
  exposedVote,
  extendIntoHidden,
  inkBounds,
  levelMask,
  lettingDepth,
  trimRows,
} from "../packages/ai/reference/title-ink";
import { fragmentMerges, letterCombinations, pieceOf } from "../packages/ai/reference/title-read";
import { smoothOutlines, traceBoundaries } from "../packages/ai/reference/title-outline";
import { shapeFit, silhouette } from "../packages/ai/reference/subject-shape";
import {
  curveAt,
  curveTables,
  curveTangents,
  identityCurves,
  matchingCurve,
} from "../packages/effects/curves";
import { effectStackSchema } from "../packages/effects/model";
import { finishPixels } from "../packages/engine/finish-effects";
import { referenceTracedTitle, tracedTitleSchema } from "../packages/commands/reference-layers";
import { History } from "../packages/commands";
import { newProject, parseProject } from "../packages/project-schema";

// Synthetic fixtures only: a seeded teal plate, rectangles standing in for letters.
const W = 160,
  H = 96,
  BAND = { x: 0, y: 28, width: 160, height: 40 };
function random(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function plate(seed: number) {
  const next = random(seed),
    data = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const v = 20 + next() * 60;
    data.set([v * 0.5, v, v * 0.85], i * 3);
  }
  return data;
}
const LETTERS: [number, number, number, number][] = [
  [20, 38, 30, 58],
  [40, 38, 50, 58],
  [60, 38, 70, 58],
  [80, 38, 90, 58],
  [100, 38, 110, 58],
];
function paint(data: Uint8Array, rects: [number, number, number, number][], rgb: number[]) {
  const out = data.slice();
  for (const [x0, y0, x1, y1] of rects)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.set(rgb, (y * W + x) * 3);
  return out;
}
const bandIndex = (x: number, y: number) => (y - BAND.y) * BAND.width + x - BAND.x;

it("isolates a flat colored title by its concentration in the band, and ignores neutral ink", () => {
  const red = distinctInk(paint(plate(1), LETTERS, [190, 12, 16]), W, H, 3, BAND);
  const box = inkBounds(red, BAND.width, BAND.height)!;
  expect(box).toMatchObject({ x: 20, y: 10, width: 90, height: 20 });
  const white = distinctInk(paint(plate(2), LETTERS, [235, 235, 235]), W, H, 3, BAND);
  expect(white.reduce((t, v) => t + v, 0)).toBe(0);
});

it("assembles lettering hidden behind a moving person and measures it as behind", () => {
  // A person 12 px wide crosses letters 2–4; while covering a letter it hides it.
  const frames = [0, 1, 2, 3, 4, 5].map((k) => {
    const left = 36 + k * 12,
      person = new Uint8Array(BAND.width * BAND.height),
      mask = new Uint8Array(BAND.width * BAND.height);
    for (let y = 0; y < BAND.height; y++) person.fill(1, y * BAND.width + left, y * BAND.width + left + 16);
    for (const [x0, y0, x1, y1] of LETTERS)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) if (!person[bandIndex(x, y)]) mask[bandIndex(x, y)] = 1;
    return { timeMs: k * 33, mask, person };
  });
  const { ink, known } = exposedVote(frames, 0.4);
  // Every letter is complete, though no single frame shows them all.
  for (const [x0, y0] of LETTERS) expect(ink[bandIndex(x0 + 5, y0 + 10)]).toBe(1);
  expect(known).toBeUndefined();
  expect(lettingDepth(frames, ink).relation).toBe("behind");
  // The same frames with the lettering drawn over the person read as in front.
  const front = frames.map((f) => {
    const mask = new Uint8Array(f.mask.length);
    for (const [x0, y0, x1, y1] of LETTERS)
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[bandIndex(x, y)] = 1;
    return { ...f, mask };
  });
  expect(lettingDepth(front, ink).relation).toBe("front");
});

it("extends a box through never-observed columns and trims specks", () => {
  const mask = new Uint8Array(BAND.width * BAND.height),
    known = new Uint8Array(mask.length).fill(1);
  for (let y = 10; y < 30; y++) mask.fill(1, y * BAND.width + 20, y * BAND.width + 60);
  mask[2 * BAND.width + 30] = 1; // a speck above
  for (let y = 0; y < BAND.height; y++) known.fill(0, y * BAND.width + 60, y * BAND.width + 90);
  const trimmed = trimRows(mask, BAND.width, inkBounds(mask, BAND.width, BAND.height)!);
  expect(trimmed).toMatchObject({ y: 10, height: 20 });
  expect(extendIntoHidden(mask, known, BAND.width, trimmed)).toMatchObject({ x: 20, width: 70 });
});

it("measures a baseline angle and levels the lettering", () => {
  const mask = new Uint8Array(BAND.width * BAND.height),
    angle = (-6 * Math.PI) / 180;
  for (const [x0, , x1] of LETTERS)
    for (let x = x0; x < x1; x++)
      for (let y = 0; y < 18; y++) {
        const yy = Math.round(30 + (x - 60) * Math.tan(angle)) - y;
        if (yy >= 0 && yy < BAND.height) mask[yy * BAND.width + x] = 1;
      }
  const box = inkBounds(mask, BAND.width, BAND.height)!;
  const measured = baselineAngle(mask, BAND.width, box);
  expect(measured).toBeGreaterThan(-7.5);
  expect(measured).toBeLessThan(-4.5);
  const level = levelMask(mask, BAND.width, BAND.height, measured, box.x + box.width / 2, box.y + box.height / 2);
  expect(Math.abs(baselineAngle(level, BAND.width, inkBounds(level, BAND.width, BAND.height)!))).toBeLessThan(1.5);
});

it("combines two readings letter by letter without inventing letters", () => {
  const words = letterCombinations("HONCRABLE", "HOFORABLE");
  expect(words).toContain("HONORABLE");
  expect(words.every((w) => [...w].every((ch, i) => ch === "HONCRABLE"[i] || ch === "HOFORABLE"[i]))).toBe(true);
  expect(letterCombinations("AB", "ABC")).toEqual([]);
});

it("lets partial readings of one word correct each other, and nothing else", () => {
  // OCR saw the start clearly, the end clearly, and the whole word with one letter misread.
  expect(fragmentMerges(["HON", "RABLE", "HOFORABLE"])).toEqual(["HONORABLE"]);
  // Agreeing readings add nothing; a piece that fits two places equally says nothing.
  expect(fragmentMerges(["HONORABLE", "RABLE"])).toEqual([]);
  expect(fragmentMerges(["ABAB", "ABABXAB"]).length).toBe(0);
  // A piece too different from the word (more than one letter in three) is not a correction.
  expect(fragmentMerges(["XYZ", "HOFORABLE"])).toEqual([]);
  // Merges only propose: a misread piece proposes a misread word, and the stroke fit decides.
  expect(fragmentMerges(["HOF", "HONORABLE"])).toEqual(["HOFORABLE"]);
});

it("recognises OCR pieces of a word, misread letters included, and nothing else", () => {
  for (const piece of ["HON", "RABLE", "HOF", "ORABLE", "honorable"]) expect(pieceOf(piece, "HONORABLE")).toBe(true);
  expect(pieceOf("WAX", "HONORABLE")).toBe(false);
  expect(pieceOf("INCLINE", "HONORABLE")).toBe(false);
  expect(pieceOf("H", "HONORABLE")).toBe(false);
});

it("traces outer contours and counters, and smooths their edges", () => {
  const mask = new Uint8Array(40 * 40);
  for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) if (x < 15 || x >= 25 || y < 15 || y >= 25) mask[y * 40 + x] = 1;
  const loops = traceBoundaries(mask, 40, { x: 0, y: 0, width: 40, height: 40 });
  expect(loops).toHaveLength(2);
  const outlines = smoothOutlines(mask, 40, { x: 0, y: 0, width: 40, height: 40 });
  expect(outlines.filter((o) => !o.hole)).toHaveLength(1);
  expect(outlines.filter((o) => o.hole)).toHaveLength(1);
  expect(outlines.every((o) => o.points.length >= 4 && o.points.length <= 128)).toBe(true);
});

it("prefers a standing subject for a standing reference", () => {
  const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const reference = silhouette(box(0.4, 0.1, 0.55, 0.9), 16 / 9)!,
    standing = silhouette(box(0.3, 0.2, 0.42, 0.95), 16 / 9)!,
    lying = silhouette(box(0.2, 0.5, 0.8, 0.7), 16 / 9)!;
  expect(shapeFit(reference, standing)).toBeGreaterThan(shapeFit(reference, lying) + 0.3);
});

it("matches measured percentiles with a monotone tone curve applied identically by the canvas path", () => {
  const source = [9, 40, 66, 95, 195],
    target = [7, 15, 21, 58, 125],
    points = matchingCurve(source, target),
    tangents = curveTangents(points);
  source.forEach((s, i) => expect(Math.abs(curveAt(points, tangents, s / 255) * 255 - target[i])).toBeLessThan(1.5));
  for (let v = 1; v < 256; v++) expect(curveAt(points, tangents, v / 255)).toBeGreaterThanOrEqual(curveAt(points, tangents, (v - 1) / 255) - 1e-9);
  const identity = curveTables(identityCurves(), 1)[0];
  expect(Math.max(...[...identity].map((y, v) => Math.abs(y - v / 255)))).toBeLessThan(1e-6);
  const pixels = new Uint8ClampedArray([66, 66, 66, 255, 66, 66, 66, 0]);
  const curves = { red: points, green: points, blue: points };
  finishPixels(pixels, 2, 1, "curves", 1, curves, 0);
  expect(Math.abs(pixels[0] - 21)).toBeLessThanOrEqual(1);
  expect(pixels[4]).toBe(66); // transparent pixels are untouched
});

it("validates tone curve effects in the editable stack", () => {
  const curve = { id: "c", type: "curves", enabled: true, value: 1, keys: [], parameters: identityCurves() };
  expect(effectStackSchema.parse([curve])).toHaveLength(1);
  expect(() => effectStackSchema.parse([{ ...curve, parameters: undefined }])).toThrow();
  expect(() => effectStackSchema.parse([{ ...curve, parameters: { size: 1, softness: 0.5 } }])).toThrow();
  expect(() =>
    effectStackSchema.parse([{ ...curve, parameters: { ...identityCurves(), red: [[0.5, 0], [0.2, 1]] } }]),
  ).toThrow();
});

it("creates traced lettering as an editable masked shape that undoes and saves", () => {
  const p = newProject("Traced");
  const history = new History(p);
  const call = tracedTitleSchema.parse({
    tool: "sequence.tracedTitle",
    sequenceId: "main",
    id: "traced",
    trackId: "letters",
    content: "Word",
    start: 3,
    duration: 20,
    color: "#ffffff",
    blend: "difference",
    outline: [
      { hole: false, points: [[0.2, 0.2], [0.6, 0.2], [0.6, 0.5], [0.2, 0.5]] },
      { hole: true, points: [[0.3, 0.3], [0.3, 0.4], [0.5, 0.4], [0.5, 0.3]] },
    ],
  });
  const next = history.execute(p, "Traced lettering", referenceTracedTitle(call));
  const layer = next.clips.find((c) => c.id === "traced")!;
  expect(layer).toMatchObject({ kind: "shape", blendMode: "difference", start: 3, duration: 20, name: "Traced lettering · Word" });
  expect(layer.masks.map((m) => m.mode)).toEqual(["add", "subtract"]);
  expect(parseProject(JSON.parse(JSON.stringify(next))).clips).toHaveLength(1);
  expect(history.undo(next).clips).toHaveLength(0);
});

it("recovers the tone of the shown part of a frame from stripe histograms", async () => {
  const { frameStripes, frameTone, spanTone } = await import("../packages/ai/reference/tone");
  // Dark left half, bright right half.
  const w = 64,
    h = 32,
    data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.fill(x < w / 2 ? 20 : 200, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const sample = { stripes: frameStripes(data, w, h, 3) };
  const whole = spanTone([sample], 0, 1)!,
    right = spanTone([sample], 0.5, 1)!;
  expect(Math.abs(whole[2][0] - frameTone(data, w, h, 3)[2][0])).toBeLessThan(12);
  expect(right[0][1]).toBeGreaterThan(190);
  expect(spanTone([{}], 0, 1)).toBeUndefined();
});
