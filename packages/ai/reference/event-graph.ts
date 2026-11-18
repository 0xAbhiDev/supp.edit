/** Shared audio/visual event graph. Visual events measured from the reference (cuts and their
 * transitions, titles, colour pulses, subject flashes) and audio events measured from its
 * soundtrack sit on one millisecond clock. Each visual event is linked to the audio event that
 * most plausibly triggers it, with the measured offset kept apart from the inferred relation.
 * Nothing here names a reference, a word or a genre. */
import { z } from "zod";
import type { StyleDNA } from "./dna";
import type { AudioEvent, AudioTimeline } from "../audio/timeline";

export const visualEventKinds = ["cut", "title_in", "title_out", "pulse", "subject_flash"] as const;
export type VisualEventKind = (typeof visualEventKinds)[number];
export const relations = ["on", "before", "after", "offbeat", "unanchored"] as const;
const ms = z.number().int().nonnegative();
export const eventGraphSchema = z
  .object({
    version: z.literal(1),
    visual: z
      .array(
        z
          .object({
            id: z.string().max(64),
            kind: z.enum(visualEventKinds),
            timeMs: ms,
            label: z.string().max(120).optional(),
          })
          .strict(),
      )
      .max(4000),
    /** Audio anchors referenced by links: events, beats and downbeats. */
    anchors: z
      .array(z.object({ id: z.string().max(64), kind: z.string().max(32), timeMs: ms, strength: z.number().min(0).max(1), text: z.string().max(120).optional() }).strict())
      .max(4000),
    links: z
      .array(
        z
          .object({
            visualId: z.string().max(64),
            anchorId: z.string().max(64).nullable(),
            relation: z.enum(relations),
            /** Visual time minus anchor time, as measured. */
            offsetMs: z.number().int(),
            confidence: z.number().min(0).max(1),
            measured: z.record(z.string().max(32), z.number().finite()),
            inferred: z.record(z.string().max(32), z.union([z.string().max(80), z.number().finite(), z.boolean()])),
          })
          .strict(),
      )
      .max(4000),
    /** How the reference uses its audio, summarised from the links. */
    grammar: z.record(z.string().max(48), z.record(z.string().max(48), z.number().finite())),
  })
  .strict();
export type EventGraph = z.infer<typeof eventGraphSchema>;

