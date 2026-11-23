// Run long-footage selection offline on a captured inventory (SOURCE.supp + i-vision.json /
// i-visual.json / i-person.json from capture-reference-analysis.mjs and person_mask), with the
// reference's shots extracted as the app does (scene pass, frame-accurate cuts, action
// signatures; subject shapes and trajectories when 0-person.json exists).
// Usage: node scripts/check-footage-selection.mjs INVENTORY_DIR [TRUTH.json] [MODE] [--json=OUT] [--inspect=2,6]
// --inspect lists the best reranked candidates of those reference shots.
// Person outlines pass the app's person check (person-evidence.ts: kept where the object detector
// confirms a person); --ungated uses them unchecked, as builds before that check did.
// --identity also runs same-footage identity (target/debug/examples/identity.exe, clips up to
// 600 s searched end to end; results cached in the inventory as identity-N.json).
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const args = process.argv.slice(2);
const [dir, truthFile, mode = "Close Match"] = args.filter((a) => !a.startsWith("--"));
const out = args.find((a) => a.startsWith("--json="))?.slice(7);
// --peaks=RUN.log uses the action-peak positions the app placed on audio events in that run.
const peaksLog = args.find((a) => a.startsWith("--peaks="))?.slice(8);
const inspectShots = (args.find((a) => a.startsWith("--inspect="))?.slice(10) ?? "").split(",").filter(Boolean).map(Number);
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const optional = (f) => (fs.existsSync(path.join(dir, f)) ? read(path.join(dir, f)) : undefined);
const project = read(path.join(dir, "SOURCE.supp"));
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
try {
  const { extractDNA } = await host.ssrLoadModule("/packages/ai/reference/dna.ts");
  const { buildFootageIndex, selectShots, shotRole, motionPeak, dissolveLeadIn, MATCH_WEIGHTS } = await host.ssrLoadModule("/packages/ai/reference/footage-index.ts");
  // --weights={"action":1.2} overrides the mode's match weights (offline tuning only).
  const weightsArg = args.find((a) => a.startsWith("--weights="))?.slice(10);
  if (weightsArg) Object.assign(MATCH_WEIGHTS[mode], JSON.parse(weightsArg));
  const { actionSignature, shotSpan, effectSpans } = await host.ssrLoadModule("/packages/ai/reference/action-signature.ts");
  const { sceneSignature, medianSharpness } = await host.ssrLoadModule("/packages/ai/reference/scene-signature.ts");
  const { annotateSubjects } = await host.ssrLoadModule("/packages/ai/reference/subject-shape.ts");
  const ref = project.assets[0];
  const refVisual = optional("0-visual.json") ?? [];
  const { confirmedPeople } = await host.ssrLoadModule("/packages/ai/reference/person-evidence.ts");
  const ungated = args.includes("--ungated");
  const check = (outlines, vision) => {
    if (!outlines || ungated) return { people: outlines, samples: outlines };
    const c = confirmedPeople(outlines, vision?.vision?.frames);
    if (c.outlined) console.error(`person check: ${c.rejected} of ${c.outlined} outlined frames not confirmed, ${c.unverified} unverified`);
    return c;
  };
  const checked = (outlines, vision) => check(outlines, vision).people;
  const refOutlines = optional("0-person.json");
  const refChecked = check(refOutlines, optional("0-vision.json"));
  const refPeople = refChecked.people;
  const text = optional("text.json");
  const dna = extractDNA(ref, optional("0-vision.json"), undefined, undefined, optional("motion.json") ?? [], Array.isArray(text) ? text : null, refVisual);
  const aspect = ref.width / Math.max(1, ref.height);
  // As in the app: with the reference's outlines measured, its shots are re-signed with the
  // confirmed outlines (none when the detector contradicted them all).
  if (refOutlines) {
    annotateSubjects(dna, refChecked.samples ?? [], aspect);
    for (const shot of dna.shots) {
      const [from, to] = shotSpan(shot);
      shot.action = actionSignature(refVisual, refPeople ?? [], from, to, aspect, effectSpans(dna)) ?? shot.action;
      const scene = sceneSignature(refVisual, from, to, shot.action, shot.subjectShape?.height ?? shot.scene?.subjectSize ?? null, [], medianSharpness(refVisual));
      if (scene) shot.scene = shot.scene?.objects ? { ...scene, objects: shot.scene.objects } : scene;
    }
  }
  // Body pose (i-pose.json from test-results/footage/pose-inventory.mjs), as the app measures it when
  // the reference shows a person; --no-pose leaves it out (builds before body pose).
  const { bodySignature } = await host.ssrLoadModule("/packages/ai/reference/body-pose.ts");
  const noPose = args.includes("--no-pose");
  const refPose = noPose ? undefined : optional("0-pose.json");
  const usePose = !!refPose && (refPeople?.length ?? 0) > 0;
  if (usePose)
    for (const shot of dna.shots) {
      const [from, to] = shotSpan(shot);
      const body = bodySignature(refPose, from, to);
      if (body) shot.body = body;
    }
  const sources = project.assets.flatMap((asset, i) =>
    i && asset.kind === "video" ? [{ asset, analysis: optional(i + "-vision.json"), visual: optional(i + "-visual.json"), people: checked(optional(i + "-person.json"), optional(i + "-vision.json")), outlines: optional(i + "-person.json"), ...(usePose && optional(i + "-pose.json") ? { pose: optional(i + "-pose.json") } : {}) }] : [],
  );
  const t0 = performance.now();
  const index = buildFootageIndex(sources);
  const indexMs = Math.round(performance.now() - t0);
  const appPeaks = peaksLog
    ? JSON.parse(fs.readFileSync(peaksLog, "utf8").split("\n").find((l) => l.includes("Explained each choice")).replace(/^.*?Explained each choice /, "")).rows.map((t) => {
        const m = t.match(/action peak on audio event at (\d+)%/);
        return m ? { peakFraction: Number(m[1]) / 100, peakSource: "audio event" } : undefined;
      })
    : [];
  const identityMs = { measured: 0 };
  let matchIdentity;
  if (args.includes("--identity")) {
    const id = await host.ssrLoadModule("/packages/ai/reference/identity.ts");
    matchIdentity = id.matchIdentity;
    const probes = id.identityProbes(dna.shots, dna.transitions);
    const { execFileSync } = await import("node:child_process");
    const { mediaEnvironment } = await import("./runtime.mjs");
    const clean = (f) => (f.startsWith("\\\\?\\") ? f.slice(4) : f);
    for (const [k, s] of sources.entries()) {
      const cacheFile = path.join(dir, `identity-${k + 1}.json`);
      const key = JSON.stringify({ version: 3, probes: probes.map((p) => p.refMs) });
      let cached = fs.existsSync(cacheFile) ? read(cacheFile) : undefined;
      if (cached?.key !== key) {
        const t = performance.now();
        const hits = JSON.parse(execFileSync(path.resolve("target/debug/examples/identity.exe"), [clean(ref.path), clean(s.asset.path), probes.map((p) => p.refMs).join(","), `0-${Math.min(600000, Math.floor(s.asset.duration * 1000))}`], { env: mediaEnvironment(), maxBuffer: 1 << 26 }).toString());
        identityMs.measured += performance.now() - t;
        cached = { key, hits };
        fs.writeFileSync(cacheFile, JSON.stringify(cached));
      }
      s.identity = { probes, hits: cached.hits, windows: [{ startMs: 0, endMs: Math.min(600000, s.asset.duration * 1000) }] };
    }
  }
  const reqs = dna.shots.map((shot, i) => {
    const peak = appPeaks[i] ?? motionPeak(shot) ?? { peakFraction: 0.4, peakSource: "none" };
    const identity = matchIdentity?.(i, shot.startMs, shot.endMs, sources.map((s) => ({ id: s.asset.id, durationMs: s.asset.duration * 1000, identity: s.identity })));
    const leadInMs = dissolveLeadIn(dna.transitions, shot);
    return { shot, durationMs: shot.endMs - shot.startMs, ...peak, role: shotRole(shot, i, dna.shots.length, peak.peakSource, dna.shots[i + 1]), ...(identity ? { identity } : {}), ...(leadInMs ? { leadInMs } : {}) };
  });
  const profile = {};
  const fileName = (id) => path.basename(sources.find((s) => s.asset.id === id).asset.path.replace(/^\\\\\?\\/, ""));
  let plan;
  const choices = selectShots(index, sources, reqs, mode, 40, 16, profile, (i, list) => {
    if (inspectShots.includes(i + 1))
      console.log(`shot ${i + 1} candidates: ` + list.slice(0, Number(process.env.TOP ?? 8)).map((x) => `${fileName(x.c.sourceId)} ${(x.inMs / 1000).toFixed(process.env.FINE ? 2 : 1)}${process.env.FINE ? "-" + (x.outMs / 1000).toFixed(2) : ""} ${x.score.toFixed(3)} ${process.env.FULL ? JSON.stringify(x.match) : `a${x.match.action} l${x.match.look} p${x.match.pose} m${x.match.motion}`}`).join(" | "));
  }, (p) => (plan = p));
  const truth = truthFile ? read(truthFile) : undefined;
  const fileOf = (id) => path.basename(sources.find((s) => s.asset.id === id).asset.path.replace(/^\\\\\?\\/, ""));
  // Which planted source should play at each reference shot (truth shots are consecutive).
  const wantedAt = (ms) => {
    let at = 0;
    for (const sh of truth?.shots ?? []) {
      if (ms >= at && ms < at + sh.lengthS * 1000) return sh.source;
      at += sh.lengthS * 1000;
    }
    return undefined;
  };
  const cutsByClip = new Map();
  for (const c of index.cuts) cutsByClip.set(c.sourceId, [...(cutsByClip.get(c.sourceId) ?? []), c.timeMs]);
  const rows = choices.map((c, i) => {
    const clip = fileOf(c.sourceId);
    const planted = truth?.planted.map((w) => ({ ...w, clip: w.clip ?? path.basename(truth.raw ?? "") })).find((w) => w.clip === clip && c.inMs >= w.startMs - 150 && c.outMs <= w.endMs + 150);
    const shot = dna.shots[i];
    const wanted = wantedAt((shot.startMs + shot.endMs) / 2);
    // Ground-truth cut crossing: a planted boundary strictly inside the chosen interval (planted
    // boundaries are cuts unless the case films one continuous camera: truth.rawCuts === false).
    const truthCuts = (truth?.rawCuts === false ? [] : (truth?.planted ?? [])).filter((w) => (w.clip ?? path.basename(truth.raw ?? "")) === clip).flatMap((w) => [w.startMs, w.endMs]);
    const crosses = truthCuts.some((t) => t > c.inMs + 20 && t < c.outMs - 20);
    return {
      shot: i + 1,
      ref: `${(shot.startMs / 1000).toFixed(2)}–${(shot.endMs / 1000).toFixed(2)}`,
      role: c.role,
      wanted,
      clip,
      inS: +(c.inMs / 1000).toFixed(2),
      outS: +(c.outMs / 1000).toFixed(2),
      speed: c.speed,
      planted: planted ? planted.source : null,
      correct: !!planted && planted.source === wanted,
      crossesCut: crosses,
      feasible: c.outMs - c.inMs >= (shot.endMs - shot.startMs) * 0.85 - 1,
      score: c.score,
      confidence: c.confidence,
      certainty: c.certainty,
      margin: c.margin,
      rival: c.rival,
      semantic: c.semantic,
      quality: c.match.quality,
      coverage: c.coverage,
      phase: c.phase ?? null,
      reuse: c.reuse?.reason ?? null,
      action: c.match.action,
      look: c.match.look,
      pose: c.match.pose,
      match: c.match,
      label: c.label ?? null,
      identity: c.identity ? { score: c.identity.score, margin: c.identity.margin, timingMargin: c.identity.timingMargin, speed: c.identity.speed, motion: c.identity.motion, points: c.identity.points } : null,
      alternatives: c.alternatives.map((a) => `${fileOf(a.sourceId)} ${(a.inMs / 1000).toFixed(2)}: ${a.lostOn}`),
    };
  });
  const overlaps = rows.filter((r, i) => rows.some((o, j) => j < i && o.clip === r.clip && o.inS < r.outS && r.inS < o.outS)).length;
  const report = {
    mode,
    referenceShots: dna.shots.length,
    coverage: index.coverage,
    timingMs: { index: indexMs, ...profile },
    inPlantedAction: `${rows.filter((r) => r.planted).length}/${rows.length}`,
    correctSemanticAction: `${rows.filter((r) => r.correct).length}/${rows.length}`,
    sameFootage: `${rows.filter((r) => r.identity).length}/${rows.length}`,
    identitySeconds: Number((identityMs.measured / 1000).toFixed(1)),
    cutCrossings: rows.filter((r) => r.crossesCut).length,
    durationInfeasible: rows.filter((r) => !r.feasible).length,
    reused: overlaps,
    intentionalReuse: choices.filter((c) => c.reuse).map((c, i) => c.reuse.reason),
    coverageClasses: plan?.coverage,
    repeatGroups: plan?.groups.map((g) => `shots ${g.shots.map((x) => x + 1).join("+")}: ${g.outcome} (permission: ${g.decision}; ${g.stretches} strong stretches, similarity ${g.similarity})`),
    scarce: plan?.resources.filter((r) => r.scarcity > 1).map((r) => `shots ${r.compatibleShots.map((x) => x + 1).join("+")}: ${(r.totalMs / 1000).toFixed(1)} s for ${(r.demandMs / 1000).toFixed(1)} s`),
    nearTies: plan?.nearTies,
    fromFirstTenSeconds: rows.filter((r) => r.inS < 10).length,
    shots: rows,
  };
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  for (const r of rows)
    console.log(
      `shot ${r.shot} ${r.ref} [${r.role}] wants ${r.wanted ?? "?"} → ${r.clip} ${r.inS}–${r.outS}${r.speed < 1 ? ` ×${r.speed}` : ""} ${r.planted ? "in " + r.planted : "OUTSIDE"}${r.correct ? " ✓" : " ✗"}${r.crossesCut ? " CROSSES CUT" : ""} score ${r.score} action ${r.action} pose ${r.pose} (${r.coverage} ${Math.round(r.certainty * 100)}%)${r.phase ? " [phase: " + r.phase + "]" : ""}${r.reuse ? " REUSE: " + r.reuse : ""}`,
    );
  const { shots, ...summary } = report;
  console.log(JSON.stringify(summary));
} finally {
  await host.close();
}
