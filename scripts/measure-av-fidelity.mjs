// Audio and audio/visual fidelity of a render against its reference, per category.
// Usage: node scripts/measure-av-fidelity.mjs --reference=REF.mp4 --render=OUT.mp4
//          [--start=MS --end=MS] [--mode=reference|recreate|music] [--truth=truth.json] [--out=report.json]
// Both soundtracks are decoded by ffmpeg and measured by the application's own audio analysis
// (packages/ai/audio). Pictures are decoded small and grey; cuts and flashes are found from frame
// differences. With --truth (a generated corpus case), the reference measurement itself is scored
// against the placed events, which is the detector's accuracy rather than the edit's.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { mediaEnvironment } from "./runtime.mjs";
const option = (name) => process.argv.find((a) => a.startsWith("--" + name + "="))?.slice(name.length + 3);
const reference = option("reference"),
  render = option("render"),
  mode = option("mode") ?? "reference",
  start = Number(option("start") ?? 0),
  truthFile = option("truth");
if (!reference || !render) throw Error("Supply --reference and --render.");
const env = mediaEnvironment(),
  ffmpeg = env.SUPP_FFMPEG || "ffmpeg",
  probe = env.SUPP_FFPROBE || "ffprobe";
const duration = (file) => Number(execFileSync(probe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { env }).toString().trim()) * 1000;
const renderMs = duration(render),
  end = Number(option("end") ?? start + renderMs);
const span = Math.min(end - start, renderMs);
const RATE = 22050,
  FPS = 30;
