import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analysisResultSchema } from "../packages/ai/media-analysis/model";

// A real native analysis (tests/fixtures/gym-analysis.json), with its scene counts changed.
const real = JSON.parse(readFileSync(new URL("./fixtures/gym-analysis.json", import.meta.url), "utf8")).analyses[0];
const withScenes = (analyzedScenes: number, totalScenes: number) => ({ ...real, vision: { ...real.vision, analyzedScenes, totalScenes } });

describe("footage with many scenes", () => {
  it("accepts as many analysed scenes as the native analyser samples (160 up to ~16 minutes)", () => {
    // A 10-minute film has about 150 scenes; the old limit of 32 failed the whole edit.
    expect(analysisResultSchema.safeParse(withScenes(160, 176)).success).toBe(true);
    expect(analysisResultSchema.safeParse(withScenes(600, 1400)).success).toBe(true);
  });

  it("still rejects impossible counts", () => {
    expect(analysisResultSchema.safeParse(withScenes(12, 10)).success).toBe(false);
    expect(analysisResultSchema.safeParse(withScenes(601, 2000)).success).toBe(false);
  });
});
