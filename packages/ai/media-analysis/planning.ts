import { fps, uid, type Project } from "../../project-schema";
import { type Transcript } from "../transcript";
import { previewEditPlan } from "../editor-agent/execution";
import { type EditorToolCall } from "../editor-agent/registry";
import { type MediaRange } from "./model";
import { timelineFrameAt } from "../../time-remap/model";
export function previewAnalysisCommands(
  project: Project,
  revision: number,
  summary: string,
  commands: EditorToolCall[],
) {
  return previewEditPlan(
    {
      id: uid(),
      projectId: project.id,
      revision,
      compositionId: null,
      processing: "LOCAL",
      summary,
      commands,
    },
    project,
    revision,
  );
}
export function transcriptCommands(
  project: Project,
  transcript: Transcript,
  clipId?: string,
): EditorToolCall[] {
  const commands: EditorToolCall[] = [];
  if (!project.transcripts.some((t) => t.id === transcript.id))
    commands.push({ tool: "transcript.import", transcript });
  if (clipId)
    commands.push({
      tool: "transcript.captions",
      transcriptId: transcript.id,
      clipId,
      trackId: uid(),
      prefix: uid(),
    });
  if (!commands.length)
    throw new Error("This transcript is already saved in the project");
  return commands;
}
export function sourceToTimelineRanges(
  project: Project,
  clipId: string,
  source: readonly MediaRange[],
) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== "media")
    throw new Error("Select a timeline media clip to preview this edit");
  const rate = fps(project);
  const ranges = source
    .map((r) => ({
      startFrame: Math.max(
        clip.start,
        clip.start +
          Math.floor(timelineFrameAt(clip, (r.startMs * rate) / 1000)),
      ),
      endFrame: Math.min(
        clip.start + clip.duration,
        clip.start + Math.ceil(timelineFrameAt(clip, (r.endMs * rate) / 1000)),
      ),
    }))
    .filter((r) => r.endFrame > r.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.startFrame <= last.endFrame)
      last.endFrame = Math.max(last.endFrame, r.endFrame);
    else merged.push(r);
  }
  if (!merged.length)
    throw new Error(
      "These source ranges do not overlap the selected timeline clip",
    );
  return merged;
}
export type FillerCandidate = MediaRange & { text: string; reason: string };
export function fillerCandidates(
  transcript: Transcript,
  style: "conservative" | "balanced" | "aggressive" = "conservative",
): FillerCandidate[] {
  if (transcript.language && !/^en(?:-|$)/i.test(transcript.language))
    return [];
  const words = transcript.segments.flatMap((s) => s.words ?? []),
    result: FillerCandidate[] = [];
  const normalized = (text: string) =>
    text.toLocaleLowerCase("en").replace(/[^a-z]/g, "");
  for (let i = 0; i < words.length; i++) {
    const w = words[i],
      text = normalized(w.text);
    if (w.endMs <= w.startMs) continue;
    if (
      ["um", "uh", "erm", "umm", "uhh"].includes(text) ||
      (style === "aggressive" && text === "like")
    )
      result.push({
        startMs: w.startMs,
        endMs: w.endMs,
        text: w.text,
        reason:
          text === "like"
            ? "Context-dependent word; review before cutting"
            : "Possible hesitation",
      });
    if (
      style !== "conservative" &&
      text === "you" &&
      words[i + 1] &&
      normalized(words[i + 1].text) === "know" &&
      words[i + 1].startMs - w.endMs < 300
    ) {
      result.push({
        startMs: w.startMs,
        endMs: words[i + 1].endMs,
        text: `${w.text} ${words[i + 1].text}`,
        reason: "Context-dependent phrase; review before cutting",
      });
      i++;
    }
  }
  return result;
}
export function nearestBeat(
  beats: readonly { timeMs: number; strength: number }[],
  timeMs: number,
  toleranceMs = 200,
  minimumStrength = 0,
) {
  return (
    beats
      .filter(
        (b) =>
          b.strength >= minimumStrength &&
          Math.abs(b.timeMs - timeMs) <= toleranceMs,
      )
      .sort(
        (a, b) =>
          Math.abs(a.timeMs - timeMs) - Math.abs(b.timeMs - timeMs) ||
          b.strength - a.strength,
      )[0] ?? null
  );
}
