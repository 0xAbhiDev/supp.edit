import { describe, it, expect } from "vitest";
import capture from "./fixtures/gym-analysis.json";
import realColor from "./fixtures/gym-color.json";
import { assetSchema, newProject } from "../packages/project-schema";
import { analysisResultSchema } from "../packages/ai/media-analysis/model";
import { buildRoughCut, rankMoments } from "../packages/ai/rough-cut/planner";
import { parseEditBrief } from "../packages/ai/rough-cut/model";
import {
  matchAestheticColor,
  colorStatsSchema,
  type ColorBackend,
} from "../packages/ai/rough-cut/matching";
import { previewEditPlan } from "../packages/ai/editor-agent/execution";
const job = {
  signal: new AbortController().signal,
  checkpoint: async () => {},
  report: () => {},
};
function fixture() {
  const p = newProject();
  p.assets = capture.assets.map((a) => assetSchema.parse(a));
  const analyses = capture.analyses.map((a) => analysisResultSchema.parse(a)),
    brief = parseEditBrief(
      "Create a 25-second dark aesthetic gym Reel with music",
    );
  const cut = buildRoughCut(
    p,
    0,
    brief,
    rankMoments(p, analyses, brief),
    p.assets.find((a) => a.kind === "audio")!,
    analyses.find((a) => a.audio)!.audio!.beatMap,
  );
  return { p, cut };
}
describe("Measured shot matching boundaries", () => {
  it("retains actual five-frame RGB observations from six real source files", () => {
    const measured = realColor.map((s) => colorStatsSchema.parse(s));
    expect(measured).toHaveLength(6);
    for (const stats of measured) {
      expect(
        capture.assets.some(
          (a) => a.id === stats.assetId && a.fingerprint === stats.fingerprint,
        ),
      ).toBe(true);
      expect(stats.contrastStd).toBeGreaterThan(0);
      expect(stats.meanLuma).toBeGreaterThan(0);
      expect(stats.sampleCount).toBe(5);
    }
    expect(
      new Set(measured.map((s) => s.meanLuma.toFixed(3))).size,
    ).toBeGreaterThan(3);
  });
  it("writes bounded matches before creative finish and refuses source-mismatched evidence", async () => {
    const { p, cut } = fixture();
    let index = 0;
    // Deliberately contrasting synthetic statistics exercise bounds; not a real-footage acceptance claim.
    const backend: ColorBackend = async (asset, range) => ({
      assetId: asset.id,
      fingerprint: asset.fingerprint,
      cacheKey: "b".repeat(64),
      algorithm: "color-samples-1",
      processing: "LOCAL",
      range,
      meanLuma: ++index % 2 ? 0.15 : 0.7,
      contrastStd: index % 2 ? 0.1 : 0.3,
      meanSaturation: index % 2 ? 0.2 : 0.6,
      neutralTemperature: index % 2 ? -0.06 : 0.06,
      neutralFraction: 0.2,
      sampleCount: 5,
    });
    const result = await matchAestheticColor(p, cut, backend, job);
    expect(result.colorMatchedShots).toBe(cut.shots.length);
    expect(result.color.flat().some((e) => e.type === "temperature")).toBe(
      true,
    );
    for (const effects of result.color) {
      expect(effects.at(-1)?.type).toBe("grain");
      for (const e of effects) {
        if (e.type === "temperature")
          expect(Math.abs(e.value)).toBeLessThanOrEqual(0.25);
        if (e.type === "brightness")
          expect(e.value).toBeGreaterThanOrEqual(0.9);
      }
    }
    expect(
      previewEditPlan(result.plan, p, 0).project.compositions[0].layers.some(
        (c) => c.effectStack.some((e) => e.type === "grain"),
      ),
    ).toBe(true);
    await expect(
      matchAestheticColor(
        p,
        cut,
        async (a, r, j) => ({
          ...(await backend(a, r, j)),
          fingerprint: "changed",
        }),
        job,
      ),
    ).rejects.toThrow(/does not match/);
  });
});
