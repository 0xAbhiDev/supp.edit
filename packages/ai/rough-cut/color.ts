import type { EffectType } from "../../effects/model";
import type { PlannedShot } from "./planner";
import type { GymStyleProfile } from "./styles";
export interface ShotTreatment {
  type: EffectType;
  value: number;
  reason: string;
}
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
/** Initial luma matching followed by restrained global treatment. RGB/skin/WB analysis is a separate pass. */
export function initialShotColor(
  shots: readonly PlannedShot[],
  style: GymStyleProfile,
): ShotTreatment[][] {
  const lumas = shots
    .map((s) => s.candidate.qualitySignals.meanLuma)
    .filter((x): x is number => x !== null && x > 0.02)
    .sort((a, b) => a - b);
  const target = lumas.length ? lumas[Math.floor(lumas.length / 2)] : null;
  return shots.map((s) => {
    const q = s.candidate.qualitySignals,
      result: ShotTreatment[] = [];
    if (target !== null && q.meanLuma !== null && q.meanLuma > 0.02) {
      const brightness = clamp(
        Math.sqrt(target / q.meanLuma),
        0.9,
        (q.clippedFraction ?? 0) > 0.03 ? 1 : 1.1,
      );
      if (Math.abs(brightness - 1) > 0.015)
        result.push({
          type: "brightness",
          value: brightness,
          reason:
            "Bounded exposure match to the selected shots' median measured luma",
        });
    }
    // Existing contrast is centered on mid-grey. Reduce it for shadow-heavy/highlight-clipped material.
    const headroom = clamp(
      1 - 3 * (q.darkFraction ?? 0) - 4 * (q.clippedFraction ?? 0),
      0,
      1,
    );
    const contrast = 1 + (style.contrastTarget - 1) * headroom;
    if (Math.abs(contrast - 1) > 0.005)
      result.push({
        type: "contrast",
        value: contrast,
        reason: `${style.name}: contrast reduced when measured shadows/highlights have little headroom`,
      });
    if (Math.abs(style.saturationTarget - 1) > 0.005)
      result.push({
        type: "saturation",
        value: style.saturationTarget,
        reason: `${style.name}: restrained global saturation; no skin segmentation claim`,
      });
    return result;
  });
}
