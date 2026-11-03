import { z } from "zod";
import { type Asset, type Project, uid, fps } from "../../project-schema";
import type { JobContext } from "../../jobs";
import type { RoughCutPlan } from "./planner";
import { gymStyles } from "./styles";
import { initialShotColor } from "./color";
import type { EditorToolCall } from "../editor-agent/registry";
const unit = z.number().finite().min(0).max(1);
export const colorStatsSchema = z
  .object({
    assetId: z.string().min(1).max(128),
    fingerprint: z.string().min(1),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    algorithm: z.literal("color-samples-1"),
    processing: z.literal("LOCAL"),
    range: z
      .object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
      })
      .strict(),
    meanLuma: unit,
    contrastStd: unit,
    meanSaturation: unit,
    neutralTemperature: z.number().finite().min(-1).max(1).nullable(),
    neutralFraction: unit,
    sampleCount: z.literal(5),
  })
  .strict();
export type ColorStats = z.infer<typeof colorStatsSchema>;
export type ColorBackend = (
  asset: Asset,
  range: ColorStats["range"],
  job: JobContext,
) => Promise<ColorStats>;
export const colorCacheKey = (asset: Asset, range: ColorStats["range"]) =>
  `color-samples-1:${asset.id}:${asset.fingerprint}:${range.startMs}:${range.endMs}`;
export const nativeColorBackend: ColorBackend = async (asset, range, job) => {
  const [{ desktop }, { readDerived, writeDerived }, { nativeJob }] =
    await Promise.all([
      import("../../platform"),
      import("../../platform/derived"),
      import("../media-analysis/service"),
    ]);
  await job.checkpoint();
  const key = colorCacheKey(asset, range);
  const raw = desktop
    ? await nativeJob(
        "sample_color",
        { assetId: asset.id, path: asset.path, range },
        job,
      )
    : await readDerived(key);
  const result = colorStatsSchema.safeParse(raw);
  if (!result.success)
    throw new Error(
      "Shot color sampling requires the desktop app or matching cached RGB measurements",
    );
  const data = result.data;
  if (
    data.assetId !== asset.id ||
    data.fingerprint !== asset.fingerprint ||
    data.range.startMs !== range.startMs ||
    data.range.endMs !== range.endMs
  )
    throw new Error("Shot color measurements no longer match the source range");
  if (desktop) await writeDerived(key, data, JSON.stringify(data).length * 2);
  return data;
};
export async function matchAestheticColor(
  project: Project,
  cut: RoughCutPlan,
  backend: ColorBackend,
  job: JobContext,
): Promise<RoughCutPlan> {
  if (!cut.brief.style) return cut;
  const stats = new Map<string, ColorStats>(),
    rate = fps(project);
  for (const [i, shot] of cut.shots.entries()) {
    await job.checkpoint();
    const asset = project.assets.find((a) => a.id === shot.candidate.assetId)!;
    const range = {
      startMs: Math.floor((shot.sourceIn * 1000) / rate),
      endMs: Math.floor(((shot.sourceIn + shot.duration) * 1000) / rate),
    };
    const data = colorStatsSchema.parse(
      await backend(asset, range, {
        ...job,
        report: (p) =>
          job.report({
            completed: i + (p.total ? p.completed / p.total : 0),
            total: cut.shots.length,
            unit: "shots color-matched",
          }),
      }),
    );
    if (
      data.assetId !== asset.id ||
      data.fingerprint !== asset.fingerprint ||
      data.range.startMs !== range.startMs ||
      data.range.endMs !== range.endMs
    )
      throw new Error("Shot color evidence does not match the selected source");
    stats.set(shot.candidate.id, data);
  }
  const color = initialShotColor(cut.shots, gymStyles[cut.brief.style], stats);
  const commands: EditorToolCall[] = cut.plan.commands.filter(
    (c) => c.tool !== "sequence.effect",
  );
  const inserts = commands.filter((c) => c.tool === "sequence.insert");
  color.forEach((effects, i) => {
    const clipId = inserts[i].clipId;
    for (const e of effects)
      if (
        !cut.reviewOptions.disabledEffects.includes(
          `${cut.shots[i].candidate.id}:${e.type}`,
        )
      )
        commands.push({
          tool: "sequence.effect",
          sequenceId: cut.plan.resultCompositionId!,
          clipId,
          effectId: uid(),
          type: e.type,
          value: e.value,
          ...(e.parameters ? { parameters: e.parameters } : {}),
        });
  });
  const warnings = cut.warnings.filter(
    (w) => !w.startsWith("Initial color uses"),
  );
  warnings.push(
    "Color matching uses five measured RGB samples per shot: exposure, contrast, saturation and a low-chroma white-balance proxy. No skin isolation is claimed; adjustments remain conservative and editable.",
  );
  job.report({
    completed: cut.shots.length,
    total: cut.shots.length,
    unit: "shots color-matched",
  });
  return {
    ...cut,
    color,
    colorMatchedShots: stats.size,
    plan: { ...cut.plan, commands },
    warnings,
  };
}
