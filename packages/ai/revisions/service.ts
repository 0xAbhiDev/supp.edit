import { type Project } from "../../project-schema";
import {
  mediaAnalysis,
  type MediaAnalysisService,
} from "../media-analysis/service";
import { defaultAnalysisSettings } from "../media-analysis/model";
import { parseEditBrief } from "../rough-cut/model";
import { rankMoments } from "../rough-cut/planner";
import { planRevision, revisionTarget } from "./planner";
import { visualRevision, musicRevision } from "./requests";
import { audioRevision, planAudioRevision } from "./audio";
export class RevisionService {
  constructor(readonly analysis: MediaAnalysisService = mediaAnalysis) {}
  plan(
    request: string,
    project: Project,
    revision: number,
    activeId: string | null,
  ) {
    const target = revisionTarget(project, activeId);
    return this.analysis.jobs.enqueue({
      label: "Plan sequence revision · LOCAL",
      scope: project.id,
      run: async (job) => {
        await job.checkpoint();
        if (audioRevision(request)) {
          if (
            !/remove (?:the )?ducking|music louder|original gym sounds/i.test(
              request,
            )
          ) {
            for (const asset of project.assets.filter(
              (a) =>
                a.kind === "video" &&
                a.hasAudio &&
                target.layers.some((l) => l.assetId === a.id),
            )) {
              await this.analysis.restore(asset);
              for (const task of ["audio", "speech"] as const)
                await this.analysis.runTask(
                  asset,
                  defaultAnalysisSettings(task),
                  job,
                );
            }
          }
          return planAudioRevision(
            request,
            project,
            revision,
            target.id,
            this.analysis.getSnapshot(),
          );
        }
        const replacement = visualRevision(request);
        const sync = musicRevision(request);
        let evidence;
        if (replacement || sync) {
          const assets = project.assets.filter((a) =>
            replacement
              ? a.kind === "video"
              : a.kind === "audio" &&
                target.layers.some((l) => l.assetId === a.id),
          );
          if (assets.length > 64)
            throw new Error("Analyze up to 64 sources for one revision");
          for (const asset of assets) {
            await job.checkpoint();
            await this.analysis.restore(asset);
            await this.analysis.runTask(
              asset,
              defaultAnalysisSettings(replacement ? "vision" : "audio"),
              job,
            );
          }
          if (replacement) {
            const brief = target.ai
              ? { ...target.ai.brief, prompt: request }
              : parseEditBrief(request);
            // 'Less bench' chooses a source with lower similarity to the paired bench query.
            const less = /less bench/i.test(request),
              semantic = /(?:use more|less bench)/i.test(request);
            const query = semantic
              ? await this.analysis.embedQuery(
                  less
                    ? "a person bench pressing"
                    : `a person ${request.replace(/^use more\s+/i, "")}`,
                  job,
                )
              : undefined;
            evidence = rankMoments(
              project,
              this.analysis.getSnapshot(),
              brief,
              query,
            );
            if (semantic)
              evidence = {
                ...evidence,
                candidates: [...evidence.candidates].sort((a, b) =>
                  less
                    ? a.promptRelevance - b.promptRelevance
                    : b.promptRelevance - a.promptRelevance,
                ),
              };
          }
        }
        await job.checkpoint();
        return planRevision(
          request,
          project,
          revision,
          target.id,
          this.analysis.getSnapshot(),
          evidence,
        );
      },
    });
  }
}
export const revisionService = new RevisionService();
