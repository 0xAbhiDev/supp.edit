import { classifySourceText, type SourceTextWindow } from "./source-text";
import { measuredColor, type VisualFrame } from "./visual";
import type { Aperture } from "./aperture";
import { medianTone, spanTone, type ToneSample } from "./tone";
import { matchingCurve } from "../../effects/curves";
import type { AudioTimeline } from "../audio/timeline";
import type { SoundKind } from "../audio/synth";
import { beatMapOf, placeSound, plannedSounds, retimeDna, retimer } from "./audio-structure";
import { alignStructure, type StructuralAlignment } from "./structural-alignment";
import { buildFootageIndex, dissolveLeadIn, infeasibleShots, motionPeak, selectShots, shotRole, type PlanReport, type SelectionProfile, type ShotChoice, type ShotRequirement } from "./footage-index";
import { editablePersonMask, type PersonSample } from "./subject-mask";
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
import { projectInk, visiblePicture } from "./text-layout";
import { type StyleDNA, type RecreationMode } from "./dna";
import { matchIdentity } from "./identity";
export interface SourceEvidence {
  asset: Asset;
  analysis: MediaAnalysis;
  color?: ColorStats;
  speech?: MediaAnalysis;
  visual?: VisualFrame[];
  /** Person outlines confirmed by the object detector (person-evidence.ts): the matcher's subject
   * evidence. */
  people?: PersonSample[];
  /** The segmentation's own outlines, unconfirmed: subject layering masks and frame-cut evidence. */
  outlines?: PersonSample[];
  /** Body pose samples (body-pose.ts), where measured. */
  pose?: import("./body-pose").PoseSample[];
  aperture?: Aperture;
  tone?: ToneSample[];
  /** This clip's cached long-footage index (keyed by file identity and analysis versions). */
  index?: import("./footage-index").SourceIndex;
  /** Text read in candidate windows of this clip (burned-in labels and captions). */
  text?: SourceTextWindow[];
  /** Where the reference's probe frames were found in this clip (same-footage identity). */
  identity?: import("./identity").SourceIdentity;
}
export interface Controls {
  mode: RecreationMode;
  wording: "adapt" | "original" | "omit";
  pace: number;
  color: number;
  beat: number;
  instructions: string;
  reviewedTitleCues?:string;
  interval?: {startMs:number;endMs:number};
  format?: "vertical" | "reference";
  /** music: supplied music as today. reference: the reference's own soundtrack as an editable
   * clip. recreate: supplied music aligned to the reference's audio structure, with generated
   * effects for linked sounds it lacks. */
  audio?: "music" | "reference" | "recreate";
  subjectLayering?: "flat" | "behind-people" | "reference";
  /** Shots the raw footage has nothing for: fill them from the footage anyway (footage, the default)
   * or keep the reel's own shot there (keep: a meme-format reel whose other shots are the format). */
  reelShots?: "footage" | "keep";
}
// One click recreates the reference: its own words, its own framing, as closely as the footage allows.
export const defaults: Controls = {
  mode: "Close Match",
  wording: "original",
  pace: 1,
  color: 0.75,
  beat: 0.65,
  instructions: "",
  format: "reference",
  subjectLayering: "reference",
};

/** The longest reference whose titles are traced end to end without being asked (tracing costs
 * about 1.3 s per reference second). */
export const AUTO_TITLE_MAX_MS = 90_000;

/** What the user did not choose, chosen for a faithful recreation, so that a reference and raw
 * footage alone produce the full reconstruction:
 *  - titles are traced over the whole reference (up to 90 s) unless an interval was chosen;
 *  - with no music supplied, the edit plays the reference's own soundtrack (else the raw clips'
 *    sound would play). Each automatic choice is reported for review. */
/** A reference shot shows bars when most of its samples do (a single sample at a flash or a
 * transition does not make a letterboxed shot). */
export const barred = (camera?: { letterbox?: number } | null) => (camera?.letterbox ?? 0) >= 0.5;
/** Contiguous timeline spans of the recreated shots whose reference shots show bars. */
export function barredRuns(matches: readonly { referenceMs: number; start: number; duration: number }[], shots: readonly { startMs: number; camera?: { letterbox?: number } | null }[]) {
  const runs: { start: number; duration: number }[] = [];
  for (const m of matches) {
    if (!barred(shots.find((r) => r.startMs === m.referenceMs)?.camera)) continue;
    const last = runs.at(-1);
    if (last && last.start + last.duration === m.start) last.duration += m.duration;
    else runs.push({ start: m.start, duration: m.duration });
  }
  return runs;
}
/** The frame region covering every detection box, inside the frame. Detections at the frame's edge
 * reach past it (a person cut off at the right: x 0.6, width 0.5); their union was wider than the
 * frame and failed the plan's validation, so the whole recreation (a ship's crowded rail). */
export function unionBox(boxes: readonly { x: number; y: number; width: number; height: number }[]) {
  const inside = boxes
    .map((b) => {
      const x = Math.max(0, Math.min(1, b.x)),
        y = Math.max(0, Math.min(1, b.y));
      return { x, y, right: Math.max(x, Math.min(1, b.x + b.width)), bottom: Math.max(y, Math.min(1, b.y + b.height)) };
    })
    .filter((b) => b.right > b.x && b.bottom > b.y);
  if (!inside.length) return undefined;
  const x = Math.min(...inside.map((b) => b.x)),
    y = Math.min(...inside.map((b) => b.y));
  return { x, y, width: Math.max(...inside.map((b) => b.right)) - x, height: Math.max(...inside.map((b) => b.bottom)) - y };
}
/** Which reference shots keep the reel's own frames (controls.reelShots "keep"): every shot the
 * footage does not play. The footage plays its close matches, and each clip plays at least the one
 * shot it fits best, by certainty weighted by the shot's length (a clip of a flexed arm plays the
 * reel's flex shot, not the half-second cat on an arm beside it). Cards stay the reel's. */
export function reelShotsToKeep(
  choices: readonly ({ sourceId: string; label: string; certainty: number } | undefined)[],
  shots: readonly { startMs: number; endMs: number; card?: unknown }[],
) {
  const own = new Set<number>();
  choices.forEach((c, i) => {
    if (c?.label === "close match" && !shots[i]?.card) own.add(i);
  });
  const mean = shots.reduce((t, s) => t + (s.endMs - s.startMs), 0) / Math.max(1, shots.length);
  const best = new Map<string, { i: number; fit: number }>();
  choices.forEach((c, i) => {
    if (!c || shots[i]?.card) return;
    const fit = c.certainty * Math.sqrt((shots[i].endMs - shots[i].startMs) / Math.max(1, mean));
    const b = best.get(c.sourceId);
    if (!b || fit > b.fit) best.set(c.sourceId, { i, fit });
  });
  for (const b of best.values()) own.add(b.i);
  return new Set(shots.map((_, i) => i).filter((i) => !own.has(i)));
}
/** Runs of consecutive matches whose reference shots are cards of one colour (card.ts). */
export function cardRuns(matches: readonly { referenceMs: number; start: number; duration: number }[], shots: readonly { startMs: number; card?: { color: string } }[]) {
  const runs: { start: number; duration: number; color: string }[] = [];
  for (const m of matches) {
    const color = shots.find((r) => r.startMs === m.referenceMs)?.card?.color;
    if (!color) continue;
    const last = runs.at(-1);
    if (last && last.color === color && last.start + last.duration === m.start) last.duration += m.duration;
    else runs.push({ start: m.start, duration: m.duration, color });
  }
  return runs;
}
export function autonomousControls(controls: Controls, reference: { duration: number; hasAudio: boolean }, hasMusic: boolean) {
  const chosen: string[] = [];
  const next = { ...controls };
  const ms = Math.floor(reference.duration * 1000);
  if (!next.interval && next.mode !== "Creative Remix" && ms > 0 && ms <= AUTO_TITLE_MAX_MS) {
    next.interval = { startMs: 0, endMs: ms };
    chosen.push("titles reconstructed over the whole reference");
  }
  if (!next.audio) {
    next.audio = !hasMusic && reference.hasAudio ? "reference" : "music";
    if (next.audio === "reference") chosen.push("the reference soundtrack, since no music was supplied");
  }
  return { controls: next, chosen };
}
/** One take's tone curves: the reference shot's measured tone over the take's own measured tone. */
export type TakeCurves = { red: [number, number][]; green: [number, number][]; blue: [number, number][] };
export function takeCurves(tone: readonly ToneSample[] | undefined, inMs: number, outMs: number, target: NonNullable<StyleDNA["shots"][number]["tone"]>): TakeCurves | null {
  const from = medianTone((tone ?? []).filter((t) => t.timeMs >= inMs - 250 && t.timeMs <= outMs + 250).map((t) => t.tone));
  if (!from) return null;
  return {
    red: matchingCurve(from.map((q) => q[0]), target.map((q) => q[0])),
    green: matchingCurve(from.map((q) => q[1]), target.map((q) => q[1])),
    blue: matchingCurve(from.map((q) => q[2]), target.map((q) => q[2])),
  };
}
/** The free range a global pick plays from, and where it starts. The plan's stretches and the
 * pool's ranges round differently at both ends (a scene starting at 36 ms is frame 1 to one and
 * frame 2 to the other; a clip ending at 15.555 s ends at frame 466 in the pool while a pick
 * reaching its end rounds to 467), so a pick within two frames of a range keeps its moment,
 * shifted just inside the range, rather than falling to the local matcher. */
