import { describe, expect, it } from "vitest";
import { newClip, newProject, parseProject, type Asset } from "../packages/project-schema";
import { History } from "../packages/commands";
import { previewEditPlan, applyEditPreview, type EditorPlan } from "../packages/ai/editor-agent/execution";
import { parseEditBrief } from "../packages/ai/rough-cut/model";
import { toolEdit } from "../packages/ai/editor-agent/registry";
import { audioFeatures } from "../packages/ai/audio/features";
import { analyzeAudio, type AudioTimeline } from "../packages/ai/audio/timeline";
import { place, synthesize } from "../packages/ai/audio/synth";
import { buildEventGraph, eventGraphSchema } from "../packages/ai/reference/event-graph";
import { alignReplacement, beatMapOf, plannedSounds, retimeDna, retimer } from "../packages/ai/reference/audio-structure";
import { beatMapSchema } from "../packages/ai/media-analysis/model";
import type { StyleDNA } from "../packages/ai/reference/dna";

// Ground truth built in code. Nothing below names a reference; every time is where a sound or a
// visual event was placed.
const RATE = 22050;
function measure(ms: number, kicksFrom: number, impacts: number[], words: { text: string; startMs: number; endMs: number }[] = []) {
  const left = new Float32Array((RATE * ms) / 1000);
  for (let t = kicksFrom, k = 0; t < ms - 300; t += 500, k++) place(left, synthesize("kick", RATE, k + 1), RATE, t, 0.55);
  for (const t of impacts) place(left, synthesize("impact", RATE, 7 + t), RATE, t, 1);
  const peak = left.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  for (let i = 0; i < left.length; i++) left[i] *= 0.9 / peak;
  return analyzeAudio(audioFeatures({ rate: RATE, channels: [left, left.slice()] }), words);
}
const shots = (cuts: number[], end: number) => [0, ...cuts].map((startMs, i) => ({ startMs, endMs: cuts[i] ?? end }));
// Only the fields the event graph reads; the rest of a measured DNA is irrelevant here.
const dnaOf = (cuts: number[], extra: Partial<StyleDNA> = {}) =>
  ({ shots: shots(cuts, 8000), transitions: [], text: [], colorPulses: [], ...extra }) as unknown as StyleDNA;

let reference: AudioTimeline;
const referenceAudio = () => (reference ??= measure(8000, 0, [2000, 6000], [{ text: "lift", startMs: 3000, endMs: 3400 }]));

describe("audio/visual event graph", () => {
  it("links each visual event to the sound that triggers it, keeping the measured offset", () => {
    const audio = referenceAudio();
    const dna = dnaOf([2000, 4000, 6010], {
      colorPulses: [{ startMs: 2000, endMs: 2100 }] as StyleDNA["colorPulses"],
      text: [{ content: "LIFT HEAVY", startMs: 3000, endMs: 3900 }] as unknown as StyleDNA["text"],
    });
    const graph = eventGraphSchema.parse(buildEventGraph(dna, audio));
    const link = (id: string) => graph.links.find((l) => l.visualId === id)!;
    expect(link("cut_1")).toMatchObject({ relation: "on" });
    expect(["impact", "drop"]).toContain(link("cut_1").inferred.anchor);
    expect(Math.abs(link("cut_1").offsetMs)).toBeLessThanOrEqual(30);
    // 10 ms late is still "on", and the 10 ms is kept as measured.
    expect(link("cut_3")).toMatchObject({ relation: "on" });
    expect(link("cut_3").offsetMs).toBeGreaterThanOrEqual(-20);
    expect(link("cut_3").offsetMs).toBeLessThanOrEqual(40);
    // A cut on a plain beat is linked to the beat (or the kick on it), not to a distant impact.
    expect(["beat", "downbeat", "kick", "onset"]).toContain(link("cut_2").inferred.anchor);
    // The title that contains a sung word starts on that word.
    expect(link("title_1_in").inferred.anchor).toBe("word_match");
    expect(["impact", "drop"]).toContain(link("pulse_1").inferred.anchor);
    expect(graph.grammar.cut.on).toBe(1);
    // Measured and inferred values are kept apart.
    expect(typeof link("cut_1").measured.deltaMs).toBe("number");
    expect(typeof link("cut_1").inferred.rule).toBe("string");
  });

  it("calls a cut between beats offbeat and an isolated one unanchored", () => {
    const audio = referenceAudio();
    const graph = buildEventGraph(dnaOf([5250]), audio);
    expect(["offbeat", "unanchored"]).toContain(graph.links[0].relation);
    expect(graph.links[0].relation).not.toBe("on");
  });
});

