import { z } from "zod";
import { desktop } from "../../platform";
import { readDerived, writeDerived } from "../../platform/derived";
import { nativeJob } from "../media-analysis/service";
import type { Asset } from "../../project-schema";
import type { JobContext } from "../../jobs";
export const sampleSchema = z
  .object({
    cadenceHoldMs: z.number().int().nonnegative().nullable().optional(),
    timeMs: z.number().int().positive(),
    panX: z.number().finite(),
    panY: z.number().finite(),
    expansion: z.number().finite(),
    intensity: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    freeze: z.boolean(),
    edgeDarkening: z.number().min(0).max(1),
    blackBars: z.boolean(),
  })
  .strict();
import { appearanceSchema } from "./appearance";
export async function referenceText(a: Asset, job: JobContext) {
  const key = "reference-text-v1:" + a.id + ":" + a.fingerprint,
    validate = z.array(appearanceSchema).max(512);
  const cached = validate.safeParse(await readDerived(key));
  if (cached.success) return cached.data;
  if (!desktop) return null;
  const samples = validate.parse(
    await nativeJob("reference_text", { path: a.path }, job),
  );
  await writeDerived(key, samples, JSON.stringify(samples).length * 2);
  return samples;
}
export type MotionSample = z.infer<typeof sampleSchema>;
export async function referenceMotion(a: Asset, job: JobContext) {
  const key = "reference-blocks-v2:" + a.id + ":" + a.fingerprint,
    validate = z.array(sampleSchema).max(2400);
  const cached = validate.safeParse(await readDerived(key));
  if (cached.success) return cached.data;
  if (!desktop) return [];
  const samples = validate.parse(
    await nativeJob("reference_motion", { path: a.path }, job),
  );
  await writeDerived(key, samples, JSON.stringify(samples).length * 2);
  return samples;
}