/** How well each audio event kind explains each visual event kind. */
const affinity: Record<VisualEventKind, Partial<Record<string, number>>> = {
  cut: { impact: 1, drop: 1, downbeat: 0.9, bass_hit: 0.85, kick: 0.85, section: 0.8, whoosh_end: 0.8, riser_end: 0.8, snare: 0.8, beat: 0.75, silence_start: 0.7, silence_end: 0.7, onset: 0.6, word: 0.5 },
  title_in: { word_match: 1, impact: 0.9, drop: 0.9, bass_hit: 0.85, downbeat: 0.8, whoosh_end: 0.8, kick: 0.75, snare: 0.75, beat: 0.7, word: 0.7, onset: 0.5 },
  title_out: { word_end: 0.8, downbeat: 0.7, beat: 0.65, kick: 0.6, snare: 0.6, onset: 0.5, silence_start: 0.6 },
  pulse: { impact: 1, drop: 1, bass_hit: 0.9, kick: 0.85, snare: 0.8, downbeat: 0.8, beat: 0.75, onset: 0.6 },
  subject_flash: { impact: 1, drop: 1, bass_hit: 0.9, kick: 0.85, snare: 0.8, downbeat: 0.8, beat: 0.75, onset: 0.6 },
};
const token = (s?: string) => (s ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function visualEvents(dna: StyleDNA): EventGraph["visual"] {
  const out: EventGraph["visual"] = [];
  dna.shots.slice(1).forEach((shot, i) => {
    const transition = dna.transitions.find((t) => Math.abs(t.cutMs - shot.startMs) <= 40);
    out.push({ id: `cut_${i + 1}`, kind: "cut", timeMs: Math.round(shot.startMs), label: transition?.kind ?? "cut" });
  });
  (dna.text ?? [])
    .filter((t) => t.content && t.role !== "persistent-overlay" && t.evidence?.status !== "uncertain")
    .forEach((t, i) => {
      out.push({ id: `title_${i + 1}_in`, kind: "title_in", timeMs: Math.round(t.startMs), label: t.content!.slice(0, 120) });
      out.push({ id: `title_${i + 1}_out`, kind: "title_out", timeMs: Math.round(t.endMs), label: t.content!.slice(0, 120) });
    });
  (dna.colorPulses ?? []).forEach((p, i) => out.push({ id: `pulse_${i + 1}`, kind: "pulse", timeMs: Math.round(p.startMs) }));
  (dna.personFlashes ?? []).forEach((p, i) => out.push({ id: `flash_${i + 1}`, kind: "subject_flash", timeMs: Math.round(p.startMs) }));
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

export function audioAnchors(audio: AudioTimeline): EventGraph["anchors"] {
  const anchors: EventGraph["anchors"] = [];
  audio.beats.forEach((b, i) => anchors.push({ id: `beat_${i + 1}`, kind: b.downbeat ? "downbeat" : "beat", timeMs: b.timeMs, strength: b.strength }));
  const as = (e: AudioEvent, kind: string, timeMs: number) => anchors.push({ id: e.id + (kind.endsWith("_end") ? "_end" : ""), kind, timeMs, strength: e.strength, ...(e.text ? { text: e.text } : {}) });
  for (const e of audio.events) {
    if (["impact", "drop", "bass_hit", "kick", "snare", "onset", "section", "word"].includes(e.kind)) as(e, e.kind, e.timeMs);
    if (e.kind === "word" && e.endMs !== undefined) as(e, "word_end", e.endMs);
    if ((e.kind === "whoosh" || e.kind === "riser") && e.endMs !== undefined) as(e, e.kind + "_end", e.endMs);
    if (e.kind === "silence") {
      anchors.push({ id: e.id + "_start", kind: "silence_start", timeMs: e.timeMs, strength: 1 });
      if (e.endMs !== undefined) anchors.push({ id: e.id + "_end", kind: "silence_end", timeMs: e.endMs, strength: 1 });
    }
  }
  return anchors.sort((a, b) => a.timeMs - b.timeMs);
}

/** Link each visual event to its most plausible audio trigger. `frameMs` is the reference's frame
 * duration: measured agreement within about a frame counts as "on". */
export function buildEventGraph(dna: StyleDNA, audio: AudioTimeline, frameMs = 1000 / 30): EventGraph {
  const visual = visualEvents(dna),
    anchors = audioAnchors(audio),
    beats = anchors.filter((a) => a.kind === "beat" || a.kind === "downbeat");
  const periodAt = (t: number) => {
    const k = beats.findIndex((b) => b.timeMs > t);
    const a = beats[Math.max(0, k - 1)],
      b = beats[k > 0 ? k : 1];
    return a && b && b.timeMs > a.timeMs ? b.timeMs - a.timeMs : undefined;
  };
  const onTolerance = Math.max(30, frameMs * 1.2);
  const links: EventGraph["links"] = visual.map((v): EventGraph["links"][number] => {
    const period = periodAt(v.timeMs),
      window = Math.max(80, frameMs * 2.5, (period ?? 0) * 0.3);
    let best: { anchor: (typeof anchors)[number]; score: number; kind: string } | undefined;
    for (const a of anchors) {
      const delta = v.timeMs - a.timeMs;
      if (Math.abs(delta) > window) continue;
      let kind = a.kind;
      if (kind === "word" && v.kind === "title_in" && v.label && token(a.text) && token(v.label).includes(token(a.text))) kind = "word_match";
      const weight = affinity[v.kind][kind];
      if (!weight) continue;
      const score = weight * (0.5 + 0.5 * a.strength) * Math.exp(-Math.abs(delta) / 45);
      if (!best || score > best.score) best = { anchor: a, score, kind };
    }
    // A weak plain onset half a beat from the grid does not explain a cut: the cut is offbeat.
    const nearestBeat = beats.reduce<(typeof beats)[number] | undefined>((m, b) => (!m || Math.abs(b.timeMs - v.timeMs) < Math.abs(m.timeMs - v.timeMs) ? b : m), undefined);
    if (best && period && nearestBeat && ["onset", "hat"].includes(best.kind) && best.anchor.strength < 0.35 && Math.abs(Math.abs(v.timeMs - nearestBeat.timeMs) / period - 0.5) <= 0.12) best = undefined;
    if (best) {
      const delta = v.timeMs - best.anchor.timeMs;
      return {
        visualId: v.id,
        anchorId: best.anchor.id,
        relation: Math.abs(delta) <= onTolerance ? "on" : delta < 0 ? "before" : "after",
        offsetMs: Math.round(delta),
        confidence: Number(Math.min(1, best.score * (best.kind === "beat" || best.kind === "downbeat" ? 0.5 + 0.5 * audio.beatConfidence : 1)).toFixed(3)),
        measured: period ? { deltaMs: Math.round(delta), anchorStrength: Number(best.anchor.strength.toFixed(3)), beatPeriodMs: period } : { deltaMs: Math.round(delta), anchorStrength: Number(best.anchor.strength.toFixed(3)) },
        inferred: { anchor: best.kind, rule: `${v.kind} ${Math.abs(delta) <= onTolerance ? "on" : delta < 0 ? "before" : "after"} ${best.kind}` },
      };
    }
    // No trigger nearby: is it deliberately between beats?
    const nearest = beats.reduce<(typeof beats)[number] | undefined>((m, b) => (!m || Math.abs(b.timeMs - v.timeMs) < Math.abs(m.timeMs - v.timeMs) ? b : m), undefined);
    if (nearest && period) {
      const delta = v.timeMs - nearest.timeMs,
        phase = Math.abs(delta) / period;
      if (Math.abs(phase - 0.5) <= 0.12)
        return { visualId: v.id, anchorId: nearest.id, relation: "offbeat", offsetMs: Math.round(delta), confidence: Number((0.5 * audio.beatConfidence).toFixed(3)), measured: { deltaMs: Math.round(delta), beatPeriodMs: period }, inferred: { anchor: "beat", rule: `${v.kind} half a beat from ${nearest.kind}` } };
    }
    return { visualId: v.id, anchorId: null, relation: "unanchored", offsetMs: 0, confidence: 0, measured: nearest ? { nearestBeatDeltaMs: Math.round(v.timeMs - nearest.timeMs) } : {}, inferred: { anchor: "none", rule: `${v.kind} not tied to a measured audio event` } };
  });
  // Grammar: how each kind of visual event relates to the audio, as fractions.
  const grammar: EventGraph["grammar"] = {};
  for (const kind of visualEventKinds) {
    const own = links.filter((l) => visual.find((v) => v.id === l.visualId)?.kind === kind);
    if (!own.length) continue;
    const anchorKind = (l: (typeof links)[number]) => String(l.inferred.anchor);
    const frac = (p: (l: (typeof links)[number]) => boolean) => Number((own.filter(p).length / own.length).toFixed(3));
    const offsets = own.filter((l) => l.anchorId).map((l) => l.offsetMs).sort((a, b) => a - b);
    grammar[kind] = {
      count: own.length,
      on: frac((l) => l.relation === "on"),
      before: frac((l) => l.relation === "before"),
      after: frac((l) => l.relation === "after"),
      offbeat: frac((l) => l.relation === "offbeat"),
      unanchored: frac((l) => l.relation === "unanchored"),
      onBeatOrDownbeat: frac((l) => ["beat", "downbeat"].includes(anchorKind(l))),
      onDownbeat: frac((l) => anchorKind(l) === "downbeat"),
      onTransient: frac((l) => ["impact", "kick", "snare", "onset", "bass_hit", "drop"].includes(anchorKind(l))),
      onLyric: frac((l) => anchorKind(l).startsWith("word")),
      medianOffsetMs: offsets.length ? offsets[offsets.length >> 1] : 0,
    };
  }
  const cuts = visual.filter((v) => v.kind === "cut");
  if (cuts.length >= 2 && beats.length >= 2) {
    // Beats per shot, measured between consecutive cuts.
    const spans = cuts.slice(1).map((c, k) => beats.filter((b) => b.timeMs >= cuts[k].timeMs - 40 && b.timeMs < c.timeMs - 40).length).sort((a, b) => a - b);
    grammar.cut.medianBeatsPerShot = spans[spans.length >> 1];
  }
  return { version: 1, visual, anchors: anchors.slice(0, 4000), links, grammar };
}
