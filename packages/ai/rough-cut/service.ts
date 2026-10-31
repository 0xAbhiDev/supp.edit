import { type Project } from "../../project-schema";
import { type JobContext } from "../../jobs";
import {
  mediaAnalysis,
  type MediaAnalysisService,
} from "../media-analysis/service";
import {
  defaultAnalysisSettings,
  type MediaAnalysis,
} from "../media-analysis/model";
import { parseEditBrief } from "./model";
import {
  buildRoughCut,
  chooseMusic,
  rankMoments,
  type RankedEvidence,
  type RoughCutPlan,
} from "./planner";
import { previewEditPlan, type EditPreview } from "../editor-agent/execution";
export interface RoughCutSession {
  project: Project;
  revision: number;
  evidence: RankedEvidence;
  cut: RoughCutPlan;
  preview: EditPreview;
}
export class RoughCutService {
  constructor(readonly analysis: MediaAnalysisService = mediaAnalysis) {}
  plan(
    prompt: string,
    project: Project,
    revision: number,
    musicId?: string | null,
    contextAsset?: string | null,
  ) {
    const brief = parseEditBrief(prompt),
      music = chooseMusic(project, musicId, contextAsset),
      videos = project.assets.filter((a) => a.kind === "video");
    if (!videos.length)
      throw new Error("Import video sources to plan an edit.");
    if (videos.length > 64)
      throw new Error(
        "This local analysis pass supports up to 64 imported videos. Use a smaller source project.",
      );
    if (brief.beatSync !== "off" && !music)
      throw new Error(
        "Import or choose a music asset to synchronize this edit.",
      );
    return this.analysis.jobs.enqueue({
      label: "Analyze and plan gym edit · LOCAL",
      scope: project.id,
      run: async (job) => {
        const results: MediaAnalysis[] = [],
          total =
            videos.length + (music ? 1 : 0) + (brief.prioritize.length ? 1 : 0);
        let completed = 0;
        const subtask = (): JobContext => {
          let last = 0;
          return {
            ...job,
            report: (p) => {
              last = Math.max(
                last,
                Math.min(999, Math.floor((p.completed / p.total) * 1000)),
              );
              job.report({
                completed: completed * 1000 + last,
                total: total * 1000,
                unit: "analysis work",
              });
            },
          };
        };
        for (const asset of videos) {
          await job.checkpoint();
          await this.analysis.restore(asset);
          results.push(
            await this.analysis.runTask(
              asset,
              defaultAnalysisSettings("vision"),
              subtask(),
            ),
          );
          completed++;
          job.report({
            completed: completed * 1000,
            total: total * 1000,
            unit: "analysis work",
          });
        }
        let beatMap = null;
        if (music) {
          await this.analysis.restore(music);
          const audio = await this.analysis.runTask(
            music,
            defaultAnalysisSettings("audio"),
            subtask(),
          );
          results.push(audio);
          beatMap = audio.audio!.beatMap;
          completed++;
          job.report({
            completed: completed * 1000,
            total: total * 1000,
            unit: "analysis work",
          });
        }
        const query = brief.prioritize.length
          ? await this.analysis.embedQuery(
              "a person " + brief.prioritize.join(" "),
              subtask(),
            )
          : undefined;
        await job.checkpoint();
        job.report({
          completed: total * 1000,
          total: total * 1000,
          unit: "analysis work",
        });
        const evidence = rankMoments(project, results, brief, query),
          cut = buildRoughCut(
            project,
            revision,
            brief,
            evidence,
            music,
            beatMap,
          );
        return {
          project,
          revision,
          evidence,
          cut,
          preview: previewEditPlan(cut.plan, project, revision),
        } satisfies RoughCutSession;
      },
    });
  }
  reselect(session: RoughCutSession, ids: readonly string[]): RoughCutSession {
    const cut = buildRoughCut(
      session.project,
      session.revision,
      session.cut.brief,
      session.evidence,
      session.cut.music,
      session.cut.beatMap,
      ids,
    );
    return {
      ...session,
      cut,
      preview: previewEditPlan(cut.plan, session.project, session.revision),
    };
  }
}
export const roughCutService = new RoughCutService();
