import { uid, type Project, type Keyframe } from "../../project-schema";
import type { MediaAnalysis } from "../media-analysis/model";
import type { EditorToolCall } from "../editor-agent/registry";
import type { RoughCutPlan } from "./planner";
import { gymStyles } from "./styles";
import type { Transcript } from "../transcript";

export interface SpeechRange {
  start: number;
  end: number;
}
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
/** Prefer word timestamps so long transcript segments do not duck through long pauses. */
export function spokenRanges(
  transcript: Transcript | undefined,
  silences: readonly { startMs: number; endMs: number }[] = [],
) {
  const ranges: { startMs: number; endMs: number }[] = [];
  for (const s of transcript?.segments ?? [])
    for (const w of s.words?.length ? s.words : [s]) {
      if (w.endMs <= w.startMs) continue;
      const last = ranges.at(-1);
      if (last && w.startMs - last.endMs < 300)
        last.endMs = Math.max(last.endMs, w.endMs);
      else ranges.push({ startMs: w.startMs, endMs: w.endMs });
    }
  return ranges.flatMap((r) => {
    let audible = [r];
    for (const silence of silences)
      audible = audible.flatMap((a) =>
        silence.endMs <= a.startMs || silence.startMs >= a.endMs
          ? [a]
          : [
              { startMs: a.startMs, endMs: Math.min(a.endMs, silence.startMs) },
              { startMs: Math.max(a.startMs, silence.endMs), endMs: a.endMs },
            ].filter((x) => x.endMs > x.startMs),
      );
    return audible;
  });
}
export function gainEnvelope(
  duration: number,
  rate: number,
  base: number,
  ranges: SpeechRange[],
  duckDb: number,
  fadeSeconds: number,
): Keyframe[] {
  const end = duration - 1,
    fade = Math.min(Math.round(fadeSeconds * rate), Math.floor(end / 2)),
    attack = Math.max(1, Math.round(0.12 * rate)),
    release = Math.max(1, Math.round(0.35 * rate));
  const merged: SpeechRange[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && r.start - last.end <= attack + release)
      last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const points = new Set([0, end, fade, end - fade]);
  for (const r of merged)
    for (const t of [r.start - attack, r.start, r.end, r.end + release])
      points.add(clamp(Math.round(t), 0, end));
  return [...points]
    .sort((a, b) => a - b)
    .map((frame) => {
      const duck = merged.reduce(
        (v, r) =>
          Math.max(
            v,
            frame < r.start
              ? clamp((frame - r.start + attack) / attack, 0, 1)
              : frame <= r.end
                ? 1
                : clamp(1 - (frame - r.end) / release, 0, 1),
          ),
        0,
      );
      const fadeDb = fade
        ? Math.min(1, frame / fade, (end - frame) / fade) * (base + 60) - 60
        : base;
      return {
        frame,
        value: clamp(Math.min(fadeDb, base - duck * duckDb), -60, 12),
        easing: "linear",
      };
    });
}
function measuredGain(
  analysis: MediaAnalysis | undefined,
  ranges: { startMs: number; endMs: number }[],
  target: number,
  fallback: number,
) {
  const samples =
    analysis?.audio?.beatMap.energyCurve.filter(
      (s) =>
        ranges.some((r) => s.timeMs >= r.startMs && s.timeMs < r.endMs) &&
        s.rmsDb > -65,
    ) ?? [];
  if (!samples.length) return fallback;
  const db =
    10 *
    Math.log10(
      samples.reduce((sum, s) => sum + 10 ** (s.rmsDb / 10), 0) /
        samples.length,
    );
  return clamp(target - db, -24, 6);
}
/** Ordinary gain keys/captions only. Speech ranges retain normal source speed. */
export function mixAestheticAudio(
  project: Project,
  cut: RoughCutPlan,
  analyses: readonly MediaAnalysis[],
): RoughCutPlan {
  if (!cut.brief.style && !cut.brief.captions) return cut;
  const create = cut.plan.commands.find((c) => c.tool === "sequence.create");
  if (!create || create.tool !== "sequence.create")
    throw new Error("Missing sequence creation");
  const rate = create.settings.fps.num / create.settings.fps.den,
    profile = gymStyles[cut.brief.style ?? "clean-aesthetic"],
    duration = create.duration;
  let commands = [...cut.plan.commands];
  const additions: EditorToolCall[] = [],
    speechRanges: SpeechRange[] = [],
    normalSpeed = new Set<string>(),
    imports = new Set(project.transcripts.map((t) => t.id));
  let speechClips = 0,
    suppressedSources = 0;
  const keyCommands = (clipId: string, start: number, keys: Keyframe[]) =>
    keys.map((k) => ({
      tool: "sequence.keyframe" as const,
      sequenceId: create.id,
      clipId,
      property: "gain" as const,
      value: k.value,
      frame: start + k.frame,
      easing: k.easing,
    }));
  for (const shot of cut.shots) {
    const asset = project.assets.find((a) => a.id === shot.candidate.assetId)!;
    if (!asset.hasAudio) continue;
    const insertion = commands.find(
      (c) =>
        c.tool === "sequence.insert" &&
        c.assetId === asset.id &&
        c.startFrame === shot.startFrame,
    );
    if (!insertion || insertion.tool !== "sequence.insert")
      throw new Error("Missing shot insertion");
    const own = analyses.filter(
        (a) => a.assetId === asset.id && a.fingerprint === asset.fingerprint,
      ),
      speech = own.find((a) => a.settings.task === "speech");
    if (!speech)
      throw new Error(`Analyze speech in ${asset.name} before balancing audio`);
    const transcript = speech.transcript,
      startMs = (shot.sourceIn / rate) * 1000,
      endMs = ((shot.sourceIn + shot.duration) / rate) * 1000;
    const segments = spokenRanges(
      transcript,
      own.find((a) => a.audio)?.audio?.silences,
    ).filter((s) => s.endMs > startMs && s.startMs < endMs);
    if (segments.length) {
      speechClips++;
      normalSpeed.add(shot.candidate.id);
      commands = commands.filter(
        (c) => !(c.tool === "sequence.speed" && c.clipId === insertion.clipId),
      );
      const gain = measuredGain(
        own.find((a) => a.audio),
        segments,
        profile.audio.dialogueTargetDb,
        0,
      );
      commands = commands.map((c) =>
        c === insertion ? { ...insertion, gain } : c,
      );
      additions.push(
        ...keyCommands(
          insertion.clipId,
          shot.startFrame,
          gainEnvelope(shot.duration, rate, gain, [], 0, 0.035),
        ),
      );
      for (const s of segments)
        speechRanges.push({
          start:
            shot.startFrame +
            clamp(
              Math.floor((s.startMs * rate) / 1000) - shot.sourceIn,
              0,
              shot.duration,
            ),
          end:
            shot.startFrame +
            clamp(
              Math.ceil((s.endMs * rate) / 1000) - shot.sourceIn,
              0,
              shot.duration,
            ),
        });
      if (transcript && !imports.has(transcript.id)) {
        additions.push({ tool: "transcript.import", transcript });
        imports.add(transcript.id);
      }
      if (cut.brief.captions && transcript)
        additions.push({
          tool: "sequence.captions",
          sequenceId: create.id,
          clipId: insertion.clipId,
          transcriptId: transcript.id,
          trackId: uid(),
          prefix: uid(),
          style: /karaoke/i.test(cut.brief.prompt)
            ? "Karaoke"
            : /creator/i.test(cut.brief.prompt)
              ? "Creator"
              : profile.captionStyle,
        });
    } else if (
      /keep (?:the )?original (?:gym )?sounds/i.test(cut.brief.prompt)
    ) {
      normalSpeed.add(shot.candidate.id);
      commands = commands.filter(
        (c) => !(c.tool === "sequence.speed" && c.clipId === insertion.clipId),
      );
      additions.push(
        ...keyCommands(
          insertion.clipId,
          shot.startFrame,
          gainEnvelope(shot.duration, rate, 0, [], 0, 0.035),
        ),
      );
    } else if (cut.music) {
      // Music-led edits suppress pitched room noise. This remains a normal editable gain.
      suppressedSources++;
      commands = commands.map((c) =>
        c === insertion ? { ...insertion, gain: -60 } : c,
      );
    }
  }
  const music = commands.find(
    (c) => c.tool === "sequence.insert" && c.assetId === cut.music?.id,
  );
  let musicGain: number | null = null;
  if (music?.tool === "sequence.insert") {
    const measured = analyses.find(
      (a) =>
        a.assetId === music.assetId &&
        a.fingerprint === music.fingerprint &&
        a.audio,
    );
    musicGain = measuredGain(
      measured,
      [{ startMs: 0, endMs: (duration / rate) * 1000 }],
      profile.audio.musicDb,
      profile.audio.musicDb,
    );
    commands = commands.map((c) =>
      c === music ? { ...music, gain: musicGain! } : c,
    );
    additions.push(
      ...keyCommands(
        music.clipId,
        0,
        gainEnvelope(
          duration,
          rate,
          musicGain,
          speechRanges,
          profile.audio.duckDb,
          profile.audio.fadeSeconds,
        ),
      ),
    );
  }
  const ramps = cut.ramps.map((r) =>
    normalSpeed.has(r.candidateId)
      ? {
          ...r,
          enabled: false,
          reason:
            "Speech overlaps this shot; normal speed preserves the voice and its pitch.",
        }
      : r,
  );
  const warnings = cut.warnings.filter(
    (w) =>
      !w.startsWith("This rough-cut pass does not add captions") &&
      !w.startsWith("Initial color uses"),
  );
  if (cut.brief.captions && !speechClips)
    warnings.push(
      "No transcribed speech overlaps the selected shots; no captions were generated.",
    );
  if (speechClips)
    warnings.push(
      "Local Whisper word timing and speech recognition are approximate; review the transcript before applying captions.",
    );
  return {
    ...cut,
    ramps,
    warnings,
    audio: {
      speechClips,
      duckedRanges: music ? speechRanges.length : 0,
      suppressedSources,
      musicGain,
      captionStyle: cut.brief.captions ? profile.captionStyle : null,
    },
    plan: { ...cut.plan, commands: [...commands, ...additions] },
  };
}
