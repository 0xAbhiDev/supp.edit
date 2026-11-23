import { describe, expect, it } from "vitest";
import { castSignature, castSimilarity, describeCast } from "../packages/ai/reference/cast";
import { cardColor } from "../packages/ai/reference/card";
import { cardRuns } from "../packages/ai/reference/planner";
import { addCardPlate } from "../packages/commands/reference-events";
import { newClip, newProject, newTrack } from "../packages/project-schema";
import type { VisualFrame } from "../packages/ai/reference/visual";

const box = (label: string, height: number, confidence = 0.8) => ({ label, confidence, bounds: { x: 0.3, y: 0.1, width: height * 0.6, height } });
const frame = (detections: ReturnType<typeof box>[], shotScale: "close" | "medium" | "wide" | null = null) => ({ detections, shotScale });

describe("casting: who or what a window shows", () => {
  it("tells a face from a vehicle and a crowd from one person", () => {
    const face = castSignature([frame([box("person", 0.8)], "close"), frame([box("person", 0.75)], "close")])!;
    const plane = castSignature([frame([box("airplane", 0.3)], "wide"), frame([box("airplane", 0.25)], "wide")])!;
    const crowd = castSignature([frame([box("person", 0.3), box("person", 0.28), box("person", 0.25)], "medium")])!;
    expect(face).toMatchObject({ person: 1, crowd: 0, kinds: { person: 1 } });
    expect(plane.kinds.vehicle).toBe(1);
    expect(describeCast(face)).toBe("a person, close");
    expect(describeCast(crowd)).toBe("a crowd, medium");
    expect(castSimilarity(face, face)!.kind).toBe(1);
    expect(castSimilarity(face, plane)!.kind).toBe(0);
    // Two people of different sizes are the same kind: casting leaves them to movement and pose.
    expect(castSimilarity(face, crowd)!.kind).toBe(1);
  });

  it("ignores weak detections and says nothing without frames", () => {
    expect(castSignature([frame([box("dog", 0.5, 0.35)])])!.kinds.none).toBe(1);
    expect(castSignature([])).toBeUndefined();
    expect(castSimilarity(undefined, castSignature([frame([])]))).toBeNull();
  });
});

const visual = (timeMs: number, layout: number[], extra: Partial<VisualFrame> = {}): VisualFrame =>
  ({ timeMs, sharpness: 0.1, change: 0, whiteFraction: 0, blackFraction: 0, layout, ...extra }) as VisualFrame;
const run = (from: number, to: number, make: (t: number, i: number) => VisualFrame) => Array.from({ length: (to - from) / 100 }, (_, i) => make(from + i * 100, i));

describe("title and end cards", () => {
  const white = Array.from({ length: 16 }, (_, i) => (i === 6 ? 0.7 : 0.97)); // one cell of blue words
  it("finds a still, flat card with words and takes its colour", () => {
    const frames = run(0, 2000, (t) => visual(t, white, { whiteFraction: 0.9, highlightRgb: [250, 250, 248] }));
    expect(cardColor(frames, 0, 2000, true)).toBe("#fafaf8");
    const black = run(0, 2000, (t) => visual(t, Array(16).fill(0.03), { blackFraction: 0.95 }));
    expect(cardColor(black, 0, 2000, true)).toBe("#000000");
  });

  it("leaves footage, moving pictures and wordless shots alone", () => {
    const textured = run(0, 2000, (t) => visual(t, Array.from({ length: 16 }, (_, i) => (i % 3) * 0.3), { whiteFraction: 0.7 }));
    expect(cardColor(textured, 0, 2000, true)).toBeNull();
    const moving = run(0, 2000, (t, i) => visual(t, white, { whiteFraction: 0.9, change: i % 2 ? 0.02 : 0 }));
    expect(cardColor(moving, 0, 2000, true)).toBeNull();
    const still = run(0, 2000, (t) => visual(t, white, { whiteFraction: 0.9 }));
    expect(cardColor(still, 0, 2000, false)).toBeNull();
  });

  it("joins consecutive cards of one colour into one plate", () => {
    const shots = [{ startMs: 0, card: { color: "#ffffff" } }, { startMs: 1000, card: { color: "#ffffff" } }, { startMs: 2000 }, { startMs: 3000, card: { color: "#000000" } }];
    const matches = [0, 1000, 2000, 3000].map((referenceMs, i) => ({ referenceMs, start: i * 30, duration: 30 }));
    expect(cardRuns(matches, shots)).toEqual([
      { start: 0, duration: 60, color: "#ffffff" },
      { start: 90, duration: 30, color: "#000000" },
    ]);
  });

  it("places the plate directly above the footage it covers, under the titles", () => {
    const p = newProject("Card", 360, 640);
    const titles = { ...newTrack("video", 1), id: "titles" },
      footage = { ...newTrack("video", 2), id: "footage" };
    p.tracks = [titles, footage];
    p.clips = [{ ...newClip("footage", 0, 90, "media"), id: "shot" }, { ...newClip("titles", 0, 90, "text"), id: "words" }];
    addCardPlate({ tool: "sequence.cardPlate", sequenceId: "main", trackId: "plate", id: "plate-1", start: 0, duration: 60, color: "#ffffff" })(p);
    expect(p.tracks.map((t) => t.id)).toEqual(["titles", "plate", "footage"]);
    const plate = p.clips.find((c) => c.id === "plate-1")!;
    expect(plate.kind).toBe("shape");
    expect(plate.shape).toMatchObject({ type: "rectangle", color: "#ffffff", width: 360, height: 640 });
  });
});

describe("regions kept clear of titles", () => {
  it("stay inside the frame when detections reach past its edge", async () => {
    const { unionBox } = await import("../packages/ai/reference/planner");
    const box = unionBox([
      { x: 0.02, y: 0.1, width: 0.3, height: 0.5 },
      { x: 0.6, y: -0.05, width: 0.55, height: 0.4 },
    ])!;
    expect(box.x).toBe(0.02);
    expect(box.y).toBe(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.width).toBeCloseTo(0.98, 5);
    expect(unionBox([{ x: 1.2, y: 0.2, width: 0.1, height: 0.1 }])).toBeUndefined();
    expect(unionBox([])).toBeUndefined();
  });
});
