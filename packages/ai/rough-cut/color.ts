import type { EffectType, Effect } from "../../effects/model";
import type { PlannedShot } from "./planner";
import type { GymStyleProfile } from "./styles";
import type { ColorStats } from "./matching";
export interface ShotTreatment {
  type: EffectType;
  value: number;
  reason: string;
  parameters?: Effect["parameters"];
}
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
/** Initial luma matching followed by restrained global treatment. RGB/skin/WB analysis is a separate pass. */
export function initialShotColor(
  shots: readonly PlannedShot[],
  style: GymStyleProfile,
  measured: ReadonlyMap<string, ColorStats> = new Map(),
): ShotTreatment[][] {
  const lumas = shots
    .map(
      (s) =>
        measured.get(s.candidate.id)?.meanLuma ??
        s.candidate.qualitySignals.meanLuma,
    )
    .filter((x): x is number => x !== null && x > 0.02)
    .sort((a, b) => a - b);
  const target = lumas.length ? lumas[Math.floor(lumas.length / 2)] : null;
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : null;
  };
  const saturationTarget = median(
      [...measured.values()].map((m) => m.meanSaturation),
    ),
    contrastTarget = median([...measured.values()].map((m) => m.contrastStd)),
    temperatureTarget = median(
      [...measured.values()].flatMap((m) =>
        m.neutralTemperature === null ? [] : [m.neutralTemperature],
      ),
    );
  return shots.map((s) => {
    const measurement = measured.get(s.candidate.id),
      q = {
        ...s.candidate.qualitySignals,
        ...(measurement ? { meanLuma: measurement.meanLuma } : {}),
      },
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
    // The tonal curve fixes black and white endpoints; also reduce strength for limited source headroom.
    const headroom = clamp(
      1 - 3 * (q.darkFraction ?? 0) - 4 * (q.clippedFraction ?? 0),
      0,
      1,
    );
    if (
      measurement?.neutralTemperature !== null &&
      measurement?.neutralTemperature !== undefined &&
      temperatureTarget !== null
    ) {
      const temperature = clamp(
        (temperatureTarget - measurement.neutralTemperature) / 0.08,
        -0.25,
        0.25,
      );
      if (Math.abs(temperature) > 0.02)
        result.push({
          type: "temperature",
          value: temperature,
          reason:
            "Bounded matching of low-chroma RGB cast proxy; not a measured color temperature or skin mask",
        });
    }
    const contrastMatch =
      measurement && contrastTarget !== null && measurement.contrastStd > 0.02
        ? clamp((contrastTarget / measurement.contrastStd) ** 0.25, 0.97, 1.03)
        : 1;
    const contrast = clamp(
      (1 + (style.contrastTarget - 1) * headroom) * contrastMatch,
      0.95,
      1.15,
    );
    if (Math.abs(contrast - 1) > 0.005)
      result.push({
        type: "tonalContrast",
        value: contrast,
        reason: `${style.name}: contrast reduced when measured shadows/highlights have little headroom`,
      });
    const saturationMatch =
      measurement &&
      saturationTarget !== null &&
      measurement.meanSaturation > 0.02
        ? clamp(
            (saturationTarget / measurement.meanSaturation) ** 0.3,
            0.96,
            1.04,
          )
        : 1;
    if (Math.abs(style.saturationTarget * saturationMatch - 1) > 0.005)
      result.push({
        type: "saturation",
        value: style.saturationTarget * saturationMatch,
        reason: `${style.name}: restrained global saturation; no skin segmentation claim`,
      });
    if (style.vignette)
      result.push({
        type: "vignette",
        value: style.vignette,
        reason: "Subtle edge falloff",
      });
    const sharpen =
      style.sharpening * clamp(1 - (q.sharpness ?? 1500) / 1500, 0, 1);
    if (sharpen > 0.015)
      result.push({
        type: "sharpen",
        value: sharpen,
        reason:
          "Bounded sharpening, reduced for already sharp measured footage; neighbor-range clamp prevents halos",
      });
    if (style.grain.amount)
      result.push({
        type: "grain",
        value: style.grain.amount,
        parameters: { size: style.grain.size, softness: style.grain.softness },
        reason:
          "Subtle deterministic monochrome grain with editable size and softness",
      });
    return result;
  });
}
