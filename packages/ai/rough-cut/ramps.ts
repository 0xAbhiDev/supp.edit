import type { PlannedShot } from "./planner";
import type { EditBrief } from "./model";
import { gymStyles } from "./styles";
import { sourceFrameAt, type TimeRemap } from "../../time-remap/model";
import { eventImpact, type MusicEvent } from "./music";
export interface ProposedRamp {
  candidateId: string;
  curve: TimeRemap;
  beforeFrames: number;
  afterFrames: number;
  reason: string;
  enabled: boolean;
}
/** Use a small subset of measured high-motion ranges. Preserve chosen musical boundaries and source endpoints. */
export function proposeRamps(
  shots: readonly PlannedShot[],
  brief: EditBrief,
  rate: number,
  events: MusicEvent[],
  disabled: readonly string[] = [],
): ProposedRamp[] {
  if (brief.speedRamps === "off") return [];
  const fraction = brief.style
    ? gymStyles[brief.style].rampFraction
    : brief.speedRamps === "dynamic"
      ? 0.35
      : 0.2;
  const eligible = shots
    .filter((s) => s.duration / rate >= 1.8 && s.candidate.motionScore >= 0.12)
    .sort(
      (a, b) =>
        b.candidate.motionScore * 0.65 +
        b.candidate.overallScore * 0.35 -
        (a.candidate.motionScore * 0.65 + a.candidate.overallScore * 0.35),
    );
  const count = Math.min(3, Math.ceil(shots.length * Math.max(0.15, fraction)));
  return eligible.slice(0, count).map((shot) => {
    const duration = shot.duration,
      measured = Math.max(
        0.3,
        Math.min(
          0.7,
          ((shot.candidate.motionPeakMs * rate) / 1000 - shot.sourceIn) /
            duration,
        ),
      );
    const strong =
      brief.beatSync === "off"
        ? undefined
        : events
            .filter(
              (e) =>
                e.kind !== "beat" &&
                (e.timeMs * rate) / 1000 > shot.startFrame + duration * 0.3 &&
                (e.timeMs * rate) / 1000 < shot.startFrame + duration * 0.7,
            )
            .sort(
              (a, b) => eventImpact([b], b.timeMs) - eventImpact([a], a.timeMs),
            )[0];
    const peak = strong
      ? ((strong.timeMs * rate) / 1000 - shot.startFrame) / duration
      : measured;
    const intensity =
        shot.candidate.motionScore *
        (brief.speedRamps === "dynamic" ? 0.65 : 0.32),
      slow = 1 - intensity;
    let curve: TimeRemap = {
      sourceOffset: 0,
      keys: [
        { frame: 0, speed: 1, easing: "smooth" },
        {
          frame: Math.round(duration * (peak - 0.2)),
          speed: 1,
          easing: "smooth",
        },
        { frame: Math.round(duration * peak), speed: slow, easing: "smooth" },
        {
          frame: Math.round(duration * (peak + 0.2)),
          speed: 1,
          easing: "smooth",
        },
        { frame: duration, speed: 1, easing: "smooth" },
      ],
    };
    const area = sourceFrameAt({ sourceIn: 0, timeRemap: curve }, duration);
    curve = {
      ...curve,
      keys: curve.keys.map((k) => ({
        ...k,
        speed: (k.speed * duration) / area,
      })),
    };
    return {
      candidateId: shot.candidate.id,
      curve,
      beforeFrames: duration,
      afterFrames: duration,
      enabled: !disabled.includes(shot.candidate.id),
      reason: `Measured motion ${shot.candidate.motionScore.toFixed(2)}, highlight rank ${shot.candidate.overallScore.toFixed(2)}; smooth ${brief.speedRamps} ramp${strong ? ` near measured ${strong.kind}` : " near the measured motion peak"}. Source endpoints and musical cut timing are preserved.`,
    };
  });
}