export function plannedRange<R extends { source: { asset: { id: string } }; first: number; end: number }>(pool: readonly R[], sourceId: string, first: number, frames: number) {
  let best: { range: R; first: number } | undefined;
  for (const r of pool) {
    if (r.source.asset.id !== sourceId || r.end - r.first < frames) continue;
    const start = Math.min(Math.max(first, r.first), r.end - frames);
    if (Math.abs(start - first) > 2) continue;
    if (!best || Math.abs(start - first) < Math.abs(best.first - first)) best = { range: r, first: start };
  }
  return best;
}
/** Source frames a placed shot plays: a shot slowed to fill its length (retimeSpeed < 1) plays
 * fewer source frames than timeline frames, and only those are used (after the speed curve is
 * normalised it plays exactly duration × retimeSpeed). */
export const sourceFramesPlayed = (duration: number, retimeSpeed: number) => Math.max(2, Math.ceil(duration * Math.min(1, retimeSpeed)));
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
  /** reference/music: measured timelines. soundtrack: the reference's audio extracted to its own
   * audio asset (the reference video itself never enters the timeline). sounds: generated effects. */
  audioPlan: { reference?: AudioTimeline; music?: AudioTimeline; soundtrack?: Asset; sounds?: Partial<Record<SoundKind, Asset>>; referenceAperture?: Aperture } = {},
) {
  const measuredDna = dna;
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
      preroll?: number;
      /** The matcher's scoring terms for the chosen range. */
      why?: Record<string, number>;
      /** Global long-footage selection: per-criterion match (0–1), alternatives and reuse. */
      selection?: "global" | "local";
      match?: Record<string, number>;
      /** Alternative takes, each with the tone curve fitted to its own footage (a swap keeps the look
       * consistent instead of carrying the replaced footage's curve). */
      alternatives?: (ShotChoice["alternatives"][number] & { curves?: TakeCurves | null })[];
      reuse?: ShotChoice["reuse"];
      role?: ShotChoice["role"];
      reasons?: string[];
      confidence?: ShotChoice["confidence"];
      label?: ShotChoice["label"];
      identity?: ShotChoice["identity"];
      certainty?: number;
      coverage?: ShotChoice["coverage"];
      shortfall?: string | null;
      speed?: number;
      peak?: { fraction: number; source: ShotRequirement["peakSource"] };
      /** The reel's own shot, kept because the footage has nothing like it (controls.reelShots). */
      reel?: true;
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
  const refScale = Math.min(1, 1920 / Math.max(dna.width, dna.height));
  const width =
    controls.format === "vertical"
      ? 1080
      : Math.max(64, 2 * Math.round((dna.width * refScale) / 2));
  const height =
    controls.format === "vertical"
      ? 1920
      : Math.max(64, 2 * Math.round((dna.height * refScale) / 2));
  const tintTrack=uid();
  // ---- Content aperture: where the reference shows picture. Bars it adds are reproduced as
  // editable black layers, and footage covers the content box rather than the whole frame.
  const ap = audioPlan.referenceAperture;
  const barsBox =
    controls.format !== "vertical" && ap && (ap.top + ap.bottom >= 0.04 || ap.left + ap.right >= 0.04)
      ? { w: width * (1 - ap.left - ap.right), h: height * (1 - ap.top - ap.bottom), cx: ((ap.left - ap.right) * width) / 2, cy: ((ap.top - ap.bottom) * height) / 2 }
      : undefined;
  // ---- Audio mode. Reference timing comes first in Close Match; recreate moves linked visual
  // events onto the replacement's corresponding events.
  const audioNotes: string[] = [];
  let audioMode = controls.audio ?? "music";
  if (audioMode === "reference" && (!reference.hasAudio || !audioPlan.soundtrack)) {
    audioNotes.push(reference.hasAudio ? "The reference soundtrack could not be extracted; supplied music is used instead." : "The reference has no audio stream; supplied music is used instead.");
    audioMode = "music";
  }
  if (audioMode === "recreate" && (!music || !audioPlan.music || !measuredDna.eventGraph)) {
    audioNotes.push("Recreating the audio structure needs supplied music and a measured reference soundtrack; supplied music is used as is.");
    audioMode = "music";
  }
  const intervalStart = measuredDna.shots[0]?.startMs ?? 0;
  let alignment: StructuralAlignment | undefined,
    retime = (t: number) => t;
  const audioMapping: NonNullable<NonNullable<Project["compositions"][number]["ai"]>["audioMapping"]> = [];
  if (audioMode === "recreate" && audioPlan.music && audioPlan.reference && measuredDna.eventGraph) {
    // Structural alignment: sections, beats and linked events of both soundtracks, then each
    // visual event placed by its measured relationship to its mapped trigger.
    const intervalEnd = measuredDna.shots.at(-1)?.endMs ?? intervalStart;
    alignment = alignStructure(measuredDna.eventGraph, audioPlan.reference, audioPlan.music, intervalStart, intervalEnd);
    if (controls.mode === "Close Match") {
      retime = retimer(alignment.moves.map((m) => ({ visualId: m.visualId, fromMs: m.fromMs, toMs: m.toMs, anchor: m.anchor ?? "", replacement: m.replacement ?? "", distanceMs: 0 })), 1, intervalStart);
      dna = retimeDna(measuredDna, retime);
    }
    const anchored = alignment.moves.filter((m) => m.status === "anchored"),
      unplaced = alignment.moves.filter((m) => m.status === "no-replacement");
    audioNotes.push(
      `Structural alignment (${alignment.method}): replacement music starts ${(alignment.offsetMs / 1000).toFixed(3)} s in; beat length ×${alignment.beatRatio}; ${alignment.events.filter((e) => e.status === "mapped").length}/${alignment.events.length} linked audio events mapped in order; ${anchored.length} visual events placed by their measured relationship, ${unplaced.length} without a suitable replacement event, ${alignment.moves.length - anchored.length - unplaced.length} free.`,
      `Sections: ${alignment.sections.map((x) => `${x.ref.label} → ${x.rep.label}`).join(", ") || "none measured"}${alignment.landmarks.length ? "; landmarks: " + alignment.landmarks.map((l) => `${l.kind} ${(l.refMs / 1000).toFixed(2)}→${(l.repMs / 1000).toFixed(2)} s`).join(", ") : ""}.`.slice(0, 400),
    );
    for (const m of unplaced.slice(0, 20)) audioNotes.push(`No suitable replacement event found for ${m.visualKind.replace("_", " ")} at ${(m.fromMs / 1000).toFixed(3)} s (${m.relation} ${m.anchor}); it follows the beat map.`);
    for (const m of alignment.moves.slice(0, 400))
      audioMapping.push({
        visual: m.visualKind,
        referenceMs: Math.round(m.fromMs),
        adaptedMs: Math.round(Math.max(0, m.toMs)),
        anchor: (m.anchor ?? "none").slice(0, 32),
        replacement: (m.replacement ?? "none").slice(0, 32),
        relation: m.relation,
        offsetMs: Math.max(-10000, Math.min(10000, m.offsetMs)),
        confidence: m.confidence,
        status: m.status,
        ...(m.reasons ? { reasons: m.reasons } : {}),
      });
  }
  // Smart Adaptation and Creative Remix regularise cuts onto beats of the audio actually used.
  if (audioMode === "reference" && audioPlan.reference) map = beatMapOf(audioPlan.reference);
  // Grade layers are placed after color pulses so their tracks sit directly above the footage
  // and below any pulse: a negative pulse then inverts the graded picture, as in the reference.
  const grade: EditorToolCall[] = [];
  const backgroundClips: string[] = [];
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
  const requestedFor = (index: number) => {
    const ref = referenceShots[index];
    return Math.max(2, Math.round(((((ref.endMs - ref.startMs) * rate) / 1000) / pace) * (remix ? (index % 2 ? 0.78 : 1.12) : 1)));
  };
  // ---- Long-footage selection: every raw clip indexed once over its whole length, then one
  // global choice per reference shot, trimmed so the source's action peak lands on the shot's
  // important moment (its strongest linked audio event).
  let clock = performance.now();
  const footage = buildFootageIndex(sources);
  const matchingProfile: SelectionProfile & { index: number } = { index: Math.round(performance.now() - clock), stageA: 0, stageB: 0, beam: 0, rerankedPerShot: 0 };
  // Frame-accurate cuts the scene pass missed bound the local matcher's ranges too (2 frames clear).
  for (const cut of footage.cuts) {
    const at = Math.round((cut.timeMs * rate) / 1000);
    const k = pool.findIndex((r) => r.source.asset.id === cut.sourceId && r.first + 2 < at && at < r.end - 2);
    if (k < 0) continue;
    const r = pool[k];
    const parts = [
      { ...r, end: at - 2, shot: { ...r.shot, endMs: Math.round(((at - 2) * 1000) / rate) } },
      { ...r, first: at + 2, shot: { ...r.shot, startMs: Math.round(((at + 2) * 1000) / rate) } },
    ].filter((x) => x.end - x.first >= 2);
    pool.splice(k, 1, ...parts);
  }
  const peakOf = (index: number): Pick<ShotRequirement, "peakFraction" | "peakSource"> => {
    const shot = measuredDna.shots.length === referenceShots.length ? measuredDna.shots[index] : referenceShots[index];
    const weight: Record<string, number> = { impact: 3, drop: 3, bass_hit: 2.5, downbeat: 1.6, kick: 1.5, snare: 1.2, beat: 1, onset: 0.8 };
    const anchor = (measuredDna.eventGraph?.anchors ?? [])
      .filter((a) => a.timeMs > shot.startMs + 40 && a.timeMs < shot.endMs - 40 && weight[a.kind])
      .sort((a, b) => weight[b.kind] * (0.5 + b.strength) - weight[a.kind] * (0.5 + a.strength))[0];
    // No audio event inside the shot: its own movement peak is the moment that matters.
    return anchor ? { peakFraction: (anchor.timeMs - shot.startMs) / Math.max(1, shot.endMs - shot.startMs), peakSource: "audio event" } : (motionPeak(shot) ?? { peakFraction: 0.4, peakSource: "none" });
  };
  const requirements: ShotRequirement[] = referenceShots.map((shot, index) => {
    const peak = peakOf(index);
    // The reference titles on screen during this shot (for source-text equivalence and penalties).
    const texts = (dna.text ?? []).filter((t) => t.content && t.role !== "persistent-overlay" && t.startMs < shot.endMs && t.endMs > shot.startMs).map((t) => ({ content: t.content!, x: t.x, y: t.y, width: t.width, height: t.height }));
    // The same footage as the reference, found frame by frame in a raw clip (grade, crop and zoom
    // aside): that exact moment plays the shot.
    const identity = matchIdentity(index, shot.startMs, shot.endMs, sources.map((s) => ({ id: s.asset.id, durationMs: s.asset.duration * 1000, identity: s.identity })));
    const leadInMs = dissolveLeadIn(dna.transitions, shot);
    return { shot, durationMs: (requestedFor(index) * 1000) / rate, ...peak, role: shotRole(shot, index, referenceShots.length, peak.peakSource, referenceShots[index + 1]), ...(texts.length ? { texts } : {}), ...(identity ? { identity } : {}), ...(leadInMs ? { leadInMs } : {}) };
  });
  // Caption-led edits keep each source's chronology; the local matcher handles that order.
  clock = performance.now();
  // The cut-safe ranges before any shot consumes them (intentional reuse looks here).
  const cutSafePool = pool.map((r) => ({ ...r }));
  let planReport: PlanReport | undefined;
  const choices = captions ? [] : selectShots(footage, sources, requirements, controls.mode, 40, 16, matchingProfile, undefined, (r) => (planReport = r));
  // Meme-format reels: the shots the footage has nothing for keep the reel's own frames.
  const keepReel = controls.reelShots === "keep" && reference.kind === "video" ? reelShotsToKeep(choices, referenceShots) : new Set<number>();
  if (keepReel.size)
    warnings.push(`Shot${keepReel.size === 1 ? "" : "s"} ${[...keepReel].map((i) => i + 1).join(", ")} keep${keepReel.size === 1 ? "s" : ""} the reel's own frames (your footage has nothing like ${keepReel.size === 1 ? "it" : "them"}). Anything burned into the reel there, such as another creator's handle, plays too.`);
  if (planReport) {
    const c = planReport.coverage;
    warnings.push(`Reference coverage: excellent ${c.excellent}, good ${c.good}, weak ${c.weak}, missing ${c.missing}.`);
    for (const g of planReport.groups)
      warnings.push(`Shots ${g.shots.map((x) => x + 1).join(", ")} repeat one action (similarity ${g.similarity.toFixed(2)}); the footage holds ${g.stretches} strong stretch${g.stretches === 1 ? "" : "es"} of it; the plan ${g.outcome ?? g.decision}.`);
    for (const t of planReport.nearTies) warnings.push(`Shot ${t.shot + 1}: near tie (${t.margin.toFixed(3)}) reviewed by deeper temporal matching${t.changed ? "; the pick changed" : ""}.`);
  }
  for (const x of captions ? [] : infeasibleShots(footage, requirements))
    warnings.push(`No source interval can faithfully fill reference shot ${x.shot + 1}: it needs ${(x.needMs / 1000).toFixed(1)} s and the longest usable cut-safe stretch is ${(x.longestMs / 1000).toFixed(1)} s; it uses the closest shorter moment and is flagged low-confidence.`);
  choices.forEach((c, i) => {
    if (c.shortfall) warnings.push(`Shot ${i + 1} (${c.role}): ${c.shortfall}`);
  });
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
    const pick = choices[index];
    if (keepReel.has(index)) {
      // The reel's own shot, as it plays in the reel: its frames, timing, grade and text. Its sound is
      // left to the soundtrack (the reference audio), so the clip itself is muted.
      const clipId = uid(),
        duration = Math.min(requested, Math.floor(300 * rate) - cursor),
        sourceIn = Math.round((ref.startMs * rate) / 1000);
      if (duration < 1) break;
      command.push({ tool: "sequence.insert", sequenceId: id, clipId, assetId: reference.id, fingerprint: reference.fingerprint, trackId: video, startFrame: cursor, sourceIn, duration, gain: -60 });
      matches.push({
        source: reference.id,
        clipId,
        sourceIn,
        start: cursor,
        duration,
        referenceMs: ref.startMs,
        referenceEndMs: ref.endMs,
        preroll: 0,
        reel: true,
        reasons: ["The reel's own shot: your footage has nothing like it, so this shot plays as it does in the reel (switch \"Shots your footage lacks\" to fill it from your footage)."],
      });
      cursor += duration;
      continue;
    }
    const fromChoice = (() => {
      if (!pick) return undefined;
      const first = Math.round((pick.inMs * rate) / 1000),
        used = Math.round(((pick.outMs - pick.inMs) * rate) / 1000),
        // A mildly retimed pick fills the whole requested length from a shorter stretch.
        length = pick.speed < 1 ? requested : Math.min(requested, used);
      // Intentional reuse plays frames another shot already used: look them up before consumption.
      const placed = plannedRange(pool, pick.sourceId, first, Math.min(used, length)) ?? (pick.reuse ? plannedRange(cutSafePool, pick.sourceId, first, Math.min(used, length)) : undefined);
      if (!placed)
        console.debug(
          "planned pick not placed",
          index + 1,
          JSON.stringify({ source: sources.find((x) => x.asset.id === pick.sourceId)?.asset.name, first, frames: Math.min(used, length), speed: pick.speed, reuse: !!pick.reuse, free: pool.filter((r) => r.source.asset.id === pick.sourceId).map((r) => [r.first, r.end]) }),
        );
      return placed && length >= 2 ? { range: placed.range, first: placed.first, length, score: pick.score, timingCoverage: 0, motion: placed.range.shot.motion, terms: pick.match } : undefined;
    })();
    const candidate = fromChoice ?? matchRange(
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
      gain: voice || audioMode === "reference" ? -60 : music ? -20 : 0,
    });
    // Tone of the raw range actually used, from samples two per second.
    const rangeTone = medianTone(
      (s.source.tone ?? [])
        .filter(
          (t) =>
            t.timeMs >= (sourceIn * 1000) / rate - 250 &&
            t.timeMs <= ((sourceIn + duration) * 1000) / rate + 250,
        )
        .map((t) => t.tone),
    );
    // Measured tone on both sides: map each channel's five percentiles of the raw range onto
    // the reference shot's with one editable tone curve. Close Match at the default color
    // strength applies the whole measured mapping.
    // The curve itself is built once framing has decided which part of the raw frame is shown;
    // its place as the clip's first effect is kept here.
    // Close Match and Smart Adaptation keep the reference's measured look; Creative Remix does not.
    const curves = !remix && !keepColor && controls.color > 0 && ref.tone && rangeTone ? ref.tone : undefined;
    const curveSlot = command.length;
    if (curves) {
      /* inserted after framing */
    } else if (close && controls.interval && !keepColor && controls.color>0 && ref.plateTint)grade.push({tool:"sequence.plateTint",sequenceId:id,id:uid(),trackId:tintTrack,sourceId:clipId,color:ref.plateTint,strength:clamp(controls.color,0,1)});
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
      // A measured tone curve already sets brightness, contrast and channel balance.
      if (!curves) {
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
      }
      const saturation = referenceGain(
        sourceColor?.saturation ?? from.meanSaturation,
        to.saturation,
        k,
        0.12,
        1.6,
      );
      // The tone curve moves each channel toward the reference; boosting the raw colors as well
      // would count that chroma twice.
      effect(clipId, "saturation", curves ? Math.min(1, saturation) : saturation);
      const sourceTemperature =
        sourceColor?.temperature ?? from.neutralTemperature;
      // The tone curve already carries the measured channel balance.
      if (!curves && to.temperature !== null && sourceTemperature !== null)
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
    // A pick from a stretch up to 15% short of the shot plays mildly slowed (never across a cut).
    const retimeSpeed = fromChoice && pick && pick.speed < 1 ? pick.speed : 1;
    let speedCurve = false;
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
    const box = unionBox(boxes);
    if (box) protection.push({ clipId, bounds: box });
    let baseScale = 1;
    let safeScale = 10;
    // Same footage: the region of the source frame the reference's picture shows was measured, so
    // the shot is framed exactly as the reference framed it (its crop and zoom), not inferred.
    const seen = fromChoice && pick?.identity && controls.format !== "vertical" && !barred(camera) ? pick.identity.rect : null;
    if (seen) {
      const fit = Math.min(width / asset.width, height / asset.height),
        sw = asset.width * fit,
        sh = asset.height * fit;
      const [rx, ry, rw, rh] = seen;
      baseScale = clamp(Math.max(width / (Math.max(0.05, rw) * sw), height / (Math.max(0.05, rh) * sh)), 1, 10);
      const x = clamp((0.5 - (rx + rw / 2)) * sw * baseScale, Math.min(0, width / 2 - 0.5 * sw * baseScale), Math.max(0, -width / 2 + 0.5 * sw * baseScale));
      const y = clamp((0.5 - (ry + rh / 2)) * sh * baseScale, Math.min(0, height / 2 - 0.5 * sh * baseScale), Math.max(0, -height / 2 + 0.5 * sh * baseScale));
      for (const [property, value] of [
        ["scale", baseScale],
        ["x", x],
        ["y", y],
      ] as const)
        if (property === "scale" || Math.abs(value) >= 0.5) command.push({ tool: "sequence.keyframe", sequenceId: id, clipId, property, frame: cursor, value, easing: "linear" });
    }
    if (
      !seen &&
      !box &&
      controls.format !== "vertical" &&
      !barred(camera)
    ) {
      // A reference that fills its frame is matched without bars, whatever the footage's shape.
      // With no detected subject the crop follows where the footage moves (the local motion
      // centre measured on its dense frames), not a blind centre crop; bars baked into the
      // footage are not picture, so the measured content is what covers the frame.
      const fit = Math.min(width / asset.width, height / asset.height),
        sw = asset.width * fit,
        sh = asset.height * fit;
      const content = s.source.aperture;
      const contentW = 1 - (content?.left ?? 0) - (content?.right ?? 0),
        contentH = 1 - (content?.top ?? 0) - (content?.bottom ?? 0);
      baseScale = clamp(Math.max(width / (sw * Math.max(0.2, contentW)), height / (sh * Math.max(0.2, contentH))), 1, 10);
      command.push({ tool: "sequence.keyframe", sequenceId: id, clipId, property: "scale", frame: cursor, value: baseScale, easing: "linear" });
      const fromMs = (sourceIn * 1000) / rate,
        toMs = ((sourceIn + duration) * 1000) / rate;
      const centres = (s.source.visual ?? []).filter((f) => f.timeMs >= fromMs && f.timeMs <= toMs && f.local && f.local.area >= 0.002).map((f) => [f.local!.cx, f.local!.cy] as const);
      const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
      const cx = centres.length >= 5 ? mid(centres.map((c) => c[0])) : 0.5,
        cy = centres.length >= 5 ? mid(centres.map((c) => c[1])) : 0.5;
      const edges = { left: content?.left ?? 0, right: content?.right ?? 0, top: content?.top ?? 0, bottom: content?.bottom ?? 0 };
      const x = clamp((0.5 - cx) * baseScale * sw, Math.min(0, width / 2 - (0.5 - edges.right) * sw * baseScale), Math.max(0, -width / 2 - (edges.left - 0.5) * sw * baseScale));
      const y = clamp((0.5 - cy) * baseScale * sh, Math.min(0, height / 2 - (0.5 - edges.bottom) * sh * baseScale), Math.max(0, -height / 2 - (edges.top - 0.5) * sh * baseScale));
      if (Math.abs(x) >= 0.5) command.push({ tool: "sequence.keyframe", sequenceId: id, clipId, property: "x", frame: cursor, value: x, easing: "linear" });
      if (Math.abs(y) >= 0.5) command.push({ tool: "sequence.keyframe", sequenceId: id, clipId, property: "y", frame: cursor, value: y, easing: "linear" });
    }
    if (box && !seen) {
      const fit = Math.min(width / asset.width, height / asset.height),
        sw = asset.width * fit,
        sh = asset.height * fit;
      const cover = Math.max(width / sw, height / sh);
      // A reference that fills its frame is matched without bars: cover the frame and keep the
      // subject as centered as the footage allows.
      // In every mode: bars never belong in a frame the reference fills.
      const fill =
        controls.format !== "vertical" &&
        !barred(camera);
      // Bars baked into the raw footage are not picture: cover the frame with the measured content.
      const content = fill ? s.source.aperture : undefined;
      const contentW = 1 - (content?.left ?? 0) - (content?.right ?? 0),
        contentH = 1 - (content?.top ?? 0) - (content?.bottom ?? 0);
      baseScale = clamp(
        fill
          ? Math.max(width / (sw * Math.max(0.2, contentW)), height / (sh * Math.max(0.2, contentH)))
          : Math.min(
              cover,
              (width * 0.86) / (box.width * sw),
              (height * 0.8) / (box.height * sh),
            ),
        1,
        10,
      );
      if (
        fill &&
        (box.width * sw * baseScale > width + 1 ||
          box.height * sh * baseScale > height + 1)
      )
        warnings.push(
          "Shot " +
            (index + 1) +
            " fills the reference frame; the outer edge of the detected subject area is cropped.",
        );
      // Keep the shown area inside the source, or inside its measured content when bars are baked in.
      const edges = {
        left: content?.left ?? 0,
        right: content?.right ?? 0,
        top: content?.top ?? 0,
        bottom: content?.bottom ?? 0,
      };
      const x = clamp(
        (0.5 - box.x - box.width / 2) * baseScale * sw,
        Math.min(0, width / 2 - (0.5 - edges.right) * sw * baseScale),
        Math.max(0, -width / 2 - (edges.left - 0.5) * sw * baseScale),
      );
      const y = clamp(
        (0.5 - box.y - box.height / 2) * baseScale * sh,
        Math.min(0, height / 2 - (0.5 - edges.bottom) * sh * baseScale),
        Math.max(0, -height / 2 - (edges.top - 0.5) * sh * baseScale),
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
    // A person detector does not bound held equipment (barbells, bicycles, products).
    // Preserve the whole wide source in portrait delivery; use fill rather than an unproven crop.
    if (
      controls.format === "vertical" &&
      asset.width / asset.height > (width / height) * 1.5
    ) {
      baseScale = 1;
      safeScale = 1;
      for (const c of command)
        if (
          c.tool === "sequence.keyframe" &&
          c.clipId === clipId &&
          c.frame === cursor
        ) {
          if (c.property === "scale") c.value = 1;
          if (c.property === "x" || c.property === "y") c.value = 0;
        }
    }
    if (barsBox && barred(camera)) {
      const f0 = Math.min(width / asset.width, height / asset.height),
        sw = asset.width * f0,
        sh = asset.height * f0,
        s0 = clamp(Math.max(barsBox.w / sw, barsBox.h / sh, 1), 1, 10);
      // Keep the subject (if measured) centred, but never uncover the content box.
      const xr = Math.max(0, (s0 * sw - barsBox.w) / 2),
        yr = Math.max(0, (s0 * sh - barsBox.h) / 2),
        want = box ? { x: (0.5 - box.x - box.width / 2) * s0 * sw, y: (0.5 - box.y - box.height / 2) * s0 * sh } : { x: 0, y: 0 };
      const values = { scale: s0, x: barsBox.cx + clamp(want.x, -xr, xr), y: barsBox.cy + clamp(want.y, -yr, yr) };
      for (const property of ["scale", "x", "y"] as const) {
        const key = command.find((c) => c.tool === "sequence.keyframe" && c.clipId === clipId && c.frame === cursor && c.property === property);
        if (key && key.tool === "sequence.keyframe") key.value = values[property];
        else command.push({ tool: "sequence.keyframe", sequenceId: id, clipId, property, frame: cursor, value: values[property], easing: "linear" });
      }
      baseScale = s0;
      safeScale = Math.max(1, Math.min(safeScale, s0 * 1.15));
    }
    const fit = Math.min(width / asset.width, height / asset.height);
    if (curves && rangeTone) {
      // Horizontal span of the raw frame that the composition shows after scale and offset.
      const shownX =
        [...command].reverse().find(
          (c) => c.tool === "sequence.keyframe" && c.clipId === clipId && c.property === "x" && c.frame === cursor,
        ) as { value: number } | undefined;
      const sw = asset.width * fit * baseScale,
        half = Math.min(0.5, width / 2 / sw),
        center = 0.5 - (shownX?.value ?? 0) / sw;
      const shown = spanTone(
        (s.source.tone ?? []).filter(
          (t) => t.timeMs >= (sourceIn * 1000) / rate - 250 && t.timeMs <= ((sourceIn + duration) * 1000) / rate + 250,
        ),
        Math.max(0, center - half),
        Math.min(1, center + half),
      );
      const from = shown ?? rangeTone;
      command.splice(curveSlot, 0, {
        tool: "sequence.effect",
        sequenceId: id,
        clipId,
        effectId: uid(),
        type: "curves",
        value: clamp(controls.color / defaults.color, 0, 1),
        parameters: {
          red: matchingCurve(from.map((q) => q[0]), curves.map((q) => q[0])),
          green: matchingCurve(from.map((q) => q[1]), curves.map((q) => q[1])),
          blue: matchingCurve(from.map((q) => q[2]), curves.map((q) => q[2])),
        },
      });
    }
    const aperture = s.source.aperture;
    if (
      controls.format === "vertical" &&
      aperture &&
      Object.values(aperture).some((n) => n > 0)
    ) {
      for (const [property, value] of [
        ["cropLeft", 0.5 + ((aperture.left - 0.5) * asset.width * fit) / width],
        [
          "cropRight",
          0.5 + ((aperture.right - 0.5) * asset.width * fit) / width,
        ],
        ["cropTop", 0.5 + ((aperture.top - 0.5) * asset.height * fit) / height],
        [
          "cropBottom",
          0.5 + ((aperture.bottom - 0.5) * asset.height * fit) / height,
        ],
      ] as const)
        command.push({
          tool: "sequence.keyframe",
          sequenceId: id,
          clipId,
          property,
          frame: cursor,
          value: Math.max(0, value),
          easing: "linear",
        });
    }
    if (
      controls.format === "vertical" &&
      (baseScale * asset.width * fit < width - 0.1 ||
        baseScale * asset.height * fit < height - 0.1)
    )
      backgroundClips.push(clipId);
    if (camera && camera.confidence > 0.3 && duration >= 8) {
      // A same-footage shot already shows the reference's measured framing; the footage carries
      // its own zoom, so none is added on top.
      if (!seen && Math.abs(camera.expansion) > 0.025) {
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
        for (const k of curve.keys) k.speed *= (duration / area) * retimeSpeed;
        command.push({ tool: "sequence.speed", sequenceId: id, clipId, curve });
        speedCurve = true;
      }
    }
    if (retimeSpeed < 1 && !speedCurve)
      command.push({
        tool: "sequence.speed",
        sequenceId: id,
        clipId,
        curve: { sourceOffset: 0, keys: [{ frame: 0, speed: retimeSpeed, easing: "smooth" as const }, { frame: duration, speed: retimeSpeed, easing: "smooth" as const }] },
      });
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
      why: candidate.terms,
      selection: fromChoice ? "global" : "local",
      // Source frames available before the in-point inside the same cut-safe stretch (for a dissolve).
      preroll: Math.max(0, Math.min(sourceIn - s.first, (() => {
        const at = (sourceIn * 1000) / rate;
        const seg = footage.segments.find((g) => g.sourceId === asset.id && g.startMs <= at && at < g.endMs);
        return seg ? Math.floor(((at - seg.startMs) * rate) / 1000) : 0;
      })())),
      // A shot the global plan could not place (its moment was no longer free) is chosen by the
      // local matcher, which has none of the plan's checks: say so instead of showing no verdict.
      ...(!fromChoice && !captions
        ? {
            confidence: "low" as const,
            label: "best available" as const,
            shortfall: "Chosen by the fallback matcher: the planned moment was no longer free, so this moment was not checked like the others. Treat it as the best available candidate and review the alternatives.",
          }
        : {}),
      ...(fromChoice && pick ? { match: pick.match, alternatives: pick.alternatives?.map((a) => ({ ...a, curves: curves ? takeCurves(sources.find((x) => x.asset.id === a.sourceId)?.tone, a.inMs, a.outMs, curves) : undefined })), reuse: pick.reuse, role: pick.role, reasons: pick.why, confidence: pick.confidence, label: pick.label, ...(pick.identity ? { identity: pick.identity } : {}), certainty: pick.certainty, coverage: pick.coverage, shortfall: pick.shortfall, speed: pick.speed } : {}),
      peak: { fraction: Number(requirements[index].peakFraction.toFixed(3)), source: requirements[index].peakSource },
    });
    cursor += duration;
    if (pool.includes(s)) consumeRange(pool, s, sourceIn, sourceFramesPlayed(duration, retimeSpeed));
  }
  if (!cursor) throw Error("The selected footage has no usable video ranges");
  // Text that is part of a chosen source's pixels is said plainly: it is not an editable title.
  matches.forEach((m, i) => {
    if (m.reel) return;
    const src = sources.find((s) => s.asset.id === m.source);
    const fromMs = (m.sourceIn * 1000) / rate,
      toMs = ((m.sourceIn + m.duration) * 1000) / rate;
    const verdict = classifySourceText(src?.text, fromMs, toMs, requirements[i]?.texts ?? []);
    if (verdict.unrelated.length)
      warnings.push(`Shot ${i + 1}: Source contains baked-in text (${verdict.unrelated.map((r) => `"${r.text}"`).join(", ")}); it is part of the footage, not an editable title${(requirements[i]?.texts ?? []).length ? ", and a reconstructed title may sit near it" : ""}.`);
  });
  const transitionTrack = uid();
  for (let i = 1; i < matches.length; i++) {
    const left = matches[i - 1],
      right = matches[i];
    const measured = dna.transitions.find(
      (t) => Math.abs(t.cutMs - right.referenceMs) < 1,
    );
    if (!measured || measured.kind === "cut") continue;
    // Between two of the reel's own shots the reel's frames already play the transition.
    if (left.reel && right.reel) continue;
    if (
      !["flash", "blur", "zoom", "whip", "motion", "dissolve"].includes(measured.kind) ||
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
    // A dissolve borrows source frames before the incoming in-point; only frames inside the same
    // cut-safe stretch, never across a cut in the raw footage. It is rebuilt ending at the cut.
    let span = before;
    if (measured.kind === "dissolve") {
      span = Math.min(before + after, right.preroll ?? 0, left.duration, 120);
      if (span < 2) {
        warnings.push(`Shot ${i + 1}: dissolve measured, but the incoming take has no clean footage before it; retained a cut.`);
        continue;
      }
    }
    command.push({
      tool: "sequence.transition",
      sequenceId: id,
      id: uid(),
      trackId: transitionTrack,
      leftId: left.clipId,
      rightId: right.clipId,
      kind: measured.kind as "flash" | "blur" | "zoom" | "whip" | "motion" | "dissolve",
      ...(measured.direction ? { direction: measured.direction } : {}),
      ...(measured.zoomDirection
        ? { zoomDirection: measured.zoomDirection }
        : {}),
      protection: protection.filter(
        (r) => r.clipId === left.clipId || r.clipId === right.clipId,
      ),
      before: span,
      after,
      strength: clamp(measured.strength, 0.05, 1),
    });
  }
  const pulseTrack = uid(),
    pulseLayers = new Map<object, string>();
  for (const pulse of dna.colorPulses ?? []) {
    if (keepColor || controls.color <= 0) break;
    const shot = matches.find(
      (m) => pulse.startMs >= m.referenceMs && pulse.endMs <= m.referenceEndMs,
    );
    // The reel's own shot already shows its pulse.
    if (!shot || shot.reel) continue;
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
    pulseLayers.set(pulse, (command.at(-1) as { id: string }).id);
  }
  command.push(...grade);
  // Bars only over the reference shots that show them (bars baked into one source must not
  // letterbox the whole edit).
  if (barsBox && ap && cursor > 0)
    for (const run of barredRuns(matches.filter((m) => !m.reel), referenceShots)) command.push({ tool: "sequence.letterbox", sequenceId: id, trackId: uid(), id: uid(), start: run.start, duration: run.duration, top: Math.min(0.45, ap.top), bottom: Math.min(0.45, ap.bottom), left: Math.min(0.45, ap.left), right: Math.min(0.45, ap.right) });
  // Title and end cards on a plain background (card.ts) are plates in the card's colour, not
  // footage: one editable plate per run of consecutive card shots of one colour, over the footage.
  if (cursor > 0) {
    for (const run of cardRuns(matches.filter((m) => !m.reel), referenceShots)) command.push({ tool: "sequence.cardPlate", sequenceId: id, trackId: uid(), id: uid(), start: run.start, duration: run.duration, color: run.color });
    for (const m of matches) {
      const card = m.reel ? undefined : referenceShots.find((r) => r.startMs === m.referenceMs)?.card;
      if (card) (m as { reasons?: string[] }).reasons = [`A title card on a plain background: recreated as a ${card.color} plate under the text; the footage chosen here is hidden beneath it (delete the plate to show it).`, ...((m as { reasons?: string[] }).reasons ?? [])];
    }
  }
  // Reference-clock milliseconds to a frame of this sequence, through the shot matches (which
  // carry pace and Smart/Remix length changes).
  const toFrame = (ms: number) => {
    const m = matches.find((m) => ms >= m.referenceMs && ms < m.referenceEndMs) ?? (ms < (matches[0]?.referenceMs ?? 0) ? matches[0] : matches.at(-1));
    if (!m) return -1;
    return m.start + Math.round(((ms - m.referenceMs) * m.duration) / Math.max(1, m.referenceEndMs - m.referenceMs));
  };
  const assetAdds: EditorToolCall[] = [];
  let audioTrackName: string | undefined;
  if (audioMode === "reference" && audioPlan.soundtrack) {
    // The reference's own soundtrack, as one ordinary audio clip: it can be muted, trimmed,
    // moved, regained or replaced like any other. Its clock is the reference's, so the interval
    // start is its Source In.
    const soundtrack = audioPlan.soundtrack,
      trackId = audio,
      clipId = uid(),
      sourceIn = Math.round((intervalStart * rate) / 1000);
    assetAdds.push({ tool: "asset.add", asset: soundtrack });
    audioTrackName = "Reference audio";
    const duration = Math.min(cursor, Math.floor(soundtrack.duration * rate) - sourceIn);
    if (duration > 0)
      command.push({ tool: "sequence.insert", sequenceId: id, clipId, trackId, assetId: soundtrack.id, fingerprint: soundtrack.fingerprint, startFrame: 0, sourceIn, duration, gain: 0 });
    audioNotes.push(`Reference soundtrack from ${(intervalStart / 1000).toFixed(3)} s on its own track; raw clip audio at −60 dB; supplied music left out.`);
  }
  if (audioMode === "recreate" && audioPlan.reference && measuredDna.eventGraph) {
    const sounds = plannedSounds(measuredDna.eventGraph, audioPlan.reference, audioPlan.music, alignment, intervalStart, voice ? -20 : -12);
    const trackId = uid();
    let made = 0;
    for (const sound of sounds) {
      const asset = audioPlan.sounds?.[sound.kind];
      if (!asset) {
        audioNotes.push(`No generated ${sound.kind} available: ${sound.reason}.`);
        continue;
      }
      if (!assetAdds.some((c) => c.tool === "asset.add" && c.asset.id === asset.id)) assetAdds.push({ tool: "asset.add", asset });
      const placed = placeSound(sound, asset.duration * 1000, rate, (ms) => toFrame(retime(ms)), cursor);
      if (!placed) continue;
      // The track exists only once something is placed on it.
      if (!made++) command.push({ tool: "sequence.audioTrack", sequenceId: id, trackId, name: "Recreated SFX" });
      const sfxId = uid();
      command.push({ tool: "sequence.insert", sequenceId: id, clipId: sfxId, trackId, assetId: asset.id, fingerprint: asset.fingerprint, startFrame: placed.at, sourceIn: placed.sourceIn, duration: placed.duration, gain: sound.gainDb });
      for (const [frame, value] of placed.keys)
        command.push({ tool: "sequence.keyframe", sequenceId: id, clipId: sfxId, property: "gain", frame, value, easing: "linear" });
      const lands = sound.landingMs !== undefined ? ` (lands ${(toFrame(retime(sound.landingMs)) / rate).toFixed(3)} s)` : "";
      audioNotes.push(`Generated ${sound.kind} at ${(placed.at / rate).toFixed(3)} s${lands}, ${sound.gainDb} dB (reference ${sound.relativeGainDb >= 0 ? "+" : ""}${sound.relativeGainDb} dB over its music; attack ${sound.attackMs} ms, release ${sound.releaseMs} ms): ${sound.reason}.`.slice(0, 400));
    }
  }
  for (const asset of [music, voice]) {
    if (!asset) continue;
    if (audioMode === "reference" && asset === music) continue;
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
      sourceIn: asset === music && alignment ? Math.round((alignment.offsetMs * rate) / 1000) : 0,
      duration: asset === music && alignment ? Math.min(duration, Math.floor(asset.duration * rate) - Math.round((alignment.offsetMs * rate) / 1000)) : duration,
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
  const baseName = "Recreation · " + controls.mode;
  let name = baseName;
  for (let take = 2; p.compositions.some((c) => c.name === name); take++)
    name = baseName + " (" + take + ")";
  command.unshift({
    tool: "sequence.create",
    id,
    name,
    settings: { ...p.settings, width, height },
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
  // Generated sounds enter the library before anything uses them.
  command.unshift(...assetAdds);
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
  const fillTrack = uid();
  for (const sourceId of backgroundClips)
    command.push({
      tool: "sequence.backgroundFill",
      sequenceId: id,
      id: uid(),
      sourceId,
      trackId: fillTrack,
      blur: 24,
    });
  if (backgroundClips.length)
    warnings.push(
      `${backgroundClips.length} shots use editable blurred fill to preserve protected framing.`,
    );
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
  const frontGraphics = uid();
  const frontTitles: EditorToolCall[] = [],
    titleLayers = new Map<object, string>();
  const overlays =
    dna.text?.filter((t) => t.role === "persistent-overlay").length ?? 0;
  if (overlays && controls.wording !== "omit")
    warnings.push(
      `${overlays} recurring edge-label intervals were excluded from caption recreation. Review recognized words before applying.`,
    );
  if (controls.wording === "original" && !dna.text?.some((t) => t.content))
    warnings.push("No readable reference words were recognized.");
  const uncertain = dna.text?.filter(
    (t) =>
      t.evidence?.status === "uncertain" && t.role !== "persistent-overlay",
  ).length;
  if (uncertain && controls.wording !== "omit")
    warnings.push(
      `${uncertain} uncertain text intervals withheld. Review the observations against the reference.`,
    );
  for (const appearance of controls.wording === "omit"
    ? []
    : (dna.text ?? [])) {
    if (appearance.role === "persistent-overlay") continue;
    if (appearance.evidence?.status === "uncertain") continue;
    if (command.length + frontTitles.length >= 508) break;
    const match = matches.find(
      (m) =>
        appearance.startMs >= m.referenceMs &&
        appearance.startMs < m.referenceEndMs,
    );
    // The reel's own shot already shows its words in its pixels.
    if (!match || match.reel) continue;
    const relative = (ms: number) =>
      match.start +
      Math.round(
        ((ms - match.referenceMs) * match.duration) /
          (match.referenceEndMs - match.referenceMs),
      );
    const start = relative(appearance.startMs);
    const spanned =
      matches.find(
        (m) =>
          appearance.endMs > m.referenceMs &&
          appearance.endMs <= m.referenceEndMs,
      ) ?? matches.at(-1)!;
    // A title that runs on into the reel's own shot stops where that shot begins (it shows its own).
    const firstReel = matches.find((m) => m.reel && m.start > match.start);
    const last = firstReel && spanned.start >= firstReel.start ? (matches[matches.indexOf(firstReel) - 1] ?? match) : spanned;
    const end = Math.min(
      cursor,
      last.start + last.duration,
      Math.max(
        start + 4,
        last.start +
          Math.round(
            ((appearance.endMs - last.referenceMs) * last.duration) /
              (last.referenceEndMs - last.referenceMs),
          ),
      ),
    );
    if (end - start < 4) continue;
    const source = sources.find((s) => s.asset.id === match.source)!;
    const sourceClip = layout.clips.find((c) => c.id === match.clipId)!;
    const sourceTime =
      (sourceFrameAt(sourceClip, start - match.start) * 1000) / rate;
    // The source already shows these words, burned into its pixels where the reference shows
    // them: keep the source's text and add no duplicate title.
    if (appearance.content) {
      const shown = classifySourceText(source.text, sourceTime - 250, sourceTime + 250, [{ content: appearance.content, x: appearance.x, y: appearance.y, width: appearance.width, height: appearance.height }]);
      if (shown.equivalent.length) {
        warnings.push(`The source already shows "${shown.equivalent[0].region.text}" (burned into the footage) at ${(sourceTime / 1000).toFixed(2)} s; the reconstructed title "${appearance.content}" was not added over it.`);
        continue;
      }
      // Unrelated text burned in where this title goes: the title is kept (the reference has it),
      // and the overlap is said, never placed silently.
      const over = shown.unrelated.find((r) => Math.min(r.x + r.width, appearance.x + appearance.width) > Math.max(r.x, appearance.x) && Math.min(r.y + r.height, appearance.y + appearance.height) > Math.max(r.y, appearance.y));
      if (over) warnings.push(`The reconstructed title "${appearance.content}" overlaps text burned into the source ("${over.text}") at ${(sourceTime / 1000).toFixed(2)} s; Source contains baked-in text.`);
    }
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
    const behind =
      controls.subjectLayering === "behind-people" ||
      (controls.subjectLayering === "reference" &&
        appearance.depth?.relation === "behind");
    const picture = visiblePicture(layout, sourceClip, source.asset, start);
    const firstInk =
      close &&
      controls.wording === "original" &&
      picture &&
      appearance.inkMetrics
        ? projectInk(
            layout,
            picture,
            appearance,
            controls.format === "vertical",
          )
        : undefined;
    const placementBox = firstInk
      ? {
          x: (firstInk.x - firstInk.width / 2) / width + 0.5,
          y: (firstInk.y - firstInk.height / 2) / height + 0.5,
          width: firstInk.width / width,
          height: firstInk.height / height,
        }
      : appearance;
    const band = placement(
      layout,
      start,
      end,
      sources.map((s) => s.analysis),
      placementBox.y + placementBox.height / 2,
      placementBox,
    );
    if (behind) {
      band.y =
        (clamp(appearance.y + appearance.height / 2, 0.12, 0.78) - 0.5) *
        height;
    }
    let measuredInk: Extract<
      EditorToolCall,
      { tool: "sequence.text" }
    >["measuredInk"];
    if (firstInk && appearance.inkMetrics && picture) {
      const { family: _family, weight: _weight, ...em } = appearance.inkMetrics;
      const dy =
        behind || controls.subjectLayering === "reference"
          ? 0
          : band.y - firstInk.y;
      const positioned = (box: typeof firstInk, region: typeof picture) => ({
        ...box,
        y: Math.max(
          region.top - height / 2 + box.height / 2,
          Math.min(region.bottom - height / 2 - box.height / 2, box.y + dy),
        ),
      });
      const samples = new Map([
        [0, { frame: 0, ...positioned(firstInk, picture) }],
      ]);
      for (const g of appearance.geometry ?? []) {
        const shot = matches.find(
          (m) => m.referenceMs <= g.timeMs && g.timeMs < m.referenceEndMs,
        );
        if (!shot) continue;
        const at =
          shot.start +
          Math.round(
            ((g.timeMs - shot.referenceMs) * shot.duration) /
              (shot.referenceEndMs - shot.referenceMs),
          );
        const local = at - start;
        if (local < 0 || at >= end) continue;
        const clip = layout.clips.find((c) => c.id === shot.clipId),
          a = sources.find((s) => s.asset.id === shot.source)?.asset;
        if (!clip || !a) continue;
        const region = visiblePicture(layout, clip, a, at);
        const box =
          region &&
          projectInk(layout, region, g, controls.format === "vertical");
        if (box && region)
          samples.set(local, { frame: local, ...positioned(box, region) });
      }
      measuredInk = {
        ...em,
        samples: [...samples.values()].sort((a, b) => a.frame - b.frame),
      };
    }
    // Only a measured visual build calls for staggered words. Map corroborating
    // vocal onsets through each matched shot, including a title that spans a cut.
    let wordStarts: number[] | undefined;
    const wordCount = content.trim().split(/\s+/).length;
    if (
      appearance.revealOffsetMs != null &&
      wordCount > 1 &&
      wordCount <= end - start
    ) {
      const onsets = appearance.evidence?.wordStartsMs;
      const measured =
        controls.wording === "original" && onsets?.length === wordCount;
      wordStarts = Array.from({ length: wordCount }, (_, i) => {
        if (measured) {
          const ms = onsets[i];
          const shot =
            matches.find((m) => ms >= m.referenceMs && ms < m.referenceEndMs) ??
            (ms <= appearance.startMs ? match : last);
          return (
            Math.round(
              shot.start +
                ((ms - shot.referenceMs) * shot.duration) /
                  (shot.referenceEndMs - shot.referenceMs),
            ) - start
          );
        }
        return Math.round(
          (i *
            Math.min(
              end - start - 1,
              (appearance.revealOffsetMs! * rate) / 1000,
            )) /
            (wordCount - 1),
        );
      });
      for (let i = 0; i < wordCount; i++)
        wordStarts[i] = clamp(
          wordStarts[i],
          i ? wordStarts[i - 1] + 1 : 0,
          end - start - wordCount + i,
        );
    }
    const aboveMask = controls.subjectLayering === "reference" && !behind;
    if (close && controls.wording === "original" && appearance.outline && picture && content === appearance.content) {
      const pw = picture.right - picture.left,
        ph = picture.bottom - picture.top;
      (aboveMask ? frontTitles : command).push({
        tool: "sequence.tracedTitle",
        sequenceId: id,
        id: uid(),
        trackId: aboveMask ? frontGraphics : graphics,
        content,
        start,
        duration: end - start,
        color: (appearance.differenceInk ?? appearance.foreground ?? "#ffffff").toLowerCase(),
        blend: appearance.differenceInk ? "difference" : "normal",
        outline: appearance.outline.map((o) => ({
          hole: o.hole,
          points: o.points.map(([x, y]) => [(picture.left + x * pw) / width, (picture.top + y * ph) / height] as [number, number]),
        })),
      });
      titleLayers.set(appearance, ((aboveMask ? frontTitles : command).at(-1) as { id: string }).id);
      continue;
    }
    (aboveMask ? frontTitles : command).push({
      tool: "sequence.text",
      sequenceId: id,
      id: uid(),
      trackId: aboveMask ? frontGraphics : graphics,
      content,
      ...(measuredInk && appearance.differenceInk ? {differenceInk:appearance.differenceInk} : {}),
      ...(measuredInk && appearance.rotation ? { rotation: appearance.rotation } : {}),
      ...(measuredInk && appearance.inkMetrics
        ? {
            face: {
              family: appearance.inkMetrics.family,
              weight: appearance.inkMetrics.weight,
            },
            measuredInk,
          }
        : appearance.face
          ? {
              face: {
                family: appearance.face.family,
                weight: appearance.face.weight,
              },
            }
          : {}),
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
      ...(wordStarts ? { wordStarts } : {}),
      timing:
        wordStarts &&
        controls.wording === "original" &&
        appearance.evidence?.wordStartsMs.length === wordCount
          ? "transcript"
          : "manual",
      maxFontSize: clamp(
        (appearance.height * layout.settings.height) / 0.78,
        6,
        1000,
      ),
      y: band.y,
      layout: { x: band.x, width: band.width },
    });
    titleLayers.set(appearance, ((aboveMask ? frontTitles : command).at(-1) as { id: string }).id);
  }
  if (omitted)
    warnings.push(
      omitted +
        " detected text intervals had no original copy. Supply quoted titles to fill them.",
    );
  if (controls.subjectLayering !== "flat") {
    const foreground = uid();
    for (const match of matches) {
      if (match.reel) continue;
      if (
        !command.some(
          (c) =>
            c.tool === "sequence.text" &&
            c.start < match.start + match.duration &&
            c.start + c.duration > match.start,
        )
      )
        continue;
      const source = sources.find((s) => s.asset.id === match.source)!;
      const clip = layout.clips.find((c) => c.id === match.clipId)!;
      // Layering keeps the segmentation's own outlines (unchanged by the matcher's person check).
      const outlines = source.outlines ?? source.people;
      const mask = outlines?.length
        ? editablePersonMask(
            outlines,
            clip,
            source.asset,
            width,
            height,
            rate,
          )
        : undefined;
      if (mask && command.length + frontTitles.length < 510)
        command.push({
          tool: "sequence.subjectLayer",
          sequenceId: id,
          id: uid(),
          sourceId: clip.id,
          trackId: foreground,
          mask,
        });
      else
        warnings.push(
          `No reliable local person outline for ${source.asset.name}; text remains in front.`,
        );
    }
  }
  if (close && controls.subjectLayering === "reference" && dna.personFlashes?.length) {
    const trackId=uid();
    for(const match of matches){
      if(match.reel)continue;
      const spans=dna.personFlashes.filter(f=>f.startMs<match.referenceEndMs && f.endMs>match.referenceMs);
      if(!spans.length)continue;
      const source=sources.find(s=>s.asset.id===match.source)!;
      const clip=layout.clips.find(c=>c.id===match.clipId)!;
      const mask=editablePersonMask(source.outlines??source.people??[],clip,source.asset,width,height,rate);
      if(!mask){warnings.push("Subject flash withheld because the raw shot has no measured person contour.");continue;}
      // A flat flash has a hard edge in the reference; keep only enough feather to hide stair-stepping.
      mask.feather=0.5;
      const local=(ms:number)=>clamp(Math.round((ms-match.referenceMs)*match.duration/(match.referenceEndMs-match.referenceMs)),0,match.duration);
      for(const color of new Set(spans.map(f=>f.color))){
        const ranges=spans.filter(f=>f.color===color).map(f=>({start:local(f.startMs),end:local(f.endMs)})).filter(f=>f.end>f.start);
        if(ranges.length && command.length+frontTitles.length<508)command.push({tool:"sequence.subjectLayer",sequenceId:id,id:uid(),sourceId:clip.id,trackId,mask,silhouette:{color,spans:ranges}});
      }
    }
  }
  // ---- Linked audio events as sequence markers, with the layers each drives.
  const referenceEvents: NonNullable<NonNullable<Project["compositions"][number]["ai"]>["referenceEvents"]> = [];
  const graph = measuredDna.eventGraph;
  if (graph) {
    const filtered = (measuredDna.text ?? []).filter((t) => t.content && t.role !== "persistent-overlay" && t.evidence?.status !== "uncertain");
    const workingText = (dna.text ?? []).filter((t) => t.content && t.role !== "persistent-overlay" && t.evidence?.status !== "uncertain");
    const layerFor = (visualId: string): string | undefined => {
      const cut = /^cut_(\d+)$/.exec(visualId);
      if (cut) return matches[Number(cut[1])]?.clipId;
      const title = /^title_(\d+)_(in|out)$/.exec(visualId);
      if (title) return titleLayers.get(workingText[Number(title[1]) - 1] ?? filtered[Number(title[1]) - 1]);
      const pulse = /^pulse_(\d+)$/.exec(visualId);
      if (pulse) return pulseLayers.get(dna.colorPulses[Number(pulse[1]) - 1]);
      return undefined;
    };
    const visualKind = new Map(graph.visual.map((v) => [v.id, v.kind]));
    const byAnchor = new Map<string, typeof graph.links>();
    for (const l of graph.links) if (l.anchorId && l.relation !== "unanchored" && l.confidence >= 0.2) byAnchor.set(l.anchorId, [...(byAnchor.get(l.anchorId) ?? []), l]);
    const anchors = new Map(graph.anchors.map((a) => [a.id, a]));
    for (const [anchorId, links] of [...byAnchor].slice(0, 120)) {
      const anchor = anchors.get(anchorId);
      if (!anchor) continue;
      const frame = toFrame(retime(anchor.timeMs));
      if (frame < 0 || frame >= cursor) continue;
      const markerId = uid(),
        kinds = [...new Set(links.map((l) => visualKind.get(l.visualId) ?? "visual"))];
      command.push({ tool: "sequence.marker", sequenceId: id, id: markerId, frame, name: `${links[0].inferred.anchor} → ${kinds.join(", ")}`.slice(0, 256) });
      referenceEvents.push({
        markerId,
        anchorKind: String(links[0].inferred.anchor).slice(0, 32),
        anchorMs: Math.round(anchor.timeMs),
        confidence: Math.max(...links.map((l) => l.confidence)),
        links: links
          .flatMap((l) => {
            const layerId = layerFor(l.visualId);
            return layerId ? [{ layerId, visual: visualKind.get(l.visualId) ?? "visual", relation: l.relation as "on" | "before" | "after" | "offbeat", offsetMs: Math.max(-10000, Math.min(10000, l.offsetMs)) }] : [];
          })
          .slice(0, 16),
      });
    }
  }
  // Snap targets: the detected events of the audio this sequence actually plays.
  const heard = audioMode === "reference" ? audioPlan.reference : audioMode === "recreate" ? audioPlan.music : undefined;
  const heardStart = audioMode === "reference" ? intervalStart : (alignment?.offsetMs ?? 0);
  const audioEventFrames = heard
    ? [...new Set(heard.events.filter((e) => ["kick", "snare", "impact", "bass_hit", "drop", "onset", "section", "word"].includes(e.kind)).map((e) => Math.round(((e.timeMs - heardStart) * rate) / 1000)).concat(heard.beats.map((b) => Math.round(((b.timeMs - heardStart) * rate) / 1000))))]
        .filter((fr) => fr >= 0 && fr < cursor)
        .sort((x, y) => x - y)
        .slice(0, 4000)
    : [];
  const create = command.find((c) => c.tool === "sequence.create");
  if (create && create.tool === "sequence.create") {
    if (audioTrackName) create.audioTrackName = audioTrackName;
    // No empty default audio track: keep it only when a clip lands on it.
    if (!command.some((c) => c.tool === "sequence.insert" && c.trackId === audio)) create.audioTrack = false;
  }
  // Each shot's first choice and its alternative takes, saved with the recreation so a reopened
  // project can still swap a take (and name any shot a take would repeat).
  const takeOf = (sourceId: string, inMs: number, outMs: number, speed: number, score: number, lostOn: string, curves: unknown) => ({
    sourceId,
    inMs: Math.max(0, Math.round(inMs)),
    outMs: Math.max(Math.round(inMs), Math.round(outMs)),
    speed: Math.min(4, Math.max(0.05, speed)),
    score: Math.max(-10, Math.min(10, Number(score.toFixed(4)))),
    lostOn: lostOn.slice(0, 400),
    ...(curves === null ? { neutral: true } : curves ? { curves: curves as { red: [number, number][]; green: [number, number][]; blue: [number, number][] } } : {}),
  });
  // Every shot is listed (alternatives possibly empty): a reopened recreation checks a take
  // against all the shots it could repeat, and numbers shots as the live panel does.
  const takes = matches
    .filter((m) => m.clipId)
    .slice(0, 500)
    .map((m) => {
      const fitted = command.find((c) => c.tool === "sequence.effect" && c.clipId === m.clipId && c.type === "curves");
      const speed = m.speed ?? 1;
      return {
        clipId: m.clipId,
        original: takeOf(m.source, (m.sourceIn * 1000) / rate, ((m.sourceIn + m.duration * speed) * 1000) / rate, speed, m.certainty ?? 0, "the first choice", fitted && fitted.tool === "sequence.effect" ? fitted.parameters : null),
        alternatives: (m.alternatives ?? []).slice(0, 4).map((a) => takeOf(a.sourceId, a.inMs, a.outMs, a.speed ?? 1, a.score, a.lostOn, a.curves)),
      };
    });
  if (create && create.tool === "sequence.create")
    create.ai = { ...create.ai, ...(audioMapping.length ? { audioMapping } : {}), ...(audioEventFrames.length ? { audioEventFrames } : {}), audioMode, ...(audioNotes.length ? { audioNotes: audioNotes.slice(0, 64) } : {}), ...(referenceEvents.length ? { referenceEvents } : {}), ...(takes.length ? { takes } : {}) };
  warnings.push(...audioNotes.filter((n) => /^(No generated|The reference has no|Recreating the audio)/.test(n)));
  command.push(...frontTitles);
  if (command.length !== preview.plan.commands.length || warnings.length)
    preview = previewEditPlan(plan, p, revision);
  const min = (ms: number) => `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  const coverage = { ...footage.coverage, sources: planReport?.coverage, used: matches.length, global: matches.filter((m) => m.selection === "global").length, finalMs: Math.round((cursor * 1000) / rate), matching: matchingProfile };
  warnings.push(
    `Raw footage: ${min(coverage.suppliedMs)} supplied, ${min(coverage.analyzedMs)} analysed, ${coverage.segments} cut-safe stretches (${coverage.cuts} frame-accurate cuts), ${coverage.candidates} candidate moments, ${coverage.used} used (${coverage.global} chosen globally), final edit ${(coverage.finalMs / 1000).toFixed(1)} s. Matching: index ${matchingProfile.index} ms, stage A ${matchingProfile.stageA} ms, stage B ${matchingProfile.stageB} ms (${matchingProfile.rerankedPerShot} reranked per shot), sequence ${matchingProfile.beam} ms.`,
  );
  return { matches, warnings, preview, coverage };
}
