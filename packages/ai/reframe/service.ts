import { type Project } from "../../project-schema";
import { sourceFrameAt } from "../../time-remap/model";
import { backgroundJobs, type JobContext } from "../../jobs";
import { nativeJob } from "../media-analysis/service";
import { revisionTarget } from "../revisions/planner";
import { planReframe } from "./planner";
import { desktop } from "../../platform";
import { readDerived, writeDerived } from "../../platform/derived";
import { VISION_MODEL_VERSION } from "../media-analysis/model";
import {
  subjectSamplesSchema,
  type SubjectSamples,
  type ReframeMode,
  type SubjectChoice,
} from "./model";
export type SubjectBackend = (
  asset: Project["assets"][number],
  sampling: SubjectSamples["sampling"],
  job: JobContext,
) => Promise<SubjectSamples>;
export function subjectCacheKey(
  asset: Pick<Project["assets"][number], "id" | "fingerprint">,
  sampling: SubjectSamples["sampling"],
) {
  return `subjects:${VISION_MODEL_VERSION}:${asset.id}:${asset.fingerprint}:${sampling.startMs}:${sampling.endMs}:${sampling.intervalMs}`;
}
export const nativeSubjectBackend: SubjectBackend = async (
  asset,
  sampling,
  job,
) => {
  const key = subjectCacheKey(asset, sampling);
  if (!desktop) {
    await job.checkpoint();
    const cached = subjectSamplesSchema.safeParse(await readDerived(key));
    if (
      cached.success &&
      cached.data.assetId === asset.id &&
      cached.data.fingerprint === asset.fingerprint &&
      cached.data.modelVersion === VISION_MODEL_VERSION &&
      JSON.stringify(cached.data.sampling) === JSON.stringify(sampling)
    )
      return cached.data;
    throw Error(
      "Person sampling runs in the desktop app. No matching local evidence is cached for this range.",
    );
  }
  const result = subjectSamplesSchema.parse(
    await nativeJob(
      "sample_subjects",
      { assetId: asset.id, path: asset.path, sampling },
      job,
    ),
  );
  await job.checkpoint();
  await writeDerived(key, result, JSON.stringify(result).length * 2);
  return result;
};
export class ReframeService {
  constructor(readonly backend: SubjectBackend = nativeSubjectBackend) {}
  plan(
    request: string,
    project: Project,
    revision: number,
    activeId: string | null,
    mode: ReframeMode = "smooth",
  ) {
    const c = revisionTarget(project, activeId),
      shots = c.layers.filter(
        (l) => project.assets.find((a) => a.id === l.assetId)?.kind === "video",
      ),
      rate = c.settings.fps.num / c.settings.fps.den;
    if (!shots.length || shots.length > 256)
      throw Error("Reframe between 1 and 256 video shots");
    const choice: SubjectChoice = /white shirt/i.test(request)
      ? "white-shirt"
      : /both/i.test(request)
        ? "both"
        : "main";
    return backgroundJobs.enqueue({
      label: "Plan person-aware reframe · LOCAL",
      scope: project.id,
      run: async (job) => {
        const evidence = new Map<string, SubjectSamples>();
        for (const [i, clip] of shots.entries()) {
          await job.checkpoint();
          const asset = project.assets.find((a) => a.id === clip.assetId)!;
          const sampling = {
            startMs: Math.floor((sourceFrameAt(clip, 0) * 1000) / rate),
            endMs: Math.floor(
              (sourceFrameAt(clip, clip.duration) * 1000) / rate,
            ),
            intervalMs: 250,
          };
          const data = await this.backend(asset, sampling, {
            ...job,
            report: (p) =>
              job.report({
                completed: i + (p.total ? p.completed / p.total : 0),
                total: shots.length,
                unit: "shots sampled",
              }),
          });
          evidence.set(clip.id, data);
        }
        await job.checkpoint();
        return planReframe(
          request,
          project,
          revision,
          activeId,
          evidence,
          mode,
          choice,
        );
      },
    });
  }
}
export const reframeService = new ReframeService();
