import { z } from "zod";
import { keyframeSchema } from "../animation/schema";
import type { Project } from "../project-schema";
export const effectTypes = [
  "blur",
  "brightness",
  "contrast",
  "saturation",
  "tonalContrast",
  "temperature",
  "grain",
  "vignette",
  "sharpen",
] as const;
export type EffectType = (typeof effectTypes)[number];
export const effectInfo = {
  blur: { label: "Gaussian blur", min: 0, max: 100, step: 0.5, initial: 4 },
  brightness: { label: "Brightness", min: 0, max: 3, step: 0.05, initial: 1 },
  contrast: { label: "Contrast", min: 0, max: 3, step: 0.05, initial: 1 },
  saturation: { label: "Saturation", min: 0, max: 3, step: 0.05, initial: 1 },
  tonalContrast: {
    label: "Tonal contrast",
    min: 0.5,
    max: 1.5,
    step: 0.01,
    initial: 1.06,
  },
  temperature: {
    label: "Temperature",
    min: -1,
    max: 1,
    step: 0.02,
    initial: 0,
  },
  grain: { label: "Grain", min: 0, max: 0.2, step: 0.005, initial: 0.025 },
  vignette: { label: "Vignette", min: 0, max: 0.8, step: 0.02, initial: 0.12 },
  sharpen: {
    label: "Controlled sharpen",
    min: 0,
    max: 1,
    step: 0.02,
    initial: 0.1,
  },
};
export const grainParametersSchema = z
  .object({
    size: z.number().finite().min(0.5).max(8),
    softness: z.number().finite().min(0).max(1),
  })
  .strict();
export const effectSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.enum(effectTypes),
    enabled: z.boolean(),
    value: z.number().finite(),
    keys: z.array(keyframeSchema).max(1000).default([]),
    parameters: grainParametersSchema.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.parameters && e.type !== "grain")
      ctx.addIssue({
        code: "custom",
        message: "Grain parameters require a grain effect",
      });
    const { min, max } = effectInfo[e.type];
    if (
      e.value < min ||
      e.value > max ||
      e.keys.some((k) => k.value < min || k.value > max)
    )
      ctx.addIssue({
        code: "custom",
        message: "Effect value outside supported range",
      });
    if (new Set(e.keys.map((k) => k.frame)).size !== e.keys.length)
      ctx.addIssue({ code: "custom", message: "Duplicate effect key time" });
  });
export const effectStackSchema = z
  .array(effectSchema)
  .max(32)
  .superRefine((s, ctx) => {
    if (new Set(s.map((e) => e.id)).size !== s.length)
      ctx.addIssue({ code: "custom", message: "Duplicate effect ID" });
  });
export type Effect = z.infer<typeof effectSchema>;
const validated = new WeakSet<Effect[]>();
export function assertEffectStacks(p: Project) {
  for (const scope of [
    { layers: p.clips, tracks: p.tracks },
    ...p.compositions,
  ]) {
    const visual = new Set(
      scope.tracks.filter((t) => t.kind === "video").map((t) => t.id),
    );
    for (const c of scope.layers) {
      if (c.effectStack.length && (c.kind === "null" || !visual.has(c.trackId)))
        throw new Error("Effects require a visual layer");
      if (!validated.has(c.effectStack)) {
        effectStackSchema.parse(c.effectStack);
        if (Object.isFrozen(c.effectStack)) validated.add(c.effectStack);
      }
    }
  }
}
