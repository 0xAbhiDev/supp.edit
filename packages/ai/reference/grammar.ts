/** ReferenceGrammar: the one description of how a reference was edited, consolidated from every
 * analysis (shots and their roles, timing, cuts, camera, composition, movement, tone, audio, text,
 * depth and compositing, transitions, effects, the audio-visual event graph). Close Match
 * transfers it onto new footage; Smart Adaptation and Creative Remix bend it.
 *
 * It is a view computed from the StyleDNA (the stored model), not a second copy of it. Every
 * ambiguous property keeps four things apart:
 *  - measurement: what an analysis observed (cut evidence, OCR reads, optical flow, transients);
 *  - confidence: how sure that observation is (null where nothing calibrated exists);
 *  - interpretation: what the engine concludes (a boundary, a word, an action relation, a beat);
 *  - generated: what the reconstruction will produce from it, when that differs from the reading
 *    (a word only becomes text when it was read with evidence; an uncertain one is flagged).
 * Low-confidence observations are never promoted to facts: they stay "uncertain" here. */
import type { StyleDNA } from "./dna";
import { shotRole } from "./footage-index";

export interface Measured<T, I = string, G = unknown> {
  measurement: T;
  confidence: number | null;
  interpretation: I;
  generated?: G;
}
export interface GrammarShot {
  index: number;
  timing: { startMs: number; endMs: number; durationMs: number };
  /** The shot's role in the edit, inferred from its movement, camera, framing and audio tie. */
  role: Measured<{ level: number; camera: number; framing: string | null; audioPeak: boolean }, string>;
  cutIn: Measured<{ atMs: number; evidence: string[] }, "first shot" | "scene cut" | "motion or frame cut" | "transition", { kind: string } | null> | null;
  motion: Measured<{ level: number; peak: number; peakedness: number } | null, "still" | "small motion" | "movement" | "unmeasured">;
  camera: Measured<{ panX: number; panY: number; zoom: number } | null, string>;
  composition: Measured<{ rows: number[]; horizon: number; subjectSize: number | null } | null, string>;
  direction: Measured<{ vertical: number; horizontal: number; rotation: number; consistency: number } | null, string>;
  tone: Measured<StyleDNA["shots"][number]["tone"] | null, string>;
  audio: Measured<{ anchor: string; offsetMs: number } | null, string>;
}
export interface ReferenceGrammar {
  version: 2;
  canvas: { width: number; height: number; aspect: number; durationMs: number };
  shots: GrammarShot[];
  transitions: Measured<{ atMs: number; startMs: number; endMs: number; evidence: string[] }, string, { kind: string; direction: string | null }>[];
  audio: { bpm: number | null; anchors: Record<string, number>; links: number; anchored: number };
  text: Measured<{ startMs: number; endMs: number; read: string | null; status: string | null }, string, { text: string | null; flagged: boolean }>[];
  depth: Measured<{ textIndex: number; observations: number }, "front" | "behind" | "unknown">[];
  color: Measured<{ luma: number; saturation: number } | null, string>;
  effects: { colorPulses: Measured<{ startMs: number; endMs: number }, "color pulse">[]; personFlashes: number };
  eventGraph: Measured<{ visual: string; anchor: string | null; offsetMs: number }, string>[];
}

const classify = (level: number) => (level < 0.0003 ? "still" : level < 0.0015 ? "small motion" : "movement");

