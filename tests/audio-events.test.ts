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
import { beatMapOf, plannedSounds, retimeDna, retimer, synthPeakDb } from "../packages/ai/reference/audio-structure";
import { alignStructure } from "../packages/ai/reference/structural-alignment";
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
/** Kicks every beatMs from 0 and impacts where given (another tempo). */
function measureBeats(ms: number, beatMs: number, impacts: number[]) {
  const left = new Float32Array((RATE * ms) / 1000);
  for (let t = 0, k = 0; t < ms - 300; t += beatMs, k++) place(left, synthesize("kick", RATE, k + 1), RATE, t, 0.55);
  for (const t of impacts) place(left, synthesize("impact", RATE, 7 + t), RATE, t, 1);
  const peak = left.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  for (let i = 0; i < left.length; i++) left[i] *= 0.9 / peak;
  return analyzeAudio(audioFeatures({ rate: RATE, channels: [left, left.slice()] }));
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
  // Reference: 120 BPM, impacts on beats 4 and 12. Replacement: 90 BPM, impacts on beats 6 and 14,
  // so the same musical relationship sits at different absolute times.
  const slower = () => measureBeats(14000, 667, [4000, 9333]);
  it("maps linked cuts onto the replacement's impacts by musical position, keeping measured offsets", () => {
    const audio = referenceAudio();
    const graph = buildEventGraph(dnaOf([2000, 6000], { text: [{ content: "GO", startMs: 1920, endMs: 2600 }] as unknown as StyleDNA["text"] }), audio);
    const al = alignStructure(graph, audio, slower(), 0, 8000);
    expect(al.method).toBe("beats");
    expect(Math.abs(al.offsetMs - 1333)).toBeLessThanOrEqual(80);
    const move = (id: string) => al.moves.find((m) => m.visualId === id)!;
    expect(move("cut_1")).toMatchObject({ status: "anchored" });
    expect(["impact", "drop", "bass_hit"]).toContain(move("cut_1").replacement);
    expect(Math.abs(move("cut_1").toMs - (4000 - al.offsetMs))).toBeLessThanOrEqual(40);
    expect(Math.abs(move("cut_2").toMs - (9333 - al.offsetMs))).toBeLessThanOrEqual(40);
    // The title entered about 80 ms before the first impact and still does.
    const title = move("title_1_in");
    expect(title.relation).toBe("before");
    expect(Math.abs(move("cut_1").toMs - title.toMs - (move("cut_1").offsetMs - title.offsetMs))).toBeLessThanOrEqual(20);
    // Reasons are recorded and no event moves before an earlier one.
    expect(move("cut_1").reasons?.type).toBeGreaterThan(0.5);
    for (let i = 1; i < al.moves.length; i++) expect(al.moves[i].toMs).toBeGreaterThanOrEqual(al.moves[i - 1].toMs);
    expect(al.sections.length).toBeGreaterThan(0);
  });
  it("lands a lyric cue on the rhythm when the replacement has no vocals, at lower confidence", () => {
    const audio = referenceAudio();
    const graph = buildEventGraph(dnaOf([2000], { text: [{ content: "LIFT", startMs: 3000, endMs: 3600 }] as unknown as StyleDNA["text"] }), audio);
    const title = alignStructure(graph, audio, slower(), 0, 8000).moves.find((m) => m.visualId === "title_1_in")!;
    expect(title.status).toBe("anchored");
    expect(title.reasons!.type).toBeLessThan(1);
  });
  it("reports a visual event whose trigger has no counterpart instead of keeping its old time", () => {
    // A title that ends where a silence starts; the replacement never falls silent.
    const left = new Float32Array(RATE * 8);
    for (let t = 0, k = 0; t < 7700; t += 500, k++) if (t < 3000 || t >= 4500) place(left, synthesize("kick", RATE, k + 1), RATE, t, 0.55);
    const audio = analyzeAudio(audioFeatures({ rate: RATE, channels: [left, left.slice()] }));
    const silence = audio.events.find((e) => e.kind === "silence")!;
    const graph = buildEventGraph(dnaOf([2000], { text: [{ content: "WAIT", startMs: silence.timeMs - 600, endMs: silence.timeMs }] as unknown as StyleDNA["text"] }), audio);
    // The replacement is a steady tone: no attacks, beats, sections or silences to map onto.
    const tone = new Float32Array(RATE * 14);
    for (let i = 0; i < tone.length; i++) tone[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    const flat = analyzeAudio(audioFeatures({ rate: RATE, channels: [tone, tone.slice()] }));
    const al = alignStructure(graph, audio, flat, 0, 8000);
    const title = al.moves.find((m) => m.visualId === "title_1_out")!;
    expect(title.anchor).toBe("silence_start");
    expect(title.status).toBe("no-replacement");
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
  it("plans effects the replacement lacks at the reference level relative to its music, never above -3 dBFS", () => {
    const audio = referenceAudio(),
      graph = buildEventGraph(dnaOf([2000, 6000]), audio);
    const kicksOnly = measureBeats(14000, 667, []);
    const planned = plannedSounds(graph, audio, kicksOnly, alignStructure(graph, audio, kicksOnly, 0, 8000), 0, -12);
    const impacts = planned.filter((s) => s.kind === "impact");
    expect(impacts.length).toBeGreaterThanOrEqual(2);
    for (const s of impacts) {
      expect(s.relativeGainDb).toBeGreaterThan(0);
      expect(s.gainDb + synthPeakDb("impact")).toBeLessThanOrEqual(-3 + 1e-6);
      expect(s.attackMs).toBeGreaterThan(0);
      expect(s.releaseMs).toBeGreaterThan(0);
    }
    const covered = plannedSounds(graph, audio, slower(), alignStructure(graph, audio, slower(), 0, 8000), 0, -12);
    expect(covered.filter((s) => s.kind === "impact").length).toBeLessThan(impacts.length);
  });
  it("offers the measured beats to the beat-snapping modes in the existing beat-map form", () => {
    const map = beatMapSchema.parse(beatMapOf(referenceAudio()));
    expect(map.beats.length).toBeGreaterThan(10);
    expect(Math.abs((map.bpm ?? 0) - 120)).toBeLessThan(6);
  });
});

describe("tempo octave, downbeats, drops", () => {
  it("does not double the tempo when hats sit between kicks, keeps the alternative and finds the bar", () => {
    const left = new Float32Array(RATE * 12),
      beat = 625;
    for (let t = 0, k = 0; t < 11500; t += beat, k++) {
      place(left, synthesize("kick", RATE, k + 1), RATE, t, k % 4 ? 0.35 : 0.5);
      place(left, synthesize("hat", RATE, 50 + k), RATE, t + beat / 2, 0.15);
    }
    const a = analyzeAudio(audioFeatures({ rate: RATE, channels: [left, left.slice()] }));
    const bpms = a.tempo.map((t) => t.bpm).sort((x, y) => x - y);
    expect(Math.abs(bpms[bpms.length >> 1] - 96)).toBeLessThan(5);
    expect(a.tempoHypotheses?.[0].bpm).toBeLessThan(110);
    const downbeats = a.beats.filter((b) => b.downbeat).map((b) => b.timeMs);
    expect(downbeats.length).toBeGreaterThan(2);
    expect(downbeats.every((t) => Math.abs(((t + 1250) % 2500) - 1250) <= 60)).toBe(true);
  });
  it("finds a drop where sub-bass and level rise after a build, and none when music returns after a silence", () => {
    const left = new Float32Array(RATE * 12);
    for (let t = 0, k = 0; t < 11500; t += 500, k++) place(left, synthesize("kick", RATE, k + 1), RATE, t, t >= 6000 ? 0.8 : 0.45);
    place(left, synthesize("riser", RATE, 3, 2000), RATE, 4000, 0.4);
    for (let i = 6000 * (RATE / 1000); i < left.length; i++) left[i] += 0.2 * Math.sin((2 * Math.PI * 50 * i) / RATE);
    const a = analyzeAudio(audioFeatures({ rate: RATE, channels: [left, left.slice()] }));
    const drops = a.events.filter((e) => e.kind === "drop");
    expect(drops.length).toBe(1);
    expect(Math.abs(drops[0].timeMs - 6000)).toBeLessThanOrEqual(100);
    const gap = new Float32Array(RATE * 10);
    for (let t = 0, k = 0; t < 9500; t += 500, k++) if (t < 4000 || t >= 5500) place(gap, synthesize("kick", RATE, k + 1), RATE, t, 0.5);
    const b = analyzeAudio(audioFeatures({ rate: RATE, channels: [gap, gap.slice()] }));
    expect(b.events.filter((e) => e.kind === "drop").length).toBe(0);
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
