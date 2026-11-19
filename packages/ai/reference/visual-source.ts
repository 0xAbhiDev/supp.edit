import { z } from "zod";
import { desktop } from "../../platform";
import { readDerived, writeDerived } from "../../platform/derived";
import { nativeJob } from "../media-analysis/service";
import type { Asset } from "../../project-schema";
import type { JobContext } from "../../jobs";
import { visualFrameSchema } from "./visual";

export async function referenceVisual(asset: Asset, job: JobContext) {
  // Keyed by file identity (path, size, modified time), not by project asset.
  const key = "reference-visual-v4:" + asset.fingerprint;
  const schema = z.array(visualFrameSchema).max(9001);
  const cached = schema.safeParse(await readDerived(key));
  if (cached.success) return cached.data;
  if (!desktop) return [];
  const frames = schema.parse(
    await nativeJob("reference_visual", { path: asset.path }, job),
  );
  await writeDerived(key, frames, JSON.stringify(frames).length * 2);
  return frames;
}
