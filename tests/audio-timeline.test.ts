import { expect, it } from "vitest";
import { audioFeatures } from "../packages/ai/audio/features";
import { analyzeAudio, audioTimelineSchema } from "../packages/ai/audio/timeline";
import { place, synthesize } from "../packages/ai/audio/synth";

// Ground truth built in code: a drum pattern whose tempo changes, two impacts, a silence, a
// riser into a louder section. Every expected time below is the time a sound was placed.
const RATE = 22050;
function track() {
  const ms = 12000,
    left = new Float32Array((RATE * ms) / 1000),
    beats: number[] = [];
  // 120 BPM for 6 s, then 140 BPM: the tracker must follow the change.
  for (let t = 0; t < 6000; t += 500) beats.push(t);
  for (let t = 6000; t < 12000; t += 60000 / 140) beats.push(Math.round(t));
  const silence = [3500, 4000],
    impacts = [2000, 8357],
    riser = [9000, 10286];
  beats.forEach((t, k) => {
    if (t >= silence[0] && t < silence[1]) return;
    place(left, synthesize("kick", RATE, k + 1), RATE, t, t > riser[1] ? 0.9 : 0.6);
    if (k % 2 === 1) place(left, synthesize("snare", RATE, 100 + k), RATE, t, 0.5);
    place(left, synthesize("hat", RATE, 300 + k), RATE, t + 125, 0.2);
  });
  for (const t of impacts) place(left, synthesize("impact", RATE, 7 + t), RATE, t, 1);
  place(left, synthesize("riser", RATE, 9, riser[1] - riser[0]), RATE, riser[0], 0.6);
  // A louder, bass-heavy section after the riser.
  for (let i = Math.round((riser[1] * RATE) / 1000); i < left.length; i++) left[i] += 0.25 * Math.sin((2 * Math.PI * 55 * i) / RATE);
  for (let i = Math.round((silence[0] * RATE) / 1000); i < Math.round((silence[1] * RATE) / 1000); i++) left[i] = 0;
  const peak = left.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  for (let i = 0; i < left.length; i++) left[i] *= 0.9 / peak;
  const right = left.map((v, i) => v * (i > left.length / 2 ? 0.6 : 1));
  return { pcm: { rate: RATE, channels: [left, right] }, beats, silence, impacts, riser };
}
const near = (times: number[], t: number, tolerance: number) => times.some((x) => Math.abs(x - t) <= tolerance);

it("measures typed events, silence, a drifting beat and sections on one 10 ms clock", () => {
  const truth = track();
  const timeline = analyzeAudio(audioFeatures(truth.pcm), [{ text: "go", startMs: 5000, endMs: 5300, confidence: 0.9 }]);
  expect(audioTimelineSchema.parse(timeline)).toBeTruthy();
  const of = (kind: string) => timeline.events.filter((e) => e.kind === kind);
  // Both impacts, within 20 ms, typed as impacts.
  for (const t of truth.impacts) expect(near(of("impact").map((e) => e.timeMs), t, 20)).toBe(true);
  // The silence: it begins when the last sound before it has decayed (so at or before the gap in
  // the pattern) and ends within 20 ms of the next sound.
  const silence = of("silence").find((e) => e.timeMs <= truth.silence[0] && (e.endMs ?? 0) > truth.silence[0]);
  expect(silence).toBeTruthy();
  expect(Math.abs((silence!.endMs ?? 0) - truth.silence[1])).toBeLessThanOrEqual(20);
  // No impact is reported where none was placed.
  expect(of("impact").filter((e) => !near(truth.impacts, e.timeMs, 40)).length).toBeLessThanOrEqual(1);
  // Most placed drum hits are found within 30 ms (an attack at the very first sample has no
  // earlier frame to compare with and is excluded).
  const attacks = timeline.events.filter((e) => ["kick", "bass_hit", "impact", "onset", "snare"].includes(e.kind)).map((e) => e.timeMs);
  const audible = truth.beats.filter((t) => t > 0 && (t < truth.silence[0] || t >= truth.silence[1]));
  expect(audible.filter((t) => near(attacks, t, 30)).length / audible.length).toBeGreaterThan(0.85);
  // Beats follow the tempo change: about 120 BPM early, about 140 BPM late.
  const early = timeline.tempo.filter((p) => p.timeMs > 1000 && p.timeMs < 3300).map((p) => p.bpm),
    late = timeline.tempo.filter((p) => p.timeMs > 7000 && p.timeMs < 11500).map((p) => p.bpm);
  const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
  expect(Math.abs(median(early) - 120)).toBeLessThan(6);
  expect(Math.abs(median(late) - 140)).toBeLessThan(7);
  expect(timeline.beatConfidence).toBeGreaterThan(0.2);
  // The riser and the louder section after it.
  expect(of("riser").some((e) => e.timeMs >= truth.riser[0] - 300 && (e.endMs ?? 0) >= truth.riser[1] - 600)).toBe(true);
  expect(timeline.events.some((e) => (e.kind === "section" || e.kind === "drop") && Math.abs(e.timeMs - truth.riser[1]) <= 600)).toBe(true);
  // Stereo: the second half leans left.
  expect(timeline.stereo.balance).toBeGreaterThan(0.02);
  // Words keep their measured times; unmeasured properties are declared, not guessed.
  expect(of("word")[0]).toMatchObject({ text: "go", timeMs: 5000, endMs: 5300 });
  expect(timeline.capabilities.notMeasured).toContain("reverb and delay");
});

it("reports no beats and no events in silence", () => {
  const timeline = analyzeAudio(audioFeatures({ rate: RATE, channels: [new Float32Array(RATE * 4)] }));
  expect(timeline.beats).toHaveLength(0);
  expect(timeline.events.filter((e) => e.kind !== "silence")).toHaveLength(0);
});
