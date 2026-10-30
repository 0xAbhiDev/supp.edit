import { describe, expect, it } from "vitest";
import captures from "./fixtures/vision-validation.json";
import {
  cosine,
  gymEvidence,
  scoreVisualQuery,
  subjectEvidence,
} from "../packages/ai/media-analysis/evidence";
const validated = captures["nano-fp32"].results;
describe("real captured native vision evidence", () => {
  it("finds visible, multiple and partially occluded people without inventing people in negatives", () => {
    const people = (name: string) =>
      validated
        .find((f) => f.source === name)!
        .detections.filter((d) => d.label === "person");
    expect(
      people("squat.jpg").some(
        (d) => d.confidence > 0.8 && d.bounds.height > 0.5,
      ),
    ).toBe(true);
    expect(people("squat.jpg").some((d) => d.bounds.height < 0.15)).toBe(true);
    expect(people("bench-gym.jpg")).toHaveLength(2);
    expect(people("bench-support.jpg").length).toBeGreaterThanOrEqual(3);
    expect(people("beach.jpg")).toHaveLength(0);
    expect(people("dog.jpg")).toHaveLength(0);
    for (const f of validated)
      for (const d of f.detections) {
        expect(d.bounds.x + d.bounds.width).toBeLessThanOrEqual(1.00001);
        expect(d.bounds.y + d.bounds.height).toBeLessThanOrEqual(1.00001);
      }
    expect(
      subjectEvidence(validated.find((f) => f.source === "bench-support.jpg")!)
        .edgeClipped,
    ).toBe(true);
  });
  it("gates broad training evidence, rejects failed encoder results and unrelated images", () => {
    for (const name of ["bench-gym.jpg", "bench-support.jpg", "squat.jpg"])
      expect(
        gymEvidence(validated.find((f) => f.source === name)!).eligible,
        name,
      ).toBe(true);
    for (const name of ["beach.jpg", "dog.jpg"])
      expect(
        gymEvidence(validated.find((f) => f.source === name)!).eligible,
        name,
      ).toBe(false);
    for (const f of captures["nano-quantized"].results)
      expect(gymEvidence(f).eligible, f.source).toBe(false);
  });
  it("combines measured similarity with detection and labels instead of trusting one score", () => {
    const score = (name: string, query: string) => {
      const f = validated.find((f) => f.source === name)!,
        semantic = f.queries.find((q) => q.query === query)!.cosine,
        s = scoreVisualQuery(query, f);
      return (
        0.55 * Math.max(0, Math.min(1, (semantic - 0.12) / 0.28)) +
        0.2 * s.detector +
        0.15 * s.labels
      );
    };
    for (const query of [
      "a gym",
      "a barbell",
      "a person lifting weights",
      "a bench press",
    ]) {
      expect(score("bench-gym.jpg", query), query).toBeGreaterThan(
        score("beach.jpg", query),
      );
      expect(score("bench-support.jpg", query), query).toBeGreaterThan(
        score("dog.jpg", query),
      );
    }
    expect(score("beach.jpg", "a beach")).toBeGreaterThan(
      score("bench-gym.jpg", "a beach"),
    );
    expect(score("squat.jpg", "a person")).toBeGreaterThan(
      score("dog.jpg", "a person"),
    );
    expect(score("dog.jpg", "outdoors")).toBeGreaterThan(
      score("bench-gym.jpg", "outdoors"),
    );
    for (const f of validated)
      expect(cosine(f.embedding, f.embedding)).toBeCloseTo(1, 5);
    expect(() => cosine([0, 0], [0, 0])).toThrow();
    expect(() => cosine([1], [1, 0])).toThrow();
  });
});
