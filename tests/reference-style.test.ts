import { describe, it, expect } from "vitest";
import { newProject, newClip, parseProject } from "../packages/project-schema";
import { History } from "../packages/commands";
import { referenceGain } from "../packages/ai/reference/planner";
import {
  addReferenceTransition,
  type referenceTransitionSchema,
} from "../packages/commands/reference-transition";
import {
  characterizeTransitions,
  layoutSimilarity,
  measuredColor,
  separateColorPulses,
  type VisualFrame,
} from "../packages/ai/reference/visual";
import type { Shot } from "../packages/ai/reference/dna";
import type { z } from "zod";
import measuredPulses from "./fixtures/reference-color-pulses.json";
const shots: Shot[] = [0, 1000].map((startMs) => ({
  startMs,
  endMs: startMs + 1000,
  motion: 0.1,
  luma: 0.4,
  framing: "wide",
  fadeIn: false,
  fadeOut: false,
  boundaryConfidence: 0.9,
}));
const frame = (
  timeMs: number,
  override: Partial<VisualFrame> = {},
): VisualFrame => ({
  timeMs,
  luma: 0.4,
  contrast: 0.2,
  saturation: 0.4,
  temperature: null,
  sharpness: 0.12,
  change: 0.01,
  whiteFraction: 0,
  blackFraction: 0,
  layout: Array(16).fill(0.4),
  ...override,
});
const samples = () => Array.from({ length: 25 }, (_, i) => frame(600 + i * 33));
describe("measured reference transition evidence", () => {
  it("separates two real color-inversion flashes from source cuts", () => {
    const boundaries = [3967, 4633, 4700, 4767, 4833, 9033];
    const sourceShots: Shot[] = boundaries
      .slice(0, -1)
      .map((startMs, i) => ({
        ...shots[0],
        startMs,
        endMs: boundaries[i + 1],
      }));
    const pulses = separateColorPulses(sourceShots, measuredPulses.frames);
    expect(pulses.map((p) => [p.startMs, p.endMs])).toEqual([
      [4633, 4700],
      [4767, 4833],
    ]);
    expect(sourceShots).toHaveLength(1);
    expect(sourceShots[0]).toMatchObject({ startMs: 3967, endMs: 9033 });
    const realCut = [
      { ...shots[0], startMs: 0, endMs: 1000 },
      { ...shots[1], startMs: 1000, endMs: 2000 },
    ];
    expect(separateColorPulses(realCut, measuredPulses.frames)).toEqual([]);
    expect(realCut).toHaveLength(2);
  });
  it("preserves neutral grades and bounds gain for low-chroma footage", () => {
    expect(referenceGain(0, 0.8, 0.75, 0.12, 1.6)).toBeLessThan(1.5);
    expect(referenceGain(0.3, 0.3, 1, 0.12, 1.6)).toBe(1);
    expect(referenceGain(0.1, 0.7, 0, 0.12, 1.6)).toBe(1);
  });
  it("requires a transient exposure/detail signature rather than a hard cut or static white scene", () => {
    const plain = samples();
    expect(characterizeTransitions(shots, plain, [])[0].kind).toBe("cut");
    const flash = plain.map((f) =>
      Math.abs(f.timeMs - 1000) < 40
        ? { ...f, luma: 0.99, whiteFraction: 0.99, sharpness: 0 }
        : f,
    );
    expect(characterizeTransitions(shots, flash, [])[0]).toMatchObject({
      kind: "flash",
    });
    const whiteScene = plain.map((f) =>
      f.timeMs >= 1000
        ? { ...f, luma: 0.99, whiteFraction: 0.99, sharpness: 0 }
        : f,
    );
    expect(characterizeTransitions(shots, whiteScene, [])[0].kind).toBe("cut");
    const blur = plain.map((f) =>
      Math.abs(f.timeMs - 1000) < 60 ? { ...f, sharpness: 0.01 } : f,
    );
    expect(characterizeTransitions(shots, blur, [])[0]).toMatchObject({
      kind: "blur",
    });
    expect(characterizeTransitions(shots, [], [])[0].confidence).toBe(0.9);
  });
  it("compares spatial composition independently of exposure and ignores flat frames", () => {
    const layout = Array.from({ length: 16 }, (_, i) => 0.1 + i * 0.03);
    expect(
      layoutSimilarity(
        layout,
        layout.map((v) => v * 0.8 + 0.1),
      ),
    ).toBeCloseTo(1);
    expect(layoutSimilarity(layout, [...layout].reverse())).toBeCloseTo(0);
    expect(layoutSimilarity(layout, Array(16).fill(0.5))).toBeNull();
    expect(
      measuredColor(
        [frame(0), frame(1000, { luma: 0.8, temperature: 0.1 })],
        900,
        1100,
      ),
    ).toMatchObject({ luma: 0.8, temperature: 0.1 });
  });
});
describe("editable reference transitions", () => {
  function fixture(kind: "flash" | "blur") {
    const p = newProject("Transitions", 640, 360);
    const left = newClip(p.tracks[0].id, 0, 60),
      right = newClip(p.tracks[0].id, 60, 60);
    p.clips.push(left, right);
    const call: z.infer<typeof referenceTransitionSchema> = {
      tool: "sequence.transition",
      sequenceId: "main",
      id: "transition",
      trackId: "effects",
      leftId: left.id,
      rightId: right.id,
      kind,
      before: 5,
      after: 6,
      strength: 0.8,
    };
    return { p, left, right, call };
  }
  for (const kind of ["flash", "blur"] as const)
    it(
      kind + " persists ordinary editable animation and undoes atomically",
      () => {
        const { p, call } = fixture(kind),
          history = new History(p);
        // Bare media layers have no sources in this command-only fixture.
        const edited = history.execute(
          p,
          "Transition",
          addReferenceTransition(call),
        );
        const c = edited.clips.at(-1)!;
        if (kind === "flash") {
          expect(c.start).toBe(55);
          expect(c.duration).toBe(11);
          expect(c.kind).toBe("shape");
          expect(c.keyframes.opacity.map((k) => k.value)).toEqual([0, 0.8, 0]);
          expect(edited.tracks[0].id).toBe("effects");
        } else {
          expect(edited.clips).toHaveLength(2);
          expect(
            edited.clips[0].effectStack[0].keys.map((k) => k.value),
          ).toEqual([0, 25.6]);
          expect(c.effectStack[0].keys.map((k) => k.value)).toEqual([25.6, 0]);
        }
        expect(history.undo(edited)).toEqual(p);
        expect(history.redo(p).clips).toEqual(edited.clips);
        const serialized = JSON.parse(JSON.stringify(edited));
        // Use shapes for unsourced dummy clips before exercising the canonical schema.
        serialized.clips
          .filter((c: any) => c.kind === "media")
          .forEach((c: any) => (c.kind = "shape"));
        expect(parseProject(serialized).clips.at(-1)?.effectStack).toEqual(
          c.effectStack,
        );
      },
    );
  it("rejects invalid adjacency, locked tracks and excessive transition duration", () => {
    const { p, left, right, call } = fixture("blur");
    right.start++;
    expect(() =>
      new History(p).execute(p, "bad", addReferenceTransition(call)),
    ).toThrow(/adjacent/);
    right.start--;
    p.tracks[0].locked = true;
    expect(() =>
      new History(p).execute(p, "bad", addReferenceTransition(call)),
    ).toThrow(/unlocked/);
    p.tracks[0].locked = false;
    expect(() =>
      new History(p).execute(
        p,
        "bad",
        addReferenceTransition({ ...call, before: left.duration + 1 }),
      ),
    ).toThrow(/exceeds/);
    expect(p.clips).toHaveLength(2);
  });
});