describe("recreating the audio structure on other music", () => {
  // The replacement: the same beat a quarter-second out of phase, impacts 1.25 s and 1.3 s later.
  const replacement = () => measure(12000, 250, [3250, 7300]);
  it("finds the offset where the replacement's events line up and moves linked cuts onto them", () => {
    const audio = referenceAudio(),
      graph = buildEventGraph(dnaOf([2000, 6000]), audio),
      alignment = alignReplacement(graph, replacement(), 8000, 0);
    expect(Math.abs(alignment.offsetMs - 1250)).toBeLessThanOrEqual(60);
    const second = alignment.moves.find((m) => m.visualId === "cut_2")!;
    expect(second).toBeTruthy();
    // 7300 in the replacement is 7300 − offset on the edit's clock.
    expect(Math.abs(second.toMs - (7300 - alignment.offsetMs))).toBeLessThanOrEqual(40);
  });
  it("retimes monotonically through the moves and never moves the interval start", () => {
    const r = retimer([{ visualId: "cut_1", fromMs: 2000, toMs: 2100, anchor: "impact", replacement: "impact", distanceMs: 0 }], 34, 0);
    expect(r(0)).toBe(0);
    expect(r(1000)).toBeCloseTo(1050, 5);
    expect(r(2000)).toBe(2100);
    expect(r(3000)).toBe(3100);
    const dna = retimeDna(dnaOf([2000, 4000]), r);
    expect(dna.shots.map((s) => s.startMs)).toEqual([0, 2100, 4100]);
  });
  it("plans generated effects only for linked sounds the replacement lacks", () => {
    const audio = referenceAudio(),
      graph = buildEventGraph(dnaOf([2000, 6000]), audio);
    const kicksOnly = measure(12000, 0, []);
    const planned = plannedSounds(graph, audio, kicksOnly, alignReplacement(graph, kicksOnly, 8000, 0), 0);
    expect(planned.filter((s) => s.kind === "impact").length).toBeGreaterThanOrEqual(2);
    const covered = plannedSounds(graph, audio, replacement(), alignReplacement(graph, replacement(), 8000, 0), 0);
    expect(covered.filter((s) => s.kind === "impact").length).toBeLessThan(planned.filter((s) => s.kind === "impact").length);
  });
  it("offers the measured beats to the beat-snapping modes in the existing beat-map form", () => {
    const map = beatMapSchema.parse(beatMapOf(referenceAudio()));
    expect(map.beats.length).toBeGreaterThan(10);
    expect(Math.abs((map.bpm ?? 0) - 120)).toBeLessThan(6);
  });
});