export function referenceGrammar(dna: StyleDNA): ReferenceGrammar {
  const transitions = dna.transitions ?? [];
  const graph = dna.eventGraph;
  const shots: GrammarShot[] = dna.shots.map((s, index) => {
    const t = transitions.find((x) => Math.abs(x.cutMs - s.startMs) < 120);
    const a = s.action;
    const camera = a?.camera ?? null;
    const moving = camera ? Math.abs(camera.panX) + Math.abs(camera.panY) + Math.abs(camera.zoom) : 0;
    const visualCut = graph?.visual.find((v) => v.kind === "cut" && Math.abs(v.timeMs - s.startMs) < 60);
    const link = visualCut && graph?.links.find((l) => l.visualId === visualCut.id);
    const anchor = link?.anchorId ? graph?.anchors.find((x) => x.id === link.anchorId) : undefined;
    const audioPeak = !!anchor;
    const role = shotRole(s, index, dna.shots.length, audioPeak ? "audio event" : "none", dna.shots[index + 1]);
    return {
      index,
      timing: { startMs: s.startMs, endMs: s.endMs, durationMs: s.endMs - s.startMs },
      role: { measurement: { level: a?.level ?? 0, camera: moving, framing: s.framing ?? null, audioPeak }, confidence: null, interpretation: role },
      cutIn:
        index === 0
          ? null
          : t && t.kind !== "cut"
            ? { measurement: { atMs: t.cutMs, evidence: t.evidence }, confidence: t.confidence, interpretation: "transition", generated: { kind: t.kind } }
            : { measurement: { atMs: s.startMs, evidence: t?.evidence ?? [] }, confidence: s.boundaryConfidence, interpretation: s.boundaryConfidence === null ? "motion or frame cut" : "scene cut", generated: { kind: "cut" } },
      motion: a ? { measurement: { level: a.level, peak: a.peak, peakedness: a.peakedness }, confidence: null, interpretation: classify(a.level) } : { measurement: null, confidence: null, interpretation: "unmeasured" },
      camera: { measurement: camera, confidence: s.camera?.confidence ?? null, interpretation: !camera ? "unmeasured" : moving < 0.02 ? "static" : Math.abs(camera.zoom) > Math.abs(camera.panX) + Math.abs(camera.panY) ? (camera.zoom > 0 ? "push-in" : "pull-out") : Math.abs(camera.panX) >= Math.abs(camera.panY) ? "pan" : "tilt" },
      composition: { measurement: s.scene ? { rows: s.scene.rows, horizon: s.scene.horizon, subjectSize: s.scene.subjectSize } : null, confidence: null, interpretation: s.scene?.role ?? "unmeasured" },
      direction: a?.direction
        ? {
            measurement: { vertical: a.direction.vertical, horizontal: a.direction.horizontal, rotation: a.direction.rotation, consistency: a.direction.consistency },
            confidence: null,
            interpretation: a.direction.rotation > 0.5 ? "rotational" : a.direction.consistency > 0.5 ? (Math.abs(a.direction.vertical) > Math.abs(a.direction.horizontal) ? (a.direction.vertical > 0 ? "downward" : "upward") : a.direction.horizontal > 0 ? "rightward" : "leftward") : "mixed",
          }
        : { measurement: null, confidence: null, interpretation: "unmeasured" },
      tone: { measurement: s.tone ?? null, confidence: null, interpretation: s.tone ? (s.plateTint ? `measured with the title band masked; plate ${s.plateTint}` : "measured") : "unmeasured" },
      audio: link && anchor ? { measurement: { anchor: anchor.kind, offsetMs: link.offsetMs }, confidence: link.confidence, interpretation: `cut ${link.relation} ${anchor.kind}` } : { measurement: null, confidence: null, interpretation: "not tied to a measured audio event" },
    };
  });
  const anchors: Record<string, number> = {};
  for (const a of graph?.anchors ?? []) anchors[a.kind] = (anchors[a.kind] ?? 0) + 1;
  const texts = dna.text ?? [];
  return {
    version: 2,
    canvas: { width: dna.width, height: dna.height, aspect: Number((dna.width / Math.max(1, dna.height)).toFixed(4)), durationMs: dna.shots.at(-1)?.endMs ?? 0 },
    shots,
    transitions: transitions.map((t) => ({ measurement: { atMs: t.cutMs, startMs: t.startMs, endMs: t.endMs, evidence: t.evidence }, confidence: t.confidence, interpretation: t.kind, generated: { kind: t.kind, direction: t.direction } })),
    audio: { bpm: dna.bpm, anchors, links: graph?.links.length ?? 0, anchored: graph?.links.filter((l) => l.anchorId).length ?? 0 },
    text: texts.map((t) => {
      const status = t.evidence?.status ?? null;
      const uncertain = status === "uncertain";
      // The reconstruction renders only words read with evidence, never persistent overlays.
      const rendered = !!t.content && !uncertain && t.role !== "persistent-overlay";
      return {
        measurement: { startMs: t.startMs, endMs: t.endMs, read: t.content ?? null, status },
        confidence: uncertain ? 0.3 : status ? 0.8 : null,
        interpretation: uncertain ? "lettering, word not established" : (t.evidence?.kind ?? "text"),
        generated: { text: rendered ? t.content! : null, flagged: uncertain },
      };
    }),
    depth: texts.flatMap((t, textIndex) => (t.depth ? [{ measurement: { textIndex, observations: t.depth.observations?.length ?? 0 }, confidence: null, interpretation: t.depth.relation }] : [])),
    color: { measurement: dna.color ? { luma: dna.color.luma, saturation: dna.color.saturation } : null, confidence: null, interpretation: dna.color ? "measured grade" : "unmeasured" },
    effects: {
      colorPulses: (dna.colorPulses ?? []).map((p) => ({ measurement: { startMs: p.startMs, endMs: p.endMs }, confidence: p.confidence, interpretation: "color pulse" as const })),
      personFlashes: dna.personFlashes?.length ?? 0,
    },
    eventGraph: (graph?.links ?? []).map((l) => {
      const v = graph!.visual.find((x) => x.id === l.visualId);
      const a = l.anchorId ? graph!.anchors.find((x) => x.id === l.anchorId) : undefined;
      return { measurement: { visual: v?.kind ?? l.visualId, anchor: a?.kind ?? null, offsetMs: l.offsetMs }, confidence: l.confidence, interpretation: l.relation };
    }),
  };
}
