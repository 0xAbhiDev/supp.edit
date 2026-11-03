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
  type ReviewOptions,
} from "./planner";
import { previewEditPlan, type EditPreview } from "../editor-agent/execution";
import { frameAestheticCut } from "./framing";
import { nativeSubjectBackend, type SubjectBackend } from "../reframe/service";
import {
  matchAestheticColor,
  nativeColorBackend,
  type ColorBackend,
} from "./matching";
import { mixAestheticAudio } from "./audio";
export interface RoughCutSession {
  project: Project;
  revision: number;
  evidence: RankedEvidence;
  cut: RoughCutPlan;
  preview: EditPreview;
  audioEvidence?: MediaAnalysis[];
}
export class RoughCutService {
  constructor(
    readonly analysis: MediaAnalysisService = mediaAnalysis,
    readonly subjects: SubjectBackend = nativeSubjectBackend,
    readonly colors: ColorBackend = nativeColorBackend,
  ) {}
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
          audioSources =
            brief.style || brief.captions
              ? videos.filter((a) => a.hasAudio)
              : [],
          total =
            videos.length +
            audioSources.length * 2 +
            (music ? 1 : 0) +
            (brief.prioritize.length ? 1 : 0) +
            (brief.style ? 2 : 0);
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
        for (const asset of audioSources) {
          for (const task of ["speech", "audio"] as const) {
            await job.checkpoint();
            results.push(
              await this.analysis.runTask(
                asset,
                defaultAnalysisSettings(task),
                subtask(),
              ),
            );
            completed++;
          }
        }
        await job.checkpoint();
        completed = total - (brief.style ? 2 : 0);
        const evidence = rankMoments(project, results, brief, query),
          initial = buildRoughCut(
            project,
            revision,
            brief,
            evidence,
            music,
            beatMap,
          );
        const mixed = mixAestheticAudio(project, initial, results);
        const matched = await matchAestheticColor(
          project,
          mixed,
          this.colors,
          subtask(),
        );
        if (brief.style) completed++;
        const cut = await frameAestheticCut(
          project,
          revision,
          matched,
          this.subjects,
          subtask(),
        );
        cut.plan.commands.push({
          tool: "sequence.remember",
          sequenceId: cut.plan.resultCompositionId!,
        });
        job.report({
          completed: total * 1000,
          total: total * 1000,
          unit: "analysis work",
        });
        return {
          project,
          revision,
          evidence,
          cut,
          preview: previewEditPlan(cut.plan, project, revision),
          audioEvidence: results.filter(
            (r) => r.settings.task === "audio" || r.settings.task === "speech",
          ),
        } satisfies RoughCutSession;
      },
    });
  }
  reselect(
    session: RoughCutSession,
    ids: readonly string[],
    disabledRampIds = session.cut.ramps
      .filter((r) => !r.enabled)
      .map((r) => r.candidateId),
    reviewOptions: ReviewOptions = session.cut.reviewOptions,
  ) {
    return this.analysis.jobs.enqueue({
      label: "Update aesthetic preview · LOCAL",
      scope: session.project.id,
      run: async (job) => {
        const cut = buildRoughCut(
          session.project,
          session.revision,
          session.cut.brief,
          session.evidence,
          session.cut.music,
          session.cut.beatMap,
          ids,
          disabledRampIds,
          reviewOptions,
        );
        const stage = (index: number): JobContext => ({
          ...job,
          report: (p) =>
            job.report({
              completed: index + (p.total ? p.completed / p.total : 0),
              total: 2,
              unit: "preview finishing",
            }),
        });
        const mixed = mixAestheticAudio(
          session.project,
          cut,
          session.audioEvidence ?? [],
        );
        const matched = await matchAestheticColor(
          session.project,
          mixed,
          this.colors,
          stage(0),
        );
        const complete = await frameAestheticCut(
          session.project,
          session.revision,
          matched,
          this.subjects,
          stage(1),
        );
        complete.plan.commands.push({
          tool: "sequence.remember",
          sequenceId: complete.plan.resultCompositionId!,
        });
        return {
          ...session,
          cut: complete,
          preview: previewEditPlan(
            complete.plan,
            session.project,
            session.revision,
          ),
        };
      },
    });
  }
}
export const roughCutService = new RoughCutService();