describe("editable audio events", () => {
  const asset: Asset = { id: "video", name: "raw.mp4", kind: "video", path: "raw.mp4", size: 10, duration: 20, width: 640, height: 480, fps: 30, codec: "h264", hasAudio: true, fingerprint: "raw" };
  const sound: Asset = { id: "generated-1", name: "supp-generated-impact.wav", kind: "audio", path: "impact.wav", size: 10, duration: 1.4, width: 0, height: 0, fps: 0, codec: "pcm_s16le", hasAudio: true, fingerprint: "impact" };
  function setup() {
    const p = newProject();
    p.assets = [asset];
    const plan: EditorPlan = {
      id: "plan",
      projectId: p.id,
      revision: 0,
      compositionId: null,
      resultCompositionId: "sequence",
      processing: "LOCAL",
      summary: "Audio events",
      commands: [
        { tool: "asset.add", asset: sound },
        {
          tool: "sequence.create",
          id: "sequence",
          name: "Events",
          settings: p.settings,
          duration: 180,
          videoTrackId: "shots",
          audioTrackId: "music",
          ai: {
            plannerVersion: "reference-edit-1",
            createdAt: new Date().toISOString(),
            brief: parseEditBrief("Recreate"),
            evidence: [],
            warnings: [],
            audioMode: "recreate",
            audioNotes: ["Generated impact at 2.000 s: the replacement has none there."],
            referenceEvents: [{ markerId: "m1", anchorKind: "impact", anchorMs: 2000, confidence: 0.9, links: [{ layerId: "b", visual: "cut", relation: "on", offsetMs: 0 }, { layerId: "pulse", visual: "pulse", relation: "on", offsetMs: 0 }] }],
          },
        },
        { tool: "sequence.insert", sequenceId: "sequence", clipId: "a", trackId: "shots", assetId: asset.id, fingerprint: asset.fingerprint, startFrame: 0, sourceIn: 0, duration: 60, gain: 0 },
        { tool: "sequence.insert", sequenceId: "sequence", clipId: "b", trackId: "shots", assetId: asset.id, fingerprint: asset.fingerprint, startFrame: 60, sourceIn: 200, duration: 60, gain: 0 },
        { tool: "sequence.audioTrack", sequenceId: "sequence", trackId: "sfx", name: "Recreated SFX" },
        { tool: "sequence.insert", sequenceId: "sequence", clipId: "boom", trackId: "sfx", assetId: sound.id, fingerprint: sound.fingerprint, startFrame: 60, sourceIn: 0, duration: 40, gain: -6 },
        { tool: "sequence.marker", sequenceId: "sequence", id: "m1", frame: 60, name: "impact → cut, pulse" },
      ],
    };
    const history = new History(p);
    const applied = structuredClone(history.execute(p, "Apply", applyEditPreview(previewEditPlan(plan, p, 0), p, 0)));
    // A generated pulse and its ink, as the planner emits them.
    const c = applied.compositions.find((c) => c.id === "sequence")!;
    const shotsTrack = c.tracks.find((t) => t.kind === "video")!;
    c.tracks.push({ ...shotsTrack, id: "pulses", name: "Pulses" }, { ...shotsTrack, id: "ink-track", name: "Pulse ink" });
    c.layers.push(Object.assign(newClip("pulses", 60, 6, "shape"), { id: "pulse" }), Object.assign(newClip("ink-track", 60, 6, "shape"), { id: "pulse-ink" }));
    return { applied, history };
  }
  it("adds a generated sound to the library once, and refuses a different file under the same ID", () => {
    const { applied } = setup();
    expect(applied.assets.filter((a) => a.id === sound.id).length).toBe(1);
    const again = structuredClone(applied);
    toolEdit({ tool: "asset.add", asset: sound })(again);
    expect(again.assets.filter((a) => a.id === sound.id).length).toBe(1);
    expect(() => toolEdit({ tool: "asset.add", asset: { ...sound, fingerprint: "other" } })(structuredClone(applied))).toThrow();
  });
  it("moves an event with its linked cut (rolled), pulse and ink, or the marker alone", () => {
    const { applied } = setup();
    const linked = structuredClone(applied);
    toolEdit({ tool: "sequence.moveEvent", sequenceId: "sequence", markerId: "m1", frames: 3, linked: true })(linked);
    const c = linked.compositions.find((c) => c.id === "sequence")!,
      layer = (id: string) => c.layers.find((l) => l.id === id)!;
    expect(c.markers?.find((m) => m.id === "m1")?.frame).toBe(63);
    // Roll: the edit point moves, both shots stay in sync with their sources.
    expect(layer("a").duration).toBe(63);
    expect(layer("b").start).toBe(63);
    expect(layer("b").duration).toBe(57);
    expect(layer("b").sourceIn).toBe(203);
    expect(layer("pulse").start).toBe(63);
    expect(layer("pulse-ink").start).toBe(63);
    // Unlinked: only the marker.
    const alone = structuredClone(applied);
    toolEdit({ tool: "sequence.moveEvent", sequenceId: "sequence", markerId: "m1", frames: -2, linked: false })(alone);
    const d = alone.compositions.find((c) => c.id === "sequence")!;
    expect(d.markers?.find((m) => m.id === "m1")?.frame).toBe(58);
    expect(d.layers.find((l) => l.id === "b")!.start).toBe(60);
    expect(() => toolEdit({ tool: "sequence.moveEvent", sequenceId: "sequence", markerId: "m1", frames: -100, linked: true })(structuredClone(applied))).toThrow();
  });
  it("saves and reopens the audio plan, event links and generated sound clip unchanged", () => {
    const { applied } = setup();
    const reopened = parseProject(JSON.parse(JSON.stringify(applied)));
    const c = reopened.compositions.find((c) => c.id === "sequence")!;
    expect(c.ai?.audioMode).toBe("recreate");
    expect(c.ai?.referenceEvents?.[0].links.map((l) => l.layerId)).toEqual(["b", "pulse"]);
    expect(c.layers.find((l) => l.id === "boom")).toMatchObject({ assetId: sound.id, start: 60, duration: 40, gain: -6 });
    expect(JSON.parse(JSON.stringify(reopened.compositions))).toEqual(JSON.parse(JSON.stringify(applied.compositions)));
  });
  it("reproduces a measured letterbox as editable black bars on their own top track", () => {
    const { applied } = setup();
    const p = structuredClone(applied);
    toolEdit({ tool: "sequence.letterbox", sequenceId: "sequence", trackId: "bars", id: "lb", start: 0, duration: 120, top: 0.125, bottom: 0.125, left: 0, right: 0 })(p);
    const c = p.compositions.find((c) => c.id === "sequence")!;
    const { width, height } = c.settings;
    const top = c.layers.find((l) => l.id === "lb-top")!,
      bottom = c.layers.find((l) => l.id === "lb-bottom")!;
    // Each bar on its own top-of-stack video track, so tracks never hold overlapping clips.
    expect(top.trackId).toBe("bars");
    expect(bottom.trackId).toBe("bars-bottom");
    expect(c.tracks.slice(0, 2).map((t) => t.kind)).toEqual(["video", "video"]);
    expect(c.tracks.slice(0, 2).map((t) => t.id).sort()).toEqual(["bars", "bars-bottom"]);
    expect(top.shape).toMatchObject({ type: "rectangle", color: "#000000", width, height: Math.round(0.125 * height) });
    // Centred offsets: the top bar's upper edge meets the frame's upper edge.
    expect(top.transform.y - top.shape!.height / 2).toBeCloseTo(-height / 2, 0);
    expect(bottom.transform.y + bottom.shape!.height / 2).toBeCloseTo(height / 2, 0);
    expect(c.layers.some((l) => l.id === "lb-left" || l.id === "lb-right")).toBe(false);
    expect(() => toolEdit({ tool: "sequence.letterbox", sequenceId: "sequence", trackId: "bars", id: "lb", start: 0, duration: 120, top: 0.1, bottom: 0.1, left: 0, right: 0 })(p)).toThrow();
  });
});
