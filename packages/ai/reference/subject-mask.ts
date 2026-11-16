import { z } from "zod";
import type { Asset, Clip } from "../../project-schema";
import type { JobContext } from "../../jobs";
import { newMask, type MaskVertex } from "../../masks/model";
import { sourceFrameAt } from "../../time-remap/model";

const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export const personSamplesSchema = z
  .array(
    z
      .object({
        timeMs: z.number().int().nonnegative(),
        points: z.array(point).refine((p) => p.length === 0 || p.length === 96),
      })
      .strict(),
  )
  .max(3001);
export type PersonSample = z.infer<typeof personSamplesSchema>[number];
export async function personMasks(asset: Asset, job: JobContext) {
  const { desktop } = await import("../../platform");
  const { readDerived, writeDerived } = await import("../../platform/derived");
  const { nativeJob } = await import("../media-analysis/service");
  const key =
    "person-mask-pphumanseg-552d8a98-v1:" + asset.id + ":" + asset.fingerprint;
  const cached = personSamplesSchema.safeParse(await readDerived(key));
  if (cached.success) return cached.data;
  if (!desktop) return [];
  const samples = personSamplesSchema.parse(
    await nativeJob("person_mask", { path: asset.path }, job),
  );
  await writeDerived(key, samples, JSON.stringify(samples).length * 2);
  return samples;
}

/** Align contour phase before interpolation; suppress tiny boundary jitter without lagging motion. */
export function stabilize(samples: PersonSample[]): PersonSample[] {
  let previous: PersonSample | undefined;
  return samples.map((sample) => {
    let points = sample.points;
    if (
      previous?.points.length &&
      points.length &&
      sample.timeMs - previous.timeMs <= 200
    ) {
      const old = previous.points;
      let offset = 0,
        best = Infinity;
      for (let shift = 0; shift < points.length; shift++) {
        const cost = points.reduce((sum, _, i) => {
          const p = points[(i + shift) % points.length];
          return sum + (p[0] - old[i][0]) ** 2 + (p[1] - old[i][1]) ** 2;
        }, 0);
        if (cost < best) {
          best = cost;
          offset = shift;
        }
      }
      points = points.map((_, i) => points[(i + offset) % points.length]);
      // Large changes can be a cut or subject switch. Do not blend those outlines.
      if (best / points.length < 0.001)
        points = points.map((p, i) => [
          0.85 * p[0] + 0.15 * old[i][0],
          0.85 * p[1] + 0.15 * old[i][1],
        ]);
    }
    previous = { ...sample, points };
    return previous;
  });
}

export function editablePersonMask(
  samples: PersonSample[],
  clip: Clip,
  asset: Asset,
  width: number,
  height: number,
  rate: number,
) {
  const measured = stabilize(samples);
  const fit = Math.min(width / asset.width, height / asset.height);
  const path = (points: PersonSample["points"]): MaskVertex[] =>
    points.map(([x, y], i) => ({
      id: "person-" + i,
      x: 0.5 + ((x - 0.5) * asset.width * fit) / width,
      y: 0.5 + ((y - 0.5) * asset.height * fit) / height,
      in: { x: 0, y: 0 },
      out: { x: 0, y: 0 },
    }));
  const keys: {
    frame: number;
    easing: "linear" | "hold";
    vertices: MaskVertex[];
  }[] = [];
  const opacity: { frame: number; value: number; easing: "hold" }[] = [];
  let prior: PersonSample | undefined;
  const count = Math.min(
    128,
    Math.max(2, Math.ceil((clip.duration / rate) * 10)),
  );
  for (let i = 0; i < count; i++) {
    const frame = Math.round((i * (clip.duration - 1)) / (count - 1));
    const ms = (sourceFrameAt(clip, frame) * 1000) / rate;
    const sample = measured.reduce<PersonSample | undefined>(
      (a, b) =>
        !a || Math.abs(b.timeMs - ms) < Math.abs(a.timeMs - ms) ? b : a,
      undefined,
    );
    const visible =
      !!sample?.points.length && Math.abs(sample.timeMs - ms) <= 150;
    if (!opacity.length || opacity.at(-1)!.value !== Number(visible))
      opacity.push({ frame, value: Number(visible), easing: "hold" });
    if (visible && sample) {
      if (prior && sample.timeMs - prior.timeMs > 200 && keys.length)
        keys.at(-1)!.easing = "hold";
      keys.push({ frame, easing: "linear", vertices: path(sample.points) });
      prior = sample;
    }
  }
  if (!keys.length) return undefined;
  const mask = newMask(keys[0].vertices);
  mask.name = "Local person contour · editable";
  mask.feather = 2;
  mask.pathKeys = keys;
  mask.keyframes.opacity = opacity;
  return mask;
}
