import { uid, type Project, type Keyframe } from "../../project-schema";
import { revisionTarget } from "./planner";
import {
  gainEnvelope,
  spokenRanges,
  type SpeechRange,
} from "../rough-cut/audio";
import { gymStyles } from "../rough-cut/styles";
import { timelineFrameAt } from "../../time-remap/model";
import { previewEditPlan } from "../editor-agent/execution";
import type { Treatment } from "./treatment-model";
import type { MediaAnalysis } from "../media-analysis/model";
import type { EditorToolCall } from "../editor-agent/registry";
export { audioRevision } from "./requests";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Preserve user-added, moved, deleted or edited keys across successive AI revisions. */
export function preserveManualKeys(
  current: Keyframe[],
  baseline: Keyframe[] | undefined,
  proposed: Keyframe[],
) {
  if (!baseline) return current.length ? current : proposed;
  const map = new Map(proposed.map((k) => [k.frame, k]));
  for (const old of baseline)
    if (!current.some((k) => k.frame === old.frame)) map.delete(old.frame);
  for (const k of current)
    if (
      !same(
        k,
        baseline.find((b) => b.frame === k.frame),
      )
    )
      map.set(k.frame, k);
  return [...map.values()].sort((a, b) => a.frame - b.frame);
}
export function planAudioRevision(
  request: string,
  project: Project,
  revision: number,
  activeId: string | null,
  analyses: readonly MediaAnalysis[] = [],
) {
  const c = revisionTarget(project, activeId),
    rate = c.settings.fps.num / c.settings.fps.den,
    profile = gymStyles[c.ai?.brief.style ?? "clean-aesthetic"],
    ranges: SpeechRange[] = [];
  const music = c.layers.filter(
    (l) => project.assets.find((a) => a.id === l.assetId)?.kind === "audio",
  );
  const sources = c.layers.filter(
    (l) =>
      project.assets.find((a) => a.id === l.assetId)?.kind === "video" &&
      project.assets.find((a) => a.id === l.assetId)?.hasAudio,
  );
  const imports: EditorToolCall[] = [],
    known = new Set(project.transcripts.map((t) => t.id));
  for (const clip of sources) {
    const asset = project.assets.find((a) => a.id === clip.assetId)!;
    const own = analyses.filter(
      (a) => a.assetId === asset.id && a.fingerprint === asset.fingerprint,
    );
    const t =
      project.transcripts.find(
        (t) =>
          t.assetId === asset.id && t.sourceFingerprint === asset.fingerprint,
      ) ?? own.find((a) => a.transcript)?.transcript;
    if (t && !known.has(t.id)) {
      imports.push({ tool: "transcript.import", transcript: t });
      known.add(t.id);
    }
    for (const s of spokenRanges(
      t,
      own.find((a) => a.audio)?.audio?.silences,
    )) {
      const start =
          clip.start +
          Math.max(
            0,
            Math.floor(timelineFrameAt(clip, (s.startMs * rate) / 1000)),
          ),
        end =
          clip.start +
          Math.min(
            clip.duration,
            Math.ceil(timelineFrameAt(clip, (s.endMs * rate) / 1000)),
          );
      if (end > start) ranges.push({ start, end });
    }
  }
  const changes: Treatment[] = [],
    generated: Treatment[] = [];
  const original = /original gym sounds/i.test(request),
    remove = /remove (?:the )?ducking/i.test(request),
    louder = /music louder/i.test(request);
  if (original) {
    for (const clip of sources) {
      const baseline = c.ai?.generated?.find((b) => b.clipId === clip.id),
        gain = clip.gain === baseline?.gain ? 0 : clip.gain,
        keys = gainEnvelope(clip.duration, rate, gain, [], 0, 0.035);
      const patch: Treatment = {
        clipId: clip.id,
        gain,
        gainKeys: preserveManualKeys(
          clip.keyframes.gain,
          baseline?.gainKeys,
          keys,
        ),
        timeRemap: null,
      };
      changes.push(patch);
      generated.push({ ...patch, gainKeys: keys });
    }
  } else {
    if (!music.length)
      throw new Error("This sequence has no music clip to mix");
    if (!remove && !louder && !ranges.length)
      throw new Error(
        "No transcribed speech overlaps this sequence; transcribe the source before requesting speech ducking",
      );
    for (const clip of music) {
      const baseline = c.ai?.generated?.find((b) => b.clipId === clip.id);
      if (louder) {
        const gain = Math.min(12, clip.gain + 3),
          keys = clip.keyframes.gain.map((k) => ({
            ...k,
            value: Math.min(12, k.value + 3),
          }));
        changes.push({ clipId: clip.id, gain, gainKeys: keys });
        generated.push({
          clipId: clip.id,
          gain: Math.min(12, (baseline?.gain ?? clip.gain) + 3),
          gainKeys: (baseline?.gainKeys ?? clip.keyframes.gain).map((k) => ({
            ...k,
            value: Math.min(12, k.value + 3),
          })),
        });
      } else {
        const keys = gainEnvelope(
          clip.duration,
          rate,
          clip.gain,
          remove
            ? []
            : ranges
                .filter(
                  (r) =>
                    r.end > clip.start && r.start < clip.start + clip.duration,
                )
                .map((r) => ({
                  start: Math.max(0, r.start - clip.start),
                  end: Math.min(clip.duration, r.end - clip.start),
                })),
          profile.audio.duckDb,
          profile.audio.fadeSeconds,
        );
        changes.push({
          clipId: clip.id,
          gainKeys: preserveManualKeys(
            clip.keyframes.gain,
            baseline?.gainKeys,
            keys,
          ),
        });
        generated.push({ clipId: clip.id, gainKeys: keys });
      }
    }
  }
  if (!changes.length)
    throw new Error("No source audio is available in this sequence");
  const summary = original
    ? "Restore original gym audio at normal speed; retain manually edited gain keys"
    : louder
      ? "Raise music by 3 dB, including its editable envelope"
      : remove
        ? "Remove generated ducking; preserve fades and manual gain keys"
        : `Duck music during ${ranges.length} transcribed speech ranges; preserve manual gain keys`;
  return previewEditPlan(
    {
      id: uid(),
      projectId: project.id,
      revision,
      compositionId: null,
      resultCompositionId: c.id,
      summary,
      processing: "LOCAL",
      commands: [
        ...imports,
        {
          tool: "sequence.treatment",
          sequenceId: c.id,
          changes,
          generated,
          record: {
            id: uid(),
            request,
            summary,
            createdAt: new Date().toISOString(),
            changedLayerIds: changes.map((x) => x.clipId),
          },
        },
      ],
    },
    project,
    revision,
  );
}
