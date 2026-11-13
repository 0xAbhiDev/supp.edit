import { measuredColor, type VisualFrame } from "./visual";
import { type Project, type Asset, fps, uid } from "../../project-schema";
import { parseEditBrief } from "../rough-cut/model";
import type { EditorToolCall } from "../editor-agent/registry";
import { previewEditPlan } from "../editor-agent/execution";
import type { BeatMap, MediaAnalysis } from "../media-analysis/model";
import type { ColorStats } from "../rough-cut/matching";
import { nearestStrongBeat } from "../rough-cut/beats";
import { compositionView } from "../../commands/compositions";
import { placement } from "../../typography/planner";
import { availableRanges, matchRange, consumeRange } from "./matcher";
import { sourceFrameAt } from "../../time-remap/model";
import { type StyleDNA, type RecreationMode } from "./dna";
export interface SourceEvidence {
  asset: Asset;
  analysis: MediaAnalysis;
  color?: ColorStats;
  speech?: MediaAnalysis;
  visual?: VisualFrame[];
}
export interface Controls {
  mode: RecreationMode;
  wording: "adapt" | "original" | "omit";
  pace: number;
  color: number;
  beat: number;
  instructions: string;
}
export const defaults: Controls = {
  mode: "Smart Adaptation",
  wording: "adapt",
  pace: 1,
  color: 0.75,
  beat: 0.65,
  instructions: "",
};
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n)) || 0;
// Use a bounded gain. The floor limits amplification of compression noise
// when a nearly neutral clip is matched to a strongly colored reference.
export function referenceGain(
  source: number,
  target: number,
  mix: number,
  floor: number,
  limit: number,
) {
  const ratio = (target + floor) / (source + floor);
  return Math.pow(clamp(ratio, 1 / limit, limit), clamp(mix, 0, 1));
}
export function buildRecreation(
  p: Project,
  revision: number,
  reference: Asset,
  dna: StyleDNA,
  sources: SourceEvidence[],
  controls: Controls,
  music?: Asset,
  map?: BeatMap,
  voice?: Asset,
  voiceTranscript?: Project["transcripts"][number],
) {
  const rate = fps(p),
    id = uid(),
    video = uid(),
    audio = uid(),
    command: EditorToolCall[] = [],
    warnings: string[] = [],
    matches: {
      source: string;
      clipId: string;
      sourceIn: number;
      start: number;
      duration: number;
      referenceMs: number;
      referenceEndMs: number;
    }[] = [];
  if (
    !sources.length ||
    [...sources.map((s) => s.asset), music, voice].some(
      (a) =>
        a &&
        (a.id === reference.id ||
          a.fingerprint === reference.fingerprint ||
          a.path === reference.path),
    )
  )
    throw Error("Choose raw footage distinct from the reference");
  if (music && voice && music.fingerprint === voice.fingerprint)
    throw Error("Choose separate music and voiceover files");
  const pool = availableRanges(sources, rate);
  const remix = controls.mode === "Creative Remix",
    close = controls.mode === "Close Match",
    keepColor = /keep .*colou?r|original colou?r|no grad/i.test(
      controls.instructions,
    ),
    pace =
      controls.pace *
      (/aggressive|faster/i.test(controls.instructions) ? 1.15 : 1),
    captions =
      /caption|talking.head|speech|voiceover/i.test(controls.instructions) ||
      !!voice;
  let cursor = 0;
  const protection: {
    clipId: string;
    bounds: { x: number; y: number; width: number; height: number };
  }[] = [];
  const effect = (
    clipId: string,
    type:
      | "brightness"
      | "tonalContrast"
      | "saturation"
      | "temperature"
      | "vignette",
    value: number,
  ) =>
    command.push({
      tool: "sequence.effect",
      sequenceId: id,
      clipId,
      effectId: uid(),
      type,
      value,
    });
  const titles = uid(),
    imports = new Set(p.transcripts.map((t) => t.id));
  function addCaptions(
    clipId: string,
    transcript: Project["transcripts"][number],
  ) {
    if (!imports.has(transcript.id)) {
      command.push({ tool: "transcript.import", transcript });
      imports.add(transcript.id);
    }
    command.push({
      tool: "sequence.captions",
      sequenceId: id,
      clipId,
      transcriptId: transcript.id,
      trackId: titles,
      prefix: uid(),
      style: "Creator",
    });
  }
  const referenceShots = dna.shots;
  const longestLater: number[] = [];
  let longest = 0;
  for (let i = referenceShots.length - 1; i >= 0; i--) {
    longestLater[i] = longest;
    const shot = referenceShots[i];
    longest = Math.max(
      longest,
      Math.round(((shot.endMs - shot.startMs) * rate) / (1000 * pace)),
    );
  }
  for (const [index, ref] of referenceShots.entries()) {
    // Bound the edit before hitting the normal editor's command budget.
    if (command.length > 460 || cursor >= rate * 300) {
      warnings.push("The edit reached the local sequence budget.");
      break;
    }
    const ideal = ((ref.endMs - ref.startMs) * rate) / 1000,
      requested = Math.max(
        2,
        Math.round((ideal / pace) * (remix ? (index % 2 ? 0.78 : 1.12) : 1)),
      );
    const nextRef = referenceShots[index + 1];
    const candidate = matchRange(
      pool,
      ref,
      requested,
      rate,
      controls.mode,
      matches.at(-1),
      nextRef ? ((nextRef.endMs - nextRef.startMs) * rate) / (1000 * pace) : 0,
      captions,
      close ? longestLater[index] : 0,
    );
    if (!candidate) {
      warnings.push(
        "The remaining raw footage has no usable range for shot " +
          (index + 1) +
          ".",
      );
      break;
    }
    const s = candidate.range,
      sourceIn = candidate.first,
      available = s.end - sourceIn;
    let duration = Math.min(candidate.length, Math.floor(300 * rate) - cursor);
    if (
      !close &&
      map &&
      controls.beat > 0 &&
      index < referenceShots.length - 1
    ) {
      const beat = nearestStrongBeat(
        map,
        ((cursor + duration) * 1000) / rate,
        250 * controls.beat,
      );
      if (beat)
        duration = clamp(
          Math.round((beat.timeMs * rate) / 1000) - cursor,
          2,
          Math.min(available, Math.floor(300 * rate) - cursor),
        );
    }
    const clipId = uid(),
      asset = s.source.asset;
    if (close ? duration < requested : duration < requested * 0.75)
      warnings.push(
        "Shot " +
          (index + 1) +
          " was shortened to fit the available raw footage.",
      );
    command.push({
      tool: "sequence.insert",
      sequenceId: id,
      clipId,
      assetId: asset.id,
      fingerprint: asset.fingerprint,
      trackId: video,
      startFrame: cursor,
      sourceIn,
      duration,
      gain: voice ? -60 : music ? -20 : 0,
    });
    const sourceColor = measuredColor(
      s.source.visual ?? [],
      (sourceIn * 1000) / rate,
      ((sourceIn + duration) * 1000) / rate,
    );
    const targetColor = ref.color ?? dna.color;
    if (targetColor && s.source.color && !keepColor && controls.color > 0) {
      const from = s.source.color,
        to = targetColor,
        k = controls.color;
      effect(
        clipId,
        "brightness",
        referenceGain(
          sourceColor?.luma ?? from.meanLuma,
          to.luma,
          k,
          0.06,
          1.8,
        ),
      );
      effect(
        clipId,
        "tonalContrast",
        clamp(
          1 + (to.contrast - (sourceColor?.contrast ?? from.contrastStd)) * k,
          0.8,
          1.25,
        ),
      );
      effect(
        clipId,
        "saturation",
        referenceGain(
          sourceColor?.saturation ?? from.meanSaturation,
          to.saturation,
          k,
          0.12,
          1.6,
        ),
      );
      const sourceTemperature =
        sourceColor?.temperature ?? from.neutralTemperature;
      if (to.temperature !== null && sourceTemperature !== null)
        effect(
          clipId,
          "temperature",
          clamp((to.temperature - sourceTemperature) * k, -0.4, 0.4),
        );
    }
    const key = (local: number, value: number) =>
      command.push({
        tool: "sequence.keyframe",
        sequenceId: id,
        clipId,
        property: "opacity",
        frame: cursor + local,
        value,
        easing: "linear",
      });
    const fade = Math.min(
      Math.round(rate * 0.2),
      Math.floor((duration - 1) / 3),
    );
    if (fade > 0 && ref.fadeIn) {
      key(0, 0);
      key(fade, 1);
    }
    if (fade > 0 && ref.fadeOut) {
      key(duration - 1 - fade, 1);
      key(duration - 1, 0);
    }
    const camera = ref.camera;
    const refScale = Math.min(1, 1920 / Math.max(dna.width, dna.height));
    const width = 2 * Math.round((dna.width * refScale) / 2),
      height = 2 * Math.round((dna.height * refScale) / 2);
    const observations =
      s.source.analysis.vision?.frames.filter(
        (f) =>
          f.timeMs >= (sourceIn * 1000) / rate &&
          f.timeMs <= ((sourceIn + duration) * 1000) / rate,
      ) ?? [];
    const closest = s.source.analysis.vision?.frames
      .filter((f) => f.sceneStartMs === s.shot.startMs)
      .sort(
        (a, b) =>
          Math.abs(a.timeMs - ((sourceIn + duration / 2) * 1000) / rate) -
          Math.abs(b.timeMs - ((sourceIn + duration / 2) * 1000) / rate),
      )[0];
    const frames = observations.length
      ? observations
      : closest
        ? [closest]
        : [];
    const boxes = frames.flatMap((f) =>
      f.detections
        .filter(
          (d) =>
            d.confidence >= 0.5 &&
            (d.label === "person" || d.bounds.width * d.bounds.height >= 0.005),
        )
        .map((d) => d.bounds),
    );
    const box = boxes.length
      ? {
          x: Math.min(...boxes.map((b) => b.x)),
          y: Math.min(...boxes.map((b) => b.y)),
          width:
            Math.max(...boxes.map((b) => b.x + b.width)) -
            Math.min(...boxes.map((b) => b.x)),
          height:
            Math.max(...boxes.map((b) => b.y + b.height)) -
            Math.min(...boxes.map((b) => b.y)),
        }
      : undefined;
    if (box) protection.push({ clipId, bounds: box });
    let baseScale = 1;
    let safeScale = 10;
    if (!box && ref.layout && !ref.subject && (camera?.letterbox ?? 0) < 0.03) {
      const fit = Math.min(width / asset.width, height / asset.height);
      baseScale = clamp(
        Math.max(width / (asset.width * fit), height / (asset.height * fit)),
        1,
        10,
      );
      command.push({
        tool: "sequence.keyframe",
        sequenceId: id,
        clipId,
        property: "scale",
        frame: cursor,
        value: baseScale,
        easing: "linear",
      });
    }
    if (box) {
      const fit = Math.min(width / asset.width, height / asset.height),
        sw = asset.width * fit,
        sh = asset.height * fit;
      const cover = Math.max(width / sw, height / sh);
      baseScale = clamp(
        Math.min(
          cover,
          (width * 0.86) / (box.width * sw),
          (height * 0.8) / (box.height * sh),
        ),
        1,
        10,
      );
      const x = clamp(
        (0.5 - box.x - box.width / 2) * baseScale * sw,
        -Math.max(0, (baseScale * sw - width) / 2),
        Math.max(0, (baseScale * sw - width) / 2),
      );
      const y = clamp(
        (0.5 - box.y - box.height / 2) * baseScale * sh,
        -Math.max(0, (baseScale * sh - height) / 2),
        Math.max(0, (baseScale * sh - height) / 2),
      );
      // Zoom keys animate around the same fixed offset as the base frame.
      // Bound both corners of the union of all observed subjects.
      for (const [coord, offset, extent] of [
        [(box.x - 0.5) * sw, x, width],
        [(box.x + box.width - 0.5) * sw, x, width],
        [(box.y - 0.5) * sh, y, height],
        [(box.y + box.height - 0.5) * sh, y, height],
      ]) {
        if (Math.abs(coord) > 1e-6)
          safeScale = Math.min(
            safeScale,
            (extent / 2 - Math.sign(coord) * offset) / Math.abs(coord),
          );
      }
      for (const [property, value] of [
        ["scale", baseScale],
        ["x", x],
        ["y", y],
      ] as const)
        command.push({
          tool: "sequence.keyframe",
          sequenceId: id,
          clipId,
          property,
          frame: cursor,
          value,
          easing: "linear",
        });
    }
    if (camera && camera.confidence > 0.3 && duration >= 8) {
      if (Math.abs(camera.expansion) > 0.025) {
        const zoom = 1 + Math.min(0.14, Math.abs(camera.expansion));
        for (const [local, value] of [
          [0, camera.expansion > 0 ? 1 : zoom],
          [duration - 1, camera.expansion > 0 ? zoom : 1],
        ])
          command.push({
            tool: "sequence.keyframe",
            sequenceId: id,
            clipId,
            property: "scale",
            frame: cursor + local,
            value: Math.max(baseScale, Math.min(safeScale, baseScale * value)),
            easing: "ease-in-out",
          });
      }
      if (camera.vignette > 0.12 && !keepColor && controls.color > 0)
        effect(
          clipId,
          "vignette",
          Math.min(0.2, camera.vignette * 0.4) * controls.color,
        );
      if (camera.motionDip !== null && !captions && duration >= 12) {
        const peak = clamp(
          Math.round(camera.motionDip * duration),
          2,
          duration - 2,
        );
        const shoulder = Math.max(2, Math.round(rate * 0.36));
        const speeds = new Map([
          [0, 1],
          [Math.max(0, peak - shoulder), 1],
          [peak, 0.65],
          [Math.min(duration, peak + shoulder), 1],
          [duration, 1],
        ]);
        const curve = {
          sourceOffset: 0,
          keys: [...speeds.entries()].map(([frame, speed]) => ({
            frame,
            speed,
            easing: "smooth" as const,
          })),
        };
        const area = sourceFrameAt({ sourceIn: 0, timeRemap: curve }, duration);
        for (const k of curve.keys) k.speed *= duration / area;
        command.push({ tool: "sequence.speed", sequenceId: id, clipId, curve });
      }
    }
    const transcript =
      s.source.speech?.transcript ??
      p.transcripts.find(
        (t) =>
          t.assetId === asset.id && t.sourceFingerprint === asset.fingerprint,
      );
    if (
      captions &&
      !voice &&
      transcript &&
      transcript.segments.some(
        (t) =>
          t.startMs < ((sourceIn + duration) * 1000) / rate &&
          t.endMs > (sourceIn * 1000) / rate,
      )
    )
      addCaptions(clipId, transcript);
    matches.push({
      source: asset.id,
      clipId,
      sourceIn,
      start: cursor,
      duration,
      referenceMs: ref.startMs,
      referenceEndMs: ref.endMs,
    });
    cursor += duration;
    consumeRange(pool, s, sourceIn, duration);
  }
  if (!cursor) throw Error("The selected footage has no usable video ranges");
  const transitionTrack = uid();
  for (let i = 1; i < matches.length; i++) {
    const left = matches[i - 1],
      right = matches[i];
    const measured = dna.transitions.find(
      (t) => Math.abs(t.cutMs - right.referenceMs) < 1,
    );
    if (!measured || measured.kind === "cut") continue;
    if (
      !["flash", "blur", "zoom", "whip", "motion"].includes(measured.kind) ||
      measured.confidence < 0.65
    ) {
      warnings.push(
        "Shot " +
          (i + 1) +
          ": " +
          measured.kind +
          " evidence is uncertain or unsupported; retained a cut.",
      );
      continue;
    }
    const before = Math.min(
      left.duration,
      120,
      Math.max(
        1,
        Math.round(
          ((measured.cutMs - measured.startMs) * left.duration) /
            (left.referenceEndMs - left.referenceMs),
        ),
      ),
    );
    const after = Math.min(
      right.duration,
      120,
      Math.max(
        2,
        Math.round(
          ((measured.endMs - measured.cutMs) * right.duration) /
            (right.referenceEndMs - right.referenceMs),
        ),
      ),
    );
    if (after < 2 || command.length >= 500) continue;
    command.push({
      tool: "sequence.transition",
      sequenceId: id,
      id: uid(),
      trackId: transitionTrack,
      leftId: left.clipId,
      rightId: right.clipId,
      kind: measured.kind as "flash" | "blur" | "zoom" | "whip" | "motion",
      ...(measured.direction ? { direction: measured.direction } : {}),
      ...(measured.zoomDirection
        ? { zoomDirection: measured.zoomDirection }
        : {}),
      protection: protection.filter(
        (r) => r.clipId === left.clipId || r.clipId === right.clipId,
      ),
      before,
      after,
      strength: clamp(measured.strength, 0.05, 1),
    });
  }
  const pulseTrack = uid();
  for (const pulse of dna.colorPulses ?? []) {
    if (keepColor || controls.color <= 0) break;
    const shot = matches.find(
      (m) => pulse.startMs >= m.referenceMs && pulse.endMs <= m.referenceEndMs,
    );
    if (!shot) continue;
    if (!pulse.palette || command.length >= 500) {
      warnings.push(
        "A measured color pulse was omitted because palette evidence or edit capacity was unavailable.",
      );
      continue;
    }
    const at = (ms: number) =>
      shot.start +
      Math.round(
        ((ms - shot.referenceMs) * shot.duration) /
          (shot.referenceEndMs - shot.referenceMs),
      );
    const start = Math.min(shot.start + shot.duration - 1, at(pulse.startMs));
    command.push({
      tool: "sequence.colorPulse",
      sequenceId: id,
      id: uid(),
      sourceId: shot.clipId,
      trackId: pulseTrack,
      start,
      duration: Math.max(1, at(pulse.endMs) - start),
      ...pulse.palette,
    });
  }
  for (const asset of [music, voice]) {
    if (!asset) continue;
    const trackId = asset === voice && music ? uid() : audio;
    if (trackId !== audio)
      command.push({
        tool: "sequence.audioTrack",
        sequenceId: id,
        trackId,
        name: "Voiceover",
      });
    const duration = Math.min(cursor, Math.floor(asset.duration * rate));
    if (!duration) continue;
    const clipId = uid();
    command.push({
      tool: "sequence.insert",
      sequenceId: id,
      clipId,
      trackId,
      assetId: asset.id,
      fingerprint: asset.fingerprint,
      startFrame: 0,
      sourceIn: 0,
      duration,
      gain: asset === music ? (voice ? -20 : -12) : 0,
    });
    const transcript =
      (asset === voice ? voiceTranscript : undefined) ??
      p.transcripts.find(
        (t) =>
          t.assetId === asset.id && t.sourceFingerprint === asset.fingerprint,
      );
    if (asset === voice && captions && transcript)
      addCaptions(clipId, transcript);
  }
  if (dna.shots.some((s) => s.camera?.motionDip != null))
    warnings.push(
      "Motion accents follow isolated repeated-frame holds between moving images. Original speed curves are estimated.",
    );
  const brief = parseEditBrief(
    controls.instructions.trim() || "Create a reference edit",
  );
  const scale = Math.min(1, 1920 / Math.max(dna.width, dna.height)),
    dim = (n: number) => Math.max(64, 2 * Math.round((n * scale) / 2));
  const baseName = "Recreation · " + controls.mode;
  let name = baseName;
  for (let take = 2; p.compositions.some((c) => c.name === name); take++)
    name = baseName + " (" + take + ")";
  command.unshift({
    tool: "sequence.create",
    id,
    name,
    settings: { ...p.settings, width: dim(dna.width), height: dim(dna.height) },
    duration: cursor,
    videoTrackId: video,
    audioTrackId: audio,
    ai: {
      brief,
      plannerVersion: "reference-edit-1",
      createdAt: new Date().toISOString(),
      warnings,
      evidence: sources.map((s) => ({
        assetId: s.asset.id,
        fingerprint: s.asset.fingerprint,
        cacheKey: s.analysis.cacheKey,
      })),
    },
  });
  const plan = {
    id: uid(),
    projectId: p.id,
    compositionId: null,
    resultCompositionId: id,
    revision,
    processing: "LOCAL",
    summary: controls.mode + " · " + matches.length + " matched source ranges",
    commands: command,
  };
  let preview = previewEditPlan(plan, p, revision);
  const initialSequence = compositionView(preview.project, id);
  for (const c of command) {
    if (
      c.tool !== "sequence.transition" ||
      !["zoom", "whip", "motion"].includes(c.kind)
    )
      continue;
    if (!initialSequence.clips.some((l) => l.id === c.id + "-left")) {
      warnings.push(
        c.kind +
          " transition used editable blur to preserve source coverage and protected subjects.",
      );
    }
  }
  const layout = compositionView(preview.project, id);
  const copy = Array.from(
    controls.instructions.matchAll(/["“]([^"”]{1,120})["”]/g),
    (m) => m[1].trim(),
  ).filter(Boolean);
  const seen = new Set<string>();
  let omitted = 0;
  const graphics = uid();
  const overlays =
    dna.text?.filter((t) => t.role === "persistent-overlay").length ?? 0;
  if (overlays && controls.wording !== "omit")
    warnings.push(
      `${overlays} recurring edge-label intervals were excluded from caption recreation. Review recognized words before applying.`,
    );
  if (controls.wording === "original" && !dna.text?.some((t) => t.content))
    warnings.push("No readable reference words were recognized.");
  for (const appearance of controls.wording === "omit"
    ? []
    : (dna.text ?? [])) {
    if (appearance.role === "persistent-overlay") continue;
    if (command.length >= 508) break;
    const match = matches.find(
      (m) =>
        appearance.startMs >= m.referenceMs &&
        appearance.startMs < m.referenceEndMs,
    );
    if (!match) continue;
    const relative = (ms: number) =>
      match.start +
      Math.round(
        ((ms - match.referenceMs) * match.duration) /
          (match.referenceEndMs - match.referenceMs),
      );
    const start = relative(appearance.startMs);
    const end = Math.min(
      match.start + match.duration,
      Math.max(start + 4, relative(appearance.endMs)),
    );
    if (end - start < 4) continue;
    const source = sources.find((s) => s.asset.id === match.source)!;
    const sourceClip = layout.clips.find((c) => c.id === match.clipId)!;
    const sourceTime =
      (sourceFrameAt(sourceClip, start - match.start) * 1000) / rate;
    const sample = source.analysis.vision?.frames
      .filter((f) => sourceTime >= f.sceneStartMs && sourceTime < f.sceneEndMs)
      .sort(
        (a, b) =>
          Math.abs(a.timeMs - sourceTime) - Math.abs(b.timeMs - sourceTime),
      )[0];
    const strongest = sample?.labels[0];
    const label =
      strongest &&
      strongest.similarity >= 0.22 &&
      strongest.relativeConfidence >= 0.45 &&
      strongest.similarity - (sample?.labels[1]?.similarity ?? 0) >= 0.015
        ? strongest
        : undefined;
    const transcript =
      source.speech?.transcript ??
      p.transcripts.find(
        (t) =>
          t.assetId === source.asset.id &&
          t.sourceFingerprint === source.asset.fingerprint,
      );
    const spoken = transcript?.segments.find(
      (t) => t.startMs <= sourceTime && sourceTime < t.endMs,
    );
    const words = spoken?.words
      ?.filter((w) => w.endMs > sourceTime)
      .slice(0, appearance.words)
      .map((w) => w.text)
      .join(" ");
    const sourceCopy =
      words ||
      (spoken && !spoken.words?.length
        ? spoken.text.trim().split(/\s+/).slice(0, appearance.words).join(" ")
        : undefined);
    const content =
      controls.wording === "original"
        ? appearance.content
        : (copy.shift() ??
          sourceCopy ??
          (label && label.relativeConfidence >= 0.45 && !seen.has(label.label)
            ? label.label.toUpperCase()
            : undefined));
    if (!content) {
      omitted++;
      continue;
    }
    if (label) seen.add(label.label);
    const band = placement(
      layout,
      start,
      end,
      sources.map((s) => s.analysis),
      appearance.y + appearance.height / 2,
      appearance,
    );
    command.push({
      tool: "sequence.text",
      sequenceId: id,
      id: uid(),
      trackId: graphics,
      content,
      start,
      duration: end - start,
      style: appearance.height > 0.024 ? "Bold" : "Minimal",
      treatment:
        appearance.revealOffsetMs != null
          ? "Word Build"
          : Math.abs(appearance.verticalChange ?? 0) > 0.025
            ? "Slide"
            : Math.abs(appearance.widthChange ?? 0) > 0.025
              ? "Scale In"
              : end - start < rate * 0.65
                ? "Pop"
                : "Fade",
      ...(appearance.foreground
        ? {
            ink: {
              foreground: appearance.foreground,
              accent: appearance.accent ?? null,
              word: Math.round(
                ((appearance.accentWord ?? appearance.words - 1) /
                  Math.max(1, appearance.words - 1)) *
                  (content.trim().split(/\s+/).length - 1),
              ),
            },
          }
        : {}),
      ...(appearance.revealOffsetMs != null &&
      content.trim().split(/\s+/).length > 1
        ? {
            wordStarts: content
              .trim()
              .split(/\s+/)
              .map((_, i, a) =>
                Math.round(
                  (i *
                    Math.max(
                      a.length - 1,
                      Math.min(
                        end - start - 1,
                        (appearance.revealOffsetMs! * rate) / 1000,
                      ),
                    )) /
                    (a.length - 1),
                ),
              ),
          }
        : {}),
      timing: "manual",
      maxFontSize: clamp(
        (appearance.height * layout.settings.height) / 0.78,
        6,
        1000,
      ),
      y: band.y,
      layout: { x: band.x, width: band.width },
    });
  }
  if (omitted)
    warnings.push(
      omitted +
        " detected text intervals had no original copy. Supply quoted titles to fill them.",
    );
  if (command.length !== preview.plan.commands.length || warnings.length)
    preview = previewEditPlan(plan, p, revision);
  return { matches, warnings, preview };
}
