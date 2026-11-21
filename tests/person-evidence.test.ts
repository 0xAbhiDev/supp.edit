import { describe, expect, it } from "vitest";
import { confirmedPeople } from "../packages/ai/reference/person-evidence";
import { annotateSubjects, personAbsent } from "../packages/ai/reference/subject-shape";
import type { PersonSample } from "../packages/ai/reference/subject-mask";

const outline = Array.from({ length: 96 }, (_, k) => [0.5 + 0.2 * Math.cos((k / 96) * 2 * Math.PI), 0.5 + 0.3 * Math.sin((k / 96) * 2 * Math.PI)] as [number, number]);
const samples = (from: number, to: number, step = 500): PersonSample[] => {
  const out: PersonSample[] = [];
  for (let t = from; t < to; t += step) out.push({ timeMs: t, points: outline });
  return out;
};
const frame = (timeMs: number, sceneStartMs: number, sceneEndMs: number, detections: { label: string; confidence: number }[]) => ({
  timeMs,
  sceneStartMs,
  sceneEndMs,
  detections: detections.map((d) => ({ ...d, bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.8 } })),
});
const person = { label: "person", confidence: 0.8 };
const table = { label: "dining table", confidence: 0.7 };

describe("person outlines the matcher may treat as a person", () => {
  it("drops every outline of a clip the object detector never sees a person in", () => {
    const checked = confirmedPeople(samples(0, 20_000), [frame(1250, 0, 20_000, [table]), frame(3750, 0, 20_000, []), frame(6250, 0, 20_000, [table]), frame(8750, 0, 20_000, []), frame(11_250, 0, 20_000, []), frame(13_750, 0, 20_000, []), frame(16_250, 0, 20_000, []), frame(18_750, 0, 20_000, [])]);
    expect(checked.people).toBeUndefined();
    expect(checked.rejected).toBe(40);
    expect(checked.outlined).toBe(40);
  });

  it("keeps outlines near a detected person and empties those the samples around them contradict", () => {
    // One scene of 40 s: a person at 2.5–7.5 s only.
    const frames = [1250, 3750, 6250, 8750, 11_250, 13_750, 16_250, 18_750].map((t) => frame(t, 0, 40_000, t >= 2500 && t <= 7500 ? [person] : [table]));
    const checked = confirmedPeople(samples(0, 20_000), frames);
    const kept = checked.people!.filter((p) => p.points.length).map((p) => p.timeMs);
    expect(kept[0]).toBe(0);
    expect(Math.max(...kept)).toBeLessThanOrEqual(6250 + 5000);
    expect(checked.people!.find((p) => p.timeMs === 15_000)!.points).toEqual([]);
    expect(checked.people).toHaveLength(40);
  });

  it("never lets a detector sample confirm an outline across a scene change", () => {
    const frames = [frame(1000, 0, 2000, [person]), frame(3000, 2000, 6000, [table])];
    const checked = confirmedPeople(samples(2000, 6000), frames);
    expect(checked.people).toBeUndefined();
  });

  it("keeps outlines no detector sample covers, and everything when there is no detector", () => {
    const far = confirmedPeople(samples(30_000, 31_000), [frame(1250, 0, 40_000, [table])]);
    expect(far.people?.every((p) => p.points.length)).toBe(true);
    expect(far.unverified).toBe(2);
    const none = confirmedPeople(samples(0, 2000), undefined);
    expect(none.people).toHaveLength(4);
    expect(none.rejected).toBe(0);
  });

  it("counts any person the detector reports (from its own 0.3 floor), not lower", () => {
    expect(confirmedPeople(samples(0, 1000), [frame(500, 0, 1000, [{ label: "person", confidence: 0.32 }])]).people).toHaveLength(2);
    expect(confirmedPeople(samples(0, 1000), [frame(500, 0, 1000, [{ label: "person", confidence: 0.2 }])]).people).toBeUndefined();
  });

  it("keeps samples that measured nobody as they are", () => {
    const mixed: PersonSample[] = [{ timeMs: 0, points: [] }, { timeMs: 500, points: outline }];
    const checked = confirmedPeople(mixed, [frame(250, 0, 1000, [person])]);
    expect(checked.people).toEqual(mixed);
    expect(checked.outlined).toBe(1);
  });

  it("returns every sample with the contradicted ones emptied, for measured absence", () => {
    const checked = confirmedPeople(samples(0, 4000), [frame(1000, 0, 4000, [table])]);
    expect(checked.people).toBeUndefined();
    expect(checked.samples).toHaveLength(8);
    expect(checked.samples!.every((p) => p.points.length === 0)).toBe(true);
  });
});

describe("reference shots measured with nobody in them", () => {
  it("marks a shot absent only when it was segmented and nothing confirmed remains", () => {
    const measured: PersonSample[] = [...samples(0, 2000), ...samples(2000, 4000).map((p) => ({ timeMs: p.timeMs, points: [] }))];
    const dna = { shots: [{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 4000 }, { startMs: 4000, endMs: 6000 }] as { startMs: number; endMs: number; subjectShape?: unknown; subjectAbsent?: true }[] };
    annotateSubjects(dna as never, measured, 9 / 16);
    expect(dna.shots[0].subjectShape).toBeDefined();
    expect(dna.shots[0].subjectAbsent).toBeUndefined();
    expect(dna.shots[1].subjectAbsent).toBe(true);
    // Not segmented at all: unknown, not absent.
    expect(dna.shots[2].subjectAbsent).toBeUndefined();
    expect(personAbsent(measured, 4000, 6000)).toBe(false);
  });
});
