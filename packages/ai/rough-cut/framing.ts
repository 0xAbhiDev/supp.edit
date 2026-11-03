import { type Project, uid } from "../../project-schema";
import type { JobContext } from "../../jobs";
import { sourceFrameAt, timelineFrameAt } from "../../time-remap/model";
import { eventImpact } from "./music";
import { previewEditPlan } from "../editor-agent/execution";
import type { EditorToolCall } from "../editor-agent/registry";
import { planReframe } from "../reframe/planner";
import type { SubjectBackend } from "../reframe/service";
import type { SubjectSamples } from "../reframe/model";
import type { RoughCutPlan } from "./planner";
import { gymStyles } from "./styles";
export async function frameAestheticCut(
  project: Project,
  revision: number,
  cut: RoughCutPlan,
  backend: SubjectBackend,
  job: JobContext,
): Promise<RoughCutPlan> {
  if (!cut.brief.style) return cut;
  const base = previewEditPlan(cut.plan, project, revision),
    sequence = base.project.compositions.find(
      (c) => c.id === cut.plan.resultCompositionId,
    )!;
  const videos = sequence.layers.filter(
    (c) => project.assets.find((a) => a.id === c.assetId)?.kind === "video",
  );
  const rate = sequence.settings.fps.num / sequence.settings.fps.den,
    evidence = new Map<string, SubjectSamples>(),
    commands: EditorToolCall[] = [...cut.plan.commands],
    warnings = [...cut.warnings];
  if (cut.brief.aspect === "9:16") {
    for (const [i, clip] of videos.entries()) {
      await job.checkpoint();
      const asset = project.assets.find((a) => a.id === clip.assetId)!;
      const sampling = {
        startMs: Math.floor((sourceFrameAt(clip, 0) * 1000) / rate),
        endMs: Math.floor((sourceFrameAt(clip, clip.duration) * 1000) / rate),
        intervalMs: 250,
      };
      evidence.set(
        clip.id,
        await backend(asset, sampling, {
          ...job,
          report: (p) =>
            job.report({
              completed: i + (p.total ? p.completed / p.total : 0),
              total: videos.length,
              unit: "shots framed",
            }),
        }),
      );
      job.report({
        completed: i + 1,
        total: videos.length,
        unit: "shots framed",
      });
    }
    await job.checkpoint();
    const framed = planReframe(
      "Keep me centered in 9:16 in the existing sequence",
      base.project,
      revision,
      sequence.id,
      evidence,
    );
    commands.push(...framed.plan.commands);
    warnings.push(
      "Person-aware framing uses dense local detections and speed-mapped source times; uncertain observations hold the associated subject. Review source-edge cropping and letterboxing.",
    );
  }
  const style = gymStyles[cut.brief.style],
    punchIns: RoughCutPlan["punchIns"] = [];
  const baseScale = /looser|wider framing/i.test(cut.brief.prompt)
    ? 0.96
    : /tighter framing|frame (?:me|it) tighter/i.test(cut.brief.prompt)
      ? 1.02
      : cut.brief.style === "powerlifting"
        ? 0.98
        : cut.brief.style === "physique"
          ? 1.01
          : cut.brief.style === "cinematic"
            ? 0.99
            : 1;
  const framingTreatment =
    baseScale < 1
      ? `Looser ${style.name} framing (${(baseScale * 100).toFixed(0)}%)`
      : baseScale > 1
        ? `Tighter ${style.name} framing (${(baseScale * 100).toFixed(0)}%)`
        : "Base person-aware camera";
  const zooms = new Map<
    string,
    { amount: number; peak: number; enabled: boolean; controllerId: string }
  >();
  if (
    style.zoomIntensity &&
    !/(?:no|without|disable) (?:punch.in|zoom)/i.test(cut.brief.prompt)
  ) {
    const selected = cut.shots
      .map((shot, i) => ({ shot, clip: videos[i] }))
      .filter(
        ({ shot }) =>
          !shot.candidate.subject.edgeClipped &&
          shot.candidate.subject.presence >= 0.6 &&
          shot.duration / rate >= 1.5,
      )
      .sort(
        (a, b) =>
          b.shot.candidate.overallScore +
          (b.shot.role === "PEAK" ? 0.1 : 0) -
          (a.shot.candidate.overallScore + (a.shot.role === "PEAK" ? 0.1 : 0)),
      )
      .slice(0, 2);
    for (const { shot, clip } of selected) {
      const accent = cut.musicEvents
        .filter(
          (e) =>
            e.kind !== "beat" &&
            (e.timeMs * rate) / 1000 > clip.start + clip.duration * 0.3 &&
            (e.timeMs * rate) / 1000 < clip.start + clip.duration * 0.8,
        )
        .sort(
          (a, b) => eventImpact([b], b.timeMs) - eventImpact([a], a.timeMs),
        )[0];
      const amount =
          style.zoomIntensity * (0.7 + 0.3 * shot.candidate.subjectScore),
        controllerId = uid(),
        peak = Math.max(
          1,
          Math.min(
            clip.duration - 2,
            Math.round(
              accent
                ? (accent.timeMs * rate) / 1000 - clip.start
                : Math.max(
                    clip.duration * 0.3,
                    Math.min(
                      clip.duration * 0.8,
                      timelineFrameAt(
                        clip,
                        (shot.candidate.motionPeakMs * rate) / 1000,
                      ),
                    ),
                  ),
            ),
          ),
        );
      const enabled = !cut.reviewOptions.disabledPunchIns.includes(
        shot.candidate.id,
      );
      zooms.set(clip.id, { amount, peak, enabled, controllerId });
      punchIns.push({
        candidateId: shot.candidate.id,
        controllerId,
        amount,
        enabled,
      });
    }
  }
  for (const clip of videos) {
    const zoom = zooms.get(clip.id);
    if (baseScale !== 1 || zoom?.enabled)
      commands.push({
        tool: "sequence.punchIn",
        sequenceId: sequence.id,
        clipId: clip.id,
        controllerId: zoom?.controllerId ?? uid(),
        amount: zoom?.enabled ? zoom.amount : 0,
        peak: zoom?.peak ?? Math.round(clip.duration * 0.6),
        baseScale,
      });
  }
  const plan = {
    ...cut.plan,
    commands: commands.map((c) =>
      c.tool === "sequence.create" ? { ...c, ai: { ...c.ai, warnings } } : c,
    ),
  };
  previewEditPlan(plan, project, revision);
  return {
    ...cut,
    plan,
    punchIns,
    framingTreatment,
    framedShots: evidence.size,
    warnings,
  };
}
