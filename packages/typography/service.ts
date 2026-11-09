import type { Project } from "../project-schema";
import { compositionView } from "../commands/compositions";
import {
  mediaAnalysis,
  type MediaAnalysisService,
} from "../ai/media-analysis/service";
import { defaultAnalysisSettings } from "../ai/media-analysis/model";
import { planTypography, musicRequested } from "./planner";
export class TypographyService {
  constructor(readonly analysis: MediaAnalysisService = mediaAnalysis) {}
  plan(
    request: string,
    project: Project,
    revision: number,
    scope: string | null,
  ) {
    return this.analysis.jobs.enqueue({
      label: "Plan typography · LOCAL",
      scope: project.id,
      run: async (job) => {
        const p = compositionView(project, scope);
        for (const a of project.assets.filter((a) =>
          p.clips.some((c) => c.assetId === a.id),
        )) {
          await job.checkpoint();
          await this.analysis.restore(a);
          if (musicRequested(request) && a.kind === "audio")
            await this.analysis.runTask(
              a,
              defaultAnalysisSettings("audio"),
              job,
            );
        }
        return planTypography(
          request,
          project,
          revision,
          scope,
          this.analysis.getSnapshot(),
        );
      },
    });
  }
}
export const typographyService = new TypographyService();