function pcm(file, from, ms) {
  const bytes = execFileSync(ffmpeg, ["-v", "error", "-ss", String(from / 1000), "-i", file, "-t", String(ms / 1000), "-map", "0:a:0", "-ac", "2", "-ar", String(RATE), "-f", "s16le", "pipe:1"], { env, maxBuffer: 1 << 30 });
  const s = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1),
    n = s.length >> 1,
    l = new Float32Array(n),
    r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = s[2 * i] / 32768;
    r[i] = s[2 * i + 1] / 32768;
  }
  return { rate: RATE, channels: [l, r] };
}
function frames(file, from, ms) {
  const W = 48,
    H = 48;
  const bytes = execFileSync(ffmpeg, ["-v", "error", "-ss", String(from / 1000), "-i", file, "-t", String(ms / 1000), "-vf", `fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "pipe:1"], { env, maxBuffer: 1 << 30 });
  const out = [];
  for (let o = 0; o + W * H <= bytes.length; o += W * H) out.push(bytes.subarray(o, o + W * H));
  return out;
}
/** Cuts and flashes from frame differences. A flash is a sudden near-white frame; a cut through a
 * flash compares the frames on either side of it. */
function visual(f) {
  const mean = f.map((x) => x.reduce((a, b) => a + b, 0) / x.length);
  const flash = mean.map((m, i) => i > 0 && m >= 232 && mean[i - 1] < 200);
  for (let i = 1; i < f.length; i++) if (flash[i - 1] && mean[i] >= 232) flash[i] = true;
  const diff = [0];
  let last = 0;
  for (let i = 1; i < f.length; i++) {
    if (flash[i]) {
      diff.push(0);
      continue;
    }
    let d = 0;
    for (let k = 0; k < f[i].length; k++) d += Math.abs(f[i][k] - f[last][k]);
    diff.push(d / f[i].length);
    last = i;
  }
  const cuts = [];
  for (let i = 1; i < diff.length; i++) {
    const near = diff.slice(Math.max(1, i - 7), i).concat(diff.slice(i + 1, i + 8)).filter((d) => d > 0).sort((a, b) => a - b);
    const median = near.length ? near[near.length >> 1] : 0;
    if (diff[i] > 18 && diff[i] > 3 * median + 4) {
      // A cut through a flash is placed at the flash's first frame.
      let at = i;
      while (at > 1 && flash[at - 1]) at--;
      cuts.push(Math.round((at * 1000) / FPS));
    }
  }
  const flashes = flash.flatMap((x, i) => (x && !flash[i - 1] ? [Math.round((i * 1000) / FPS)] : []));
  return { cuts, flashes, frames: f.length };
}
const fmeasure = (truth, found, tolerance) => {
  const used = new Set();
  let hit = 0;
  const errors = [];
  for (const t of truth) {
    let best = -1;
    for (let k = 0; k < found.length; k++) if (!used.has(k) && Math.abs(found[k] - t) <= tolerance && (best < 0 || Math.abs(found[k] - t) < Math.abs(found[best] - t))) best = k;
    if (best >= 0) {
      used.add(best);
      hit++;
      errors.push(found[best] - t);
    }
  }
  const precision = found.length ? hit / found.length : truth.length ? 0 : 1,
    recall = truth.length ? hit / truth.length : 1;
  const sorted = errors.map(Math.abs).sort((a, b) => a - b);
  return { truth: truth.length, found: found.length, matched: hit, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f: +(precision + recall ? (2 * precision * recall) / (precision + recall) : 0).toFixed(3), medianAbsErrorMs: sorted.length ? sorted[sorted.length >> 1] : null };
};
const pearson = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n,
    mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return +(sab / Math.sqrt(saa * sbb || 1)).toFixed(3);
};
/** Lag (ms) that best aligns two onset envelopes, searched within ±maxMs; positive: b is late. */
const lag = (a, b, hopMs, maxMs = 300) => {
  let best = { lag: 0, score: -Infinity };
  const m = Math.round(maxMs / hopMs);
  for (let k = -m; k <= m; k++) {
    let s = 0;
    for (let i = 0; i < a.length; i++) if (i + k >= 0 && i + k < b.length) s += a[i] * b[i + k];
    if (s > best.score) best = { lag: k * hopMs, score: s };
  }
  return best.lag;
};
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
try {
  const { audioFeatures } = await host.ssrLoadModule("/packages/ai/audio/features.ts");
  const { analyzeAudio } = await host.ssrLoadModule("/packages/ai/audio/timeline.ts");
  const { buildEventGraph, audioAnchors } = await host.ssrLoadModule("/packages/ai/reference/event-graph.ts");
  const { families } = await host.ssrLoadModule("/packages/ai/reference/structural-alignment.ts");
  const { beatClock, segmentsOf } = await host.ssrLoadModule("/packages/ai/audio/structure.ts");
  const refFeatures = audioFeatures(pcm(reference, start, span)),
    outFeatures = audioFeatures(pcm(render, 0, span));
  const refAudio = analyzeAudio(refFeatures),
    outAudio = analyzeAudio(outFeatures);
  const refVisual = visual(frames(reference, start, span)),
    outVisual = visual(frames(render, 0, span));
  const transient = (a) => a.events.filter((e) => ["onset", "kick", "snare", "impact", "bass_hit", "drop"].includes(e.kind)).map((e) => e.timeMs);
  const impacts = (a) => a.events.filter((e) => ["impact", "drop", "bass_hit"].includes(e.kind)).map((e) => e.timeMs);
  const env100 = (a) => a.loudness.map((l) => l.db);
  const half = Math.floor(refFeatures.flux.length / 2);
  const report = { reference, render, mode, interval: { startMs: start, endMs: start + span }, categories: {} };
  const cat = report.categories;
  if (mode === "reference") {
    // The same soundtrack should come back, in time.
    cat.audio = {
      onsets: fmeasure(transient(refAudio), transient(outAudio), 50),
      beats: fmeasure(refAudio.beats.map((b) => b.timeMs), outAudio.beats.map((b) => b.timeMs), 70),
      transients: fmeasure(impacts(refAudio), impacts(outAudio), 100),
      loudnessEnvelopeCorrelation: pearson(env100(refAudio), env100(outAudio)),
      meanLoudnessDifferenceDb: +(env100(outAudio).reduce((a, b) => a + b, 0) / Math.max(1, env100(outAudio).length) - env100(refAudio).reduce((a, b) => a + b, 0) / Math.max(1, env100(refAudio).length)).toFixed(2),
      lagMs: lag(refFeatures.flux, outFeatures.flux, 10),
      driftMs: lag(refFeatures.flux.slice(half), outFeatures.flux.slice(half), 10) - lag(refFeatures.flux.slice(0, half), outFeatures.flux.slice(0, half), 10),
    };
  } else {
    // Different music: the structure, not the waveform, should carry over.
    const refBeats = refAudio.beats.length > 1 ? (refAudio.beats.at(-1).timeMs - refAudio.beats[0].timeMs) / (refAudio.beats.length - 1) : null,
      outBeats = outAudio.beats.length > 1 ? (outAudio.beats.at(-1).timeMs - outAudio.beats[0].timeMs) / (outAudio.beats.length - 1) : null;
    cat.audio = {
      referenceTransients: impacts(refAudio).length,
      renderTransients: impacts(outAudio).length,
      referenceBeatPeriodMs: refBeats && Math.round(refBeats),
      renderBeatPeriodMs: outBeats && Math.round(outBeats),
      loudnessEnvelopeCorrelation: pearson(env100(refAudio), env100(outAudio)),
      transientsAtReferenceTransients: fmeasure(impacts(refAudio), impacts(outAudio), 100),
    };
  }
  cat.cuts = { ...fmeasure(refVisual.cuts, outVisual.cuts, 34), withinTwoFrames: fmeasure(refVisual.cuts, outVisual.cuts, 67).f, reference: refVisual.cuts, render: outVisual.cuts };
  cat.flashes = { ...fmeasure(refVisual.flashes, outVisual.flashes, 67), reference: refVisual.flashes, render: outVisual.flashes };
  // Cut-to-audio relations on each side, measured with the same event graph.
  const dnaOf = (cuts, ms) => ({ shots: [0, ...cuts].map((s, i) => ({ startMs: s, endMs: cuts[i] ?? ms })), transitions: [], text: [], colorPulses: [] });
  const refGraph = buildEventGraph(dnaOf(refVisual.cuts, span), refAudio),
    outGraph = buildEventGraph(dnaOf(outVisual.cuts, span), outAudio);
  const relations = (g) => g.grammar.cut ?? {};
  const delta = (k) => (relations(refGraph)[k] !== undefined && relations(outGraph)[k] !== undefined ? +Math.abs(relations(refGraph)[k] - relations(outGraph)[k]).toFixed(3) : null);
  // A/V sync inside the render: cuts the reference makes on a sound should sit on a sound here.
  const onCuts = outGraph.links.filter((l) => l.relation === "on").map((l) => Math.abs(l.offsetMs)).sort((a, b) => a - b);
  cat.cutToAudio = {
    reference: relations(refGraph),
    render: relations(outGraph),
    onDifference: delta("on"),
    onTransientDifference: delta("onTransient"),
    renderOnCutMedianAbsOffsetMs: onCuts.length ? onCuts[onCuts.length >> 1] : null,
  };
  const projectFile = option("project");
  if (projectFile) {
    // The edit's own events, exactly: cut points of the picture track, title and pulse starts.
    const project = JSON.parse(fs.readFileSync(projectFile, "utf8").replace(/^\uFEFF/, ""));
    const c = project.compositions.at(-1),
      rate = c.settings?.fps ?? project.settings.fps,
      fps = rate ? rate.num / rate.den : 30,
      ms = (frame) => Math.round((frame * 1000) / fps);
    const pictureTrack = [...new Set(c.layers.filter((l) => l.kind === "media" && project.assets.find((a) => a.id === l.assetId)?.kind === "video").map((l) => l.trackId))]
      .map((t) => ({ t, n: c.layers.filter((l) => l.trackId === t && l.kind === "media").length }))
      .sort((x, y) => y.n - x.n)[0]?.t;
    const cuts = c.layers.filter((l) => l.trackId === pictureTrack && l.start > 0).map((l) => ms(l.start)).sort((x, y) => x - y);
    const dna = {
      ...dnaOf(cuts, span),
      text: c.layers.filter((l) => l.kind === "text" && l.text?.content).map((l) => ({ content: l.text.content, startMs: ms(l.start), endMs: ms(l.start + l.duration) })),
      colorPulses: c.layers.filter((l) => /pulse/i.test(l.name) && !l.id.endsWith("-ink")).map((l) => ({ startMs: ms(l.start), endMs: ms(l.start + l.duration) })),
    };
    const g = buildEventGraph(dna, outAudio);
    const pick = (k) => g.grammar[k] && { count: g.grammar[k].count, on: g.grammar[k].on, before: g.grammar[k].before, after: g.grammar[k].after, offbeat: g.grammar[k].offbeat, unanchored: g.grammar[k].unanchored, onTransient: g.grammar[k].onTransient };
    const onOffsets = g.links.filter((l) => l.relation === "on").map((l) => Math.abs(l.offsetMs)).sort((x, y) => x - y);
    // ---- Structural fidelity: does each visual event keep its measured relationship (relation and
    // offset to a sound of the same family) in the exported audio? Judged per visual kind.
    const anchors = audioAnchors(outAudio);
    const tolerance = Math.max(45, 1.4 * (1000 / fps));
    const kept = { cut: [0, 0], title: [0, 0], pulse: [0, 0], other: [0, 0] };
    const layerById = new Map(c.layers.map((l) => [l.id, l]));
    for (const e of c.ai?.referenceEvents ?? [])
      for (const link of e.links) {
        const layer = layerById.get(link.layerId);
        if (!layer) continue;
        const kind = link.visual === "cut" ? "cut" : link.visual.startsWith("title") ? "title" : link.visual === "pulse" ? "pulse" : "other";
        const want = ms(layer.start) - link.offsetMs,
          family = families[e.anchorKind] ?? [e.anchorKind];
        kept[kind][1]++;
        if (anchors.some((a) => family.includes(a.kind) && Math.abs(a.timeMs - want) <= tolerance)) kept[kind][0]++;
      }
    const pct = ([a, b]) => (b ? +(a / b).toFixed(3) : null);
    const mapping = c.ai?.audioMapping ?? [];
    // Order: adapted times follow reference order.
    let inversions = 0;
    const byRef = [...mapping].sort((x, y) => x.referenceMs - y.referenceMs);
    for (let i = 1; i < byRef.length; i++) if (byRef[i].adaptedMs < byRef[i - 1].adaptedMs) inversions++;
    // Phrase position: where each anchored event sits in its bar/phrase, reference vs export.
    const R = beatClock(refAudio),
      O = beatClock(outAudio);
    const phraseErrors = mapping
      .filter((m) => m.status === "anchored")
      .map((m) => {
        const rb = R.barPosition(R.position(m.referenceMs - start)),
          ob = O.barPosition(O.position(m.adaptedMs - start));
        if (!rb || !ob) return undefined;
        const d = Math.abs(rb.phraseProgress - ob.phraseProgress);
        return Math.min(d, 1 - d);
      })
      .filter((v) => v !== undefined)
      .sort((x, y) => x - y);
    // Sections heard: labels of the reference excerpt and the export, in order.
    const labels = (a) => segmentsOf(a).map((sg) => sg.label);
    // Drops: each reference drop should have one in the export at its adapted time.
    const toAdapted = (refMs) => {
      const pts = byRef.map((m) => [m.referenceMs - start, m.adaptedMs - start]);
      if (!pts.length) return refMs;
      let lo = pts[0];
      for (const p of pts) if (p[0] <= refMs) lo = p;
      const hi = pts.find((p) => p[0] > refMs);
      return hi ? lo[1] + ((refMs - lo[0]) * (hi[1] - lo[1])) / Math.max(1, hi[0] - lo[0]) : lo[1] + (refMs - lo[0]);
    };
    const refDrops = refAudio.events.filter((e) => e.kind === "drop").map((e) => e.timeMs),
      outDrops = outAudio.events.filter((e) => e.kind === "drop").map((e) => e.timeMs);
    // Generated effects: measured level over the music in the export vs what the reference had.
    const sfxErrors = [];
    for (const note of c.ai?.audioNotes ?? []) {
      const m = /Generated (\w+) at ([\d.]+) s, (-?[\d.]+) dB \(reference ([+-]?[\d.]+) dB over its music/.exec(note);
      if (!m) continue;
      const at = Number(m[2]) * 1000,
        rising = m[1] === "riser" || m[1] === "whoosh";
      const layer = c.layers.find((l) => Math.abs(ms(l.start) - at) <= 40 && /supp-generated/.test(project.assets.find((a) => a.id === l.assetId)?.name ?? ""));
      const peakAt = layer && rising ? ms(layer.start + layer.duration) : at;
      const lv = (a, b) => outAudio.loudness.filter((p) => p.timeMs >= a && p.timeMs < b).map((p) => p.db).sort((x, y) => x - y);
      const peak = Math.max(...lv(peakAt - 150, peakAt + 400), -120),
        bedPts = lv(at - 2000, at - 300),
        bed = bedPts.length ? bedPts[bedPts.length >> 1] : NaN;
      if (Number.isFinite(bed)) sfxErrors.push({ kind: m[1], atMs: Math.round(at), referenceRelativeDb: Number(m[4]), exportRelativeDb: +(peak - bed).toFixed(1), errorDb: +(peak - bed - Number(m[4])).toFixed(1) });
    }
    cat.structural = {
      cutsAnchoredCorrectly: pct(kept.cut),
      titlesAnchoredCorrectly: pct(kept.title),
      pulsesAnchoredCorrectly: pct(kept.pulse),
      counts: { cuts: kept.cut, titles: kept.title, pulses: kept.pulse },
      mappingStatus: Object.fromEntries(["anchored", "no-replacement", "free"].map((k) => [k, mapping.filter((m) => m.status === k).length])),
      eventOrderInversions: inversions,
      phrasePositionErrorMedian: phraseErrors.length ? +phraseErrors[phraseErrors.length >> 1].toFixed(3) : null,
      referenceSections: labels(refAudio).join(" "),
      exportSections: labels(outAudio).join(" "),
      drops: { reference: refDrops, export: outDrops, aligned: refDrops.filter((d) => outDrops.some((o) => Math.abs(o - toAdapted(d)) <= 120)).length },
      sfx: sfxErrors,
      sfxRelativeLevelErrorMedianDb: sfxErrors.length ? [...sfxErrors].map((x) => Math.abs(x.errorDb)).sort((x, y) => x - y)[sfxErrors.length >> 1] : null,
    };
    cat.editEventsOnRenderAudio = { cuts: pick("cut"), titlesIn: pick("title_in"), pulses: pick("pulse"), onMedianAbsOffsetMs: onOffsets.length ? onOffsets[onOffsets.length >> 1] : null, links: g.links.map((l) => l.visualId + "@" + (g.visual.find((v) => v.id === l.visualId)?.timeMs ?? "") + ":" + l.relation + "(" + l.inferred.anchor + " " + l.offsetMs + ")").join(" ") };
  }
  if (truthFile) {
    // Detector accuracy on generated ground truth (reference side only).
    const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
    const inside = (t) => t >= start && t < start + span;
    const shift = (t) => t - start;
    const sil = refAudio.events.filter((e) => e.kind === "silence");
    const whoosh = refAudio.events.filter((e) => e.kind === "whoosh" || e.kind === "riser").map((e) => e.endMs ?? e.timeMs);
    cat.detectorAccuracy = {
      beats: fmeasure(truth.beats.filter(inside).map(shift), refAudio.beats.map((b) => b.timeMs), 70),
      downbeats: fmeasure(truth.downbeats.filter(inside).map(shift), refAudio.beats.filter((b) => b.downbeat).map((b) => b.timeMs), 70),
      impacts: fmeasure(truth.impacts.filter(inside).map(shift), refAudio.events.filter((e) => e.kind === "impact").map((e) => e.timeMs), 50),
      drops: fmeasure((truth.drops ?? []).filter(inside).map(shift), refAudio.events.filter((e) => e.kind === "drop").map((e) => e.timeMs), 100),
      falseEvents: refAudio.events.filter((e) => ["fade_in", "fade_out", "level_change", "filter_sweep"].includes(e.kind)).map((e) => e.kind + "@" + e.timeMs),
      sweepPeaks: fmeasure([...truth.whooshes.map((w) => w.peakMs ?? w.endMs), ...truth.risers.map((w) => w.endMs)].filter(inside).map(shift), whoosh, 150),
      silenceEdges: fmeasure(truth.silences.flatMap((s) => [s.startMs, s.endMs]).filter(inside).map(shift), sil.flatMap((e) => [e.timeMs, e.endMs ?? e.timeMs]), 120),
      tempoMedianBpm: refAudio.tempo.length ? refAudio.tempo.map((t) => t.bpm).sort((a, b) => a - b)[refAudio.tempo.length >> 1] : null,
      tempoTruthBpm: truth.tempoBpm,
      cuts: fmeasure(truth.cuts.map((c) => c.ms).filter(inside).map(shift), refVisual.cuts, 34),
      flashes: fmeasure(truth.flashes.map((f) => f.startMs).filter(inside).map(shift), refVisual.flashes, 34),
    };
    // Grammar: does the event graph classify each placed cut the way it was placed?
    const placed = truth.cuts.filter((c) => inside(c.ms));
    const truthGraph = buildEventGraph(dnaOf(placed.map((c) => shift(c.ms)), span), refAudio);
    const judged = placed.map((c, k) => ({ ms: c.ms, placed: c.relation, trigger: c.trigger, found: truthGraph.links[k]?.relation, anchor: truthGraph.links[k]?.inferred.anchor, offsetMs: truthGraph.links[k]?.offsetMs }));
    cat.detectorAccuracy.cutRelations = { agreement: +(judged.filter((j) => j.placed === j.found).length / Math.max(1, judged.length)).toFixed(3), cuts: judged.map((j) => `${j.ms}:${j.placed}/${j.found}(${j.anchor} ${j.offsetMs})`).join(" ") };
  }
  const out = option("out");
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const line = (name, m) => console.log(name.padEnd(28), typeof m === "object" && m ? JSON.stringify(m).slice(0, 220) : m);
  for (const [k, v] of Object.entries(cat)) {
    console.log("== " + k);
    for (const [n, m] of Object.entries(v)) if (!Array.isArray(m)) line(n, m);
  }
} finally {
  await host.close();
}
