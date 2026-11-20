import { z } from "zod";
import type { MotionSample } from "./motion";
import type { Shot } from "./dna";

const unit = z.number().finite().min(0).max(1);
const byte = z.number().int().min(0).max(255);
const rgb = z.tuple([byte, byte, byte]);
export const pulsePaletteSchema = z
  .object({
    shadows: z.string().regex(/^#[0-9a-f]{6}$/i),
    highlights: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();
export const measuredColorSchema = z
  .object({
    luma: unit,
    contrast: unit,
    saturation: unit,
    temperature: z.number().finite().min(-1).max(1).nullable(),
  })
  .strict();
export const visualFrameSchema = measuredColorSchema
  .extend({
    timeMs: z.number().int().nonnegative(),
    sharpness: z.number().finite().min(0).max(4),
    change: unit,
    whiteFraction: unit,
    blackFraction: unit,
    layout: z.array(unit).length(16),
    shadowRgb: rgb.optional(),
    highlightRgb: rgb.optional(),
    flow: z
      .object({
        panX: z.number().finite().min(-3).max(3),
        panY: z.number().finite().min(-3).max(3),
        expansion: z.number().finite(),
        confidence: unit,
      })
      .strict()
      .nullable()
      .optional(),
    /** Local motion: centroid and share of changing pixels, and a flow vector per 4×4 cell. */
    local: z
      .object({
        cx: unit,
        cy: unit,
        area: unit,
        flow: z.array(z.number().finite().min(-4).max(4)).length(32),
      })
      .strict()
      .optional(),
  })
  .strict();
export type VisualFrame = z.infer<typeof visualFrameSchema>;
export const transitionSchema = z
  .object({
    cutMs: z.number().nonnegative(),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    kind: z.enum([
      "cut",
      "flash",
      "blur",
      "zoom",
      "whip",
      "motion",
      "match-cut",
      "dissolve",
      "unresolved",
    ]),
    confidence: unit,
    strength: unit,
    direction: z.enum(["left", "right", "up", "down"]).nullable(),
    zoomDirection: z.enum(["in", "out"]).optional(),
    evidence: z.array(z.string().max(240)).max(8),
  })
  .strict()
  .refine((t) => t.startMs <= t.cutMs && t.cutMs <= t.endMs);
export type ReferenceTransition = z.infer<typeof transitionSchema>;

export function measuredColor(
  frames: readonly VisualFrame[],
  start: number,
  end: number,
) {
  const sample = frames.filter(
    (f) =>
      f.timeMs >= start &&
      f.timeMs < end &&
      f.blackFraction < 0.95 &&
      f.whiteFraction < 0.95,
  );
  if (!sample.length) return null;
  const mean = (property: "luma" | "contrast" | "saturation") =>
    sample.reduce((sum, f) => sum + f[property], 0) / sample.length;
  const neutrals = sample.filter((f) => f.temperature !== null);
  return {
    luma: mean("luma"),
    contrast: mean("contrast"),
    saturation: mean("saturation"),
    temperature: neutrals.length
      ? neutrals.reduce((sum, f) => sum + f.temperature!, 0) / neutrals.length
      : null,
  };
}
export function averageEmbedding(samples: readonly (readonly number[])[]) {
  const valid = samples.filter((e) => e.length === 512);
  if (!valid.length) return null;
  const vector = Array.from(
    { length: 512 },
    (_, i) => valid.reduce((sum, e) => sum + e[i], 0) / valid.length,
  );
  const norm = Math.hypot(...vector);
  return norm > 1e-8 ? vector.map((v) => v / norm) : null;
}
export function embeddingSimilarity(
  a: readonly number[] | null | undefined,
  b: readonly number[] | null | undefined,
) {
  if (!a || !b || a.length !== 512 || b.length !== 512) return null;
  return Math.max(
    -1,
    Math.min(
      1,
      a.reduce((sum, n, i) => sum + n * b[i], 0),
    ),
  );
}

/** Average spatial luminance, independent of color grading. Flat frames carry no layout evidence. */
export function measuredLayout(
  frames: readonly VisualFrame[],
  start: number,
  end: number,
) {
  const samples = frames.filter(
    (f) =>
      f.timeMs >= start &&
      f.timeMs < end &&
      f.blackFraction < 0.8 &&
      f.whiteFraction < 0.8,
  );
  if (!samples.length) return null;
  return Array.from(
    { length: 16 },
    (_, i) => samples.reduce((s, f) => s + f.layout[i], 0) / samples.length,
  );
}
export function layoutSimilarity(
  a: readonly number[] | null | undefined,
  b: readonly number[] | null | undefined,
) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return null;
  const am = a.reduce((s, n) => s + n, 0) / 16,
    bm = b.reduce((s, n) => s + n, 0) / 16;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < 16; i++) {
    const x = a[i] - am,
      y = b[i] - bm;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa < 0.001 || bb < 0.001) return null;
  return Math.max(0, Math.min(1, (1 + dot / Math.sqrt(aa * bb)) / 2));
}
const median = (values: number[]) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** A brief polarity reversal returning to the same layout is an effect, not a new source shot. */
export function separateColorPulses(
  shots: Shot[],
  frames: readonly VisualFrame[],
) {
  const pulses: {
    startMs: number;
    endMs: number;
    confidence: number;
    palette?: z.infer<typeof pulsePaletteSchema>;
  }[] = [];
  for (let i = 1; i < shots.length - 1; i++) {
    const shot = shots[i];
    if (shot.endMs - shot.startMs > 200) continue;
    const before = measuredLayout(
      frames,
      Math.max(shots[i - 1].startMs, shot.startMs - 100),
      shot.startMs,
    );
    const during = measuredLayout(frames, shot.startMs, shot.endMs);
    const after = measuredLayout(
      frames,
      shot.endMs,
      Math.min(shots[i + 1].endMs, shot.endMs + 100),
    );
    const restored = layoutSimilarity(before, after),
      reversed = layoutSimilarity(before, during);
    const normal = measuredColor(frames, shot.startMs - 100, shot.startMs),
      pulse = measuredColor(frames, shot.startMs, shot.endMs);
    if (
      restored == null ||
      reversed == null ||
      restored < 0.94 ||
      reversed > 0.15 ||
      !normal ||
      !pulse ||
      Math.abs(normal.luma - pulse.luma) < 0.2
    )
      continue;
    const colors = frames.filter(
      (f) =>
        f.timeMs >= shot.startMs &&
        f.timeMs < shot.endMs &&
        f.shadowRgb &&
        f.highlightRgb,
    );
    const color = (key: "shadowRgb" | "highlightRgb") =>
      "#" +
      [0, 1, 2]
        .map((c) =>
          Math.round(
            colors.reduce((sum, f) => sum + f[key]![c], 0) / colors.length,
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    pulses.push({
      startMs: shot.startMs,
      endMs: shot.endMs,
      confidence: Math.min(restored, 1 - reversed),
      ...(colors.length
        ? {
            palette: {
              shadows: color("shadowRgb"),
              highlights: color("highlightRgb"),
            },
          }
        : {}),
    });
    shots[i - 1].endMs = shots[i + 1].endMs;
    shots[i - 1].fadeOut = shots[i + 1].fadeOut;
    shots.splice(i, 2);
    i--;
  }
  return pulses;
}

/** Scene detectors often timestamp the start of a flash instead of the hidden cut. */
export function refineFlashBoundaries(
  shots: Shot[],
  frames: readonly VisualFrame[],
) {
  for (let i = 1; i < shots.length; i++) {
    const cut = shots[i].startMs;
    const nearby = frames.filter((f) => Math.abs(f.timeMs - cut) <= 300);
    const peak = nearby
      .filter((f) => f.whiteFraction > 0.65)
      .sort((a, b) => b.whiteFraction - a.whiteFraction)[0];
    if (!peak) continue;
    const before = frames.filter(
      (f) => f.timeMs >= peak.timeMs - 400 && f.timeMs < peak.timeMs - 180,
    );
    const after = frames.filter(
      (f) => f.timeMs > peak.timeMs + 180 && f.timeMs <= peak.timeMs + 400,
    );
    if (
      !before.length ||
      !after.length ||
      peak.luma <=
        Math.max(
          median(before.map((f) => f.luma)),
          median(after.map((f) => f.luma)),
        ) +
          0.2
    )
      continue;
    if (
      peak.timeMs > shots[i - 1].startMs + 100 &&
      peak.timeMs < shots[i].endMs - 100
    ) {
      shots[i - 1].endMs = peak.timeMs;
      shots[i].startMs = peak.timeMs;
    }
  }
}

/** Confidence is rule evidence strength, not a calibrated classification probability. */
export function characterizeTransitions(
  shots: readonly Shot[],
  frames: readonly VisualFrame[],
  motion: readonly MotionSample[],
) {
  return shots.slice(1).map((shot, index): ReferenceTransition => {
    const cut = shot.startMs,
      previous = shots[index];
    const window = frames.filter((f) => Math.abs(f.timeMs - cut) <= 400);
    const before = window.filter((f) => f.timeMs < cut - 100),
      after = window.filter((f) => f.timeMs > cut + 100);
    const baselineLuma = Math.max(
      median(before.map((f) => f.luma)),
      median(after.map((f) => f.luma)),
    );
    const sharpness = Math.min(
      median(before.map((f) => f.sharpness)),
      median(after.map((f) => f.sharpness)),
    );
    const flash = window.filter(
      (f) => f.whiteFraction > 0.65 && f.luma > baselineLuma + 0.2,
    );
    const blurred = window.filter(
      (f) =>
        Math.abs(f.timeMs - cut) < 150 &&
        f.sharpness < sharpness * 0.35 &&
        f.blackFraction < 0.8 &&
        f.whiteFraction < 0.8,
    );
    const dense = window
      .filter(
        (f) =>
          f.flow &&
          f.flow.confidence >= 0.4 &&
          Math.abs(f.timeMs - cut) <= 300 &&
          Math.abs(f.timeMs - cut) > 34,
      )
      .map((f) => ({ timeMs: f.timeMs, ...f.flow! }));
    const moving =
      dense.length >= 4
        ? dense
        : motion.filter(
            (m) =>
              Math.abs(m.timeMs - cut) < 300 &&
              Math.abs(m.timeMs - cut) > 34 &&
              m.confidence >= 0.4,
          );
    const isDense = dense.length >= 4;
    const radial = isDense
      ? window
          .filter(
            (f) =>
              f.flow &&
              f.flow.confidence >= 0.25 &&
              Math.abs(f.timeMs - cut) <= 300 &&
              Math.abs(f.timeMs - cut) > 34,
          )
          .map((f) => ({ timeMs: f.timeMs, ...f.flow! }))
      : moving;
    const zoom = radial.filter(
      (m) => Math.abs(m.expansion) >= (isDense ? 0.012 : 0.045),
    );
    const zoomBefore = zoom.filter((m) => m.timeMs < cut),
      zoomAfter = zoom.filter((m) => m.timeMs > cut);
    const radialBefore = median(zoomBefore.map((m) => m.expansion)),
      radialAfter = median(zoomAfter.map((m) => m.expansion));
    const radialAgreement =
      zoom.filter(
        (m) =>
          Math.sign(m.expansion) ===
          Math.sign(m.timeMs < cut ? radialBefore : radialAfter),
      ).length / Math.max(1, zoom.length);
    const whip = moving.filter(
      (m) => Math.hypot(m.panX, m.panY) >= (isDense ? 1.2 : 2.5),
    );
    const translated = moving.filter(
      (m) =>
        Math.hypot(m.panX, m.panY) >= (isDense ? 0.55 : 1.5) &&
        Math.hypot(m.panX, m.panY) > Math.abs(m.expansion) * 35,
    );
    const tx = median(translated.map((m) => m.panX)),
      ty = median(translated.map((m) => m.panY));
    const length = Math.hypot(tx, ty);
    const coherent = translated.filter(
      (m) =>
        (m.panX * tx + m.panY * ty) /
          Math.max(1e-8, Math.hypot(m.panX, m.panY) * length) >=
        0.8,
    );
    const baseline = window
      .filter(
        (f) =>
          Math.abs(f.timeMs - cut) > 300 && f.flow && f.flow.confidence >= 0.4,
      )
      .map((f) => Math.hypot(f.flow!.panX, f.flow!.panY));
    const translation =
      coherent.length >= (isDense ? 4 : 2) &&
      coherent.some((m) => m.timeMs < cut) &&
      coherent.some((m) => m.timeMs > cut) &&
      (!isDense || length > median(baseline) * 1.8 + 0.25);
    const result: ReferenceTransition = {
      cutMs: cut,
      startMs: cut,
      endMs: cut,
      kind: "cut",
      confidence: shot.boundaryConfidence ?? 0,
      strength: 0,
      direction: null,
      evidence: [
        "Detected scene boundary; no supported transition signature measured.",
      ],
    };
    if (flash.length && before.length && after.length) {
      result.kind = "flash";
      result.confidence = Math.min(0.95, 0.65 + flash.length * 0.06);
      result.strength = Math.min(
        1,
        Math.max(...flash.map((f) => f.whiteFraction)),
      );
      const envelope = window.filter((f) => f.luma > baselineLuma + 0.08);
      result.startMs = Math.min(
        cut,
        (envelope[0]?.timeMs ?? flash[0].timeMs) - 33,
      );
      result.endMs = Math.max(
        cut,
        (envelope.at(-1)?.timeMs ?? flash.at(-1)!.timeMs) + 34,
      );
      result.evidence = [
        "Brief near-white exposure peak bounded by darker frames.",
        flash.length + " bright samples at 30 Hz.",
      ];
    } else if (blurred.length >= 2 && sharpness > 0.025) {
      result.kind = "blur";
      result.confidence = Math.min(0.9, 0.6 + blurred.length * 0.05);
      result.strength =
        1 - Math.min(...blurred.map((f) => f.sharpness)) / sharpness;
      result.startMs = Math.min(cut, blurred[0].timeMs);
      result.endMs = Math.max(cut, blurred.at(-1)!.timeMs + 34);
      result.evidence = [
        "High-frequency detail drops and recovers on both sides of the boundary.",
      ];
    } else if (translation) {
      result.kind = whip.length >= (isDense ? 4 : 2) ? "whip" : "motion";
      result.confidence = Math.min(
        0.85,
        median(coherent.map((m) => m.confidence)),
      );
      result.direction =
        Math.abs(tx) >= Math.abs(ty)
          ? tx < 0
            ? "left"
            : "right"
          : ty < 0
            ? "up"
            : "down";
      result.strength = Math.min(1, length / (isDense ? 3 : 4));
      result.startMs = Math.min(cut, coherent[0].timeMs - (isDense ? 33 : 125));
      result.endMs = Math.max(
        cut,
        coherent.at(-1)!.timeMs + (isDense ? 33 : 125),
      );
      result.evidence = [
        "Directional displacement agrees on both sides of the cut and exceeds surrounding motion.",
        isDense
          ? "30 Hz block motion; camera/subject identity is not guaranteed."
          : "8 Hz approximation.",
      ];
    } else if (
      zoomBefore.length >= (isDense ? 3 : 1) &&
      zoomAfter.length >= (isDense ? 3 : 1) &&
      radialBefore * radialAfter < 0 &&
      radialAgreement >= 0.8 &&
      zoom.reduce((sum, m) => sum + Math.abs(m.expansion), 0) > 0.12
    ) {
      result.kind = "zoom";
      result.confidence = Math.min(
        0.85,
        median(zoom.map((m) => m.confidence)) * 0.4 +
          radialAgreement * 0.3 +
          Math.min(1, zoom.length / 8) * 0.3,
      );
      result.strength = Math.min(
        1,
        zoom.reduce((sum, m) => sum + Math.abs(m.expansion), 0),
      );
      result.zoomDirection =
        median(zoom.filter((m) => m.timeMs < cut).map((m) => m.expansion)) >= 0
          ? "in"
          : "out";
      result.startMs = Math.min(cut, zoom[0].timeMs - (isDense ? 33 : 125));
      result.endMs = Math.max(cut, zoom.at(-1)!.timeMs + (isDense ? 33 : 125));
      result.evidence = [
        "Radial block displacement on both sides of the cut; original lens motion remains ambiguous.",
        isDense
          ? "30 Hz block motion."
          : "8 Hz block motion; duration is approximate.",
      ];
    }
    result.startMs = Math.max(previous.startMs, result.startMs);
    result.endMs = Math.min(shot.endMs, result.endMs);
    return result;
  });
}
