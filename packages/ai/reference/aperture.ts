import { z } from "zod";
import type { Asset } from "../../project-schema";
import type { JobContext } from "../../jobs";
const margin = z.number().min(0).max(0.25);
export const apertureSchema = z
  .object({ left: margin, top: margin, right: margin, bottom: margin })
  .strict();
export type Aperture = z.infer<typeof apertureSchema>;
export async function sourceAperture(a: Asset, job: JobContext) {
  const { desktop } = await import("../../platform");
  const { readDerived, writeDerived } = await import("../../platform/derived");
  const { nativeJob } = await import("../media-analysis/service");
  const key = "source-aperture-v3:" + a.fingerprint;
  const cached = apertureSchema.safeParse(await readDerived(key));
  if (cached.success) return cached.data;
  if (!desktop) return undefined;
  const result = apertureSchema.parse(
    await nativeJob("source_aperture", { path: a.path }, job),
  );
  await writeDerived(key, result, 256);
  return result;
}
