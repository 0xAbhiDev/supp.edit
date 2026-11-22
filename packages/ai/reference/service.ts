import { referenceVisual } from "./visual-source";
import { personMasks } from "./subject-mask";
import { traceTitles } from "./focus";
import { sourceTone, toneProfiles } from "./source-tone";
import { medianTone } from "./tone";
import { annotateSubjects } from "./subject-shape";
import { measureTextDepth } from "./text-depth";
import { sourceAperture } from "./aperture";
import type { Project, Asset } from "../../project-schema";
import { referenceMotion, referenceText } from "./motion";
import { mediaAnalysis } from "../media-analysis/service";
import {
  defaultAnalysisSettings,
  type AnalysisTask,
  type MediaAnalysis,
} from "../media-analysis/model";
import { nativeColorBackend } from "../rough-cut/matching";
import { extractDNA, type StyleDNA } from "./dna";
import { autonomousControls, buildRecreation, type Controls, type SourceEvidence } from "./planner";
import { audioTimeline, generatedSound, soundtrackAsset } from "../audio/service";
import type { AudioTimeline } from "../audio/timeline";
import type { SoundKind } from "../audio/synth";
import { buildEventGraph } from "./event-graph";
import { plannedSounds } from "./audio-structure";
import { alignStructure } from "./structural-alignment";
import { actionSignature, effectSpans, shotSpan } from "./action-signature";
import { medianSharpness, sceneSignature } from "./scene-signature";
import type { VisualFrame } from "./visual";
import { derivedReads, readDerived, writeDerived } from "../../platform/derived";
import { restrictReference } from "./interval";
import { referenceGrammar } from "./grammar";
import { dnaSchema } from "./dna";

import { sourceText } from "./source-text";
import { identityProbes, mergeIdentity, sourceIdentity } from "./identity";
import { applyTitleCache, titleCacheEntry, titleCacheKey, type TitleCacheEntry } from "./title-cache";
import { INDEX_VERSION, indexSource, sourceIndexKey, type SourceIndex } from "./footage-index";
import { confirmedPeople } from "./person-evidence";
import { bodyPose, bodySignature } from "./body-pose";

/** Time and cache use of one analysis stage of one clip. */
export interface StageTiming {
  stage: string;
  ms: number;
  reused: boolean;
  /** Where a stage spent its time, when it measures that (tone sampling). */
  detail?: Record<string, number>;
}
/** Per-stage cache result across all clips, plus the reference and the matching. */
export interface CacheDiagnostics {
  stages: { stage: string; hits: number; total: number }[];
  reference: { hits: number; total: number; ms: number };
  matchingMs: number;
}
export interface ClipProfile {
  clip: string;
  footageMs: number;
  wallMs: number;
  stages: StageTiming[];
}
const clock = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
export interface RecreationInputs {
  reference: string;
  raw: string[];
  music?: string;
  voice?: string;
}
export function recreate(
  project: Project,
  revision: number,
  input: RecreationInputs,
  controls: Controls,
  profile?: StyleDNA,
) {
  const asset = (id: string) => {
    const a = project.assets.find((a) => a.id === id);
    if (!a) throw Error("Re-select the missing asset");
    return a;
  };
  const reference = asset(input.reference),
    raw = [...new Set(input.raw)].map(asset),
    music = input.music ? asset(input.music) : undefined,
    voice = input.voice ? asset(input.voice) : undefined;
  if (
    reference.kind !== "video" ||
    !raw.length ||
    raw.length > 64 ||
    raw.some(
      (a) => a.kind !== "video" || a.fingerprint === reference.fingerprint,
    )
  )
    throw Error("Choose a reference and 1–64 distinct raw videos");
  if (
    [music, voice].some(
      (a) =>
        a && (a.kind !== "audio" || a.fingerprint === reference.fingerprint),
    )
  )
    throw Error("Choose audio assets for music or voiceover");
  // A reference and raw footage alone are enough: what was not chosen is chosen here, and said.
  const auto = autonomousControls(controls, reference, !!music);
  controls = auto.controls;
  return mediaAnalysis.jobs.enqueue({
    scope: project.id,
    label: "Recreate this style · LOCAL",
    run: async (job) => {
      const caps = await mediaAnalysis.capabilities(),
        warnings: string[] = [];
      if (auto.chosen.length) warnings.push("Chosen automatically: " + auto.chosen.join("; ") + ".");
      const run = (a: Asset, task: AnalysisTask) =>
        mediaAnalysis.runTask(a, defaultAnalysisSettings(task), {
          ...job,
          report: () => {},
        });
      const visuals = async (a: Asset) => {
        await job.checkpoint();
        await mediaAnalysis.restore(a);
        const vision =
          caps.visionModel?.installed ||
          mediaAnalysis
            .getSnapshot()
            .some(
              (x) =>
                x.assetId === a.id &&
                x.fingerprint === a.fingerprint &&
                x.vision,
            );
        // Independent stages run at once (each native job has its own worker).
        const [analysis, color, visual] = await Promise.all([
          run(a, vision ? "vision" : "video"),
          nativeColorBackend(a, { startMs: 0, endMs: Math.max(1, Math.floor(Math.min(a.duration, 300) * 1000)) }, { ...job, report: () => {} }),
          referenceVisual(a, { ...job, report: () => {} }),
        ]);
        return { asset: a, analysis, color, visual };
      };
      const total = raw.length + 3;
      const stage = (completed: number, detail: string) =>
        job.report({ completed, total, unit: "stages", detail });
      stage(0, "Analyzing reference");
      const quiet = { ...job, report: () => {} };
      let referenceTranscript: Project["transcripts"][number] | undefined;
      let referenceFrames: VisualFrame[] | undefined;
      let referenceAnalysis: MediaAnalysis | undefined;
      // The reference's stored analysis when its style came from a saved profile (not re-measured).
      const referenceSnapshot = async () => {
        await mediaAnalysis.restore(reference);
        return mediaAnalysis.getSnapshot().find((x) => x.assetId === reference.id && x.fingerprint === reference.fingerprint);
      };
      // Where reference analysis spends its time (each step, for the analysis profile), and which
      // steps came from a cache (HIT), had to be measured (MISS) or are always recomputed.
      const referenceSteps: Record<string, number> = {};
      const referenceCache: Record<string, "HIT" | "MISS" | "RECOMPUTED"> = {};
      const step = async <T,>(name: string, work: Promise<T>): Promise<T> => {
        const t = performance.now();
        try {
          return await work;
        } finally {
          referenceSteps[name] = (referenceSteps[name] ?? 0) + performance.now() - t;
        }
      };
      const referenceStarted = performance.now();
      // Cache reads made by this reconstruction only (the read log is shared across runs).
      const readsFrom = derivedReads.length;
      async function measureReference() {
        const measured = await step("scenes, colour, per-frame visual", visuals(reference));
        referenceFrames = measured.visual;
        referenceAnalysis = measured.analysis;
        let text = null;
        try {
          text = await step("text", referenceText(reference, quiet));
          if (
            text?.length &&
            controls.subjectLayering === "reference" &&
            caps.personModel?.installed
          ) {
            try {
              const masks = await step("person masks", personMasks(reference, quiet));
              text = text.map((line) => measureTextDepth(line, masks));
            } catch (e) {
              await job.checkpoint();
              warnings.push(
                "Reference depth could not be measured; unresolved text stays in front: " +
                  String(e).slice(0, 160),
              );
            }
          }
        } catch (e) {
          await job.checkpoint();
          warnings.push(
            "Reference text analysis unavailable: " + String(e).slice(0, 240),
          );
        }
        const refMusic = reference.hasAudio
          ? await step("beat map", run(reference, "audio")).then((r) => {
              referenceCache["beat map"] = r.cached ? "HIT" : "MISS";
              return r.audio?.beatMap;
            })
          : undefined;
        let transcript = project.transcripts.find(
          (t) =>
            t.assetId === reference.id &&
            t.sourceFingerprint === reference.fingerprint,
        );
        if (
          !transcript &&
          reference.hasAudio &&
          (text?.length || (controls.audio ?? "music") !== "music") &&
          caps.model?.installed
        ) {
          try {
            const speech = await step("speech", run(reference, "speech"));
            referenceCache.speech = speech.cached ? "HIT" : "MISS";
            transcript = speech.transcript ?? undefined;
          } catch (e) {
            await job.checkpoint();
            warnings.push(
              "Reference vocal timing unavailable: " + String(e).slice(0, 160),
            );
          }
        }
        referenceTranscript=transcript;
        return extractDNA(
          reference,
          measured.analysis,
          refMusic,
          measured.color,
          await step("motion", referenceMotion(reference, quiet)),
          text,
          measured.visual,
          transcript,
        );
      }
      let dna =
        profile && controls.wording !== "original"
          ? profile
          : await measureReference();
      let referencePeople:Awaited<ReturnType<typeof personMasks>>=[];
      if(controls.interval){
        const contours=caps.personModel?.installed ? await step("person masks", personMasks(reference,quiet)) : [];
        referencePeople=contours;
        // Title tracing is the costliest reference step: cache everything it changes (text,
        // person flashes, per-shot tone with the title band masked, plate tint) under everything
        // it reads (title-cache.ts). A word correction re-traces titles only.
        const titleKey = titleCacheKey({ fingerprint: reference.fingerprint, interval: controls.interval, reviewedTitleCues: controls.reviewedTitleCues, dna, contours: contours.length, transcript: referenceTranscript?.segments });
        const cachedTitles = await readDerived<TitleCacheEntry>(titleKey).catch(() => undefined);
        const applied = cachedTitles ? applyTitleCache(restrictReference(dna, controls.interval), cachedTitles) : undefined;
        const reused = applied ? dnaSchema.safeParse(applied) : undefined;
        if (reused?.success) {
          referenceCache.titles = "HIT";
          dna = reused.data;
          warnings.push(...cachedTitles!.warnings);
        } else {
          referenceCache.titles = "MISS";
          const focused=await step("titles", traceTitles(reference,dna,controls.interval,contours,referenceTranscript,quiet,undefined,controls.reviewedTitleCues));
          dna=focused.dna;
          warnings.push(...focused.warnings);
          const entry = titleCacheEntry(focused.dna, focused.warnings);
          await writeDerived(titleKey, entry, JSON.stringify(entry).length * 2 + 4096).catch(() => {});
        }
      }
      const closeMatch = controls.mode === "Close Match";
      // Modes that keep the reference's measured look need its tone and the footage's.
      const keepsLook = controls.mode !== "Creative Remix";
      // Pose-aware shot choice: the reference subject's shape and movement per shot. Every mode
      // needs it: Creative Remix reinterprets rhythm and framing, but its picks must still do what
      // the reference shots do (without it Remix matched on look alone: 3/9 and 1/9 in the app).
      if (caps.personModel?.installed) {
        try {
          if (!referencePeople.length) referencePeople = await step("person masks", personMasks(reference, quiet));
          // Title tracing annotates subjects from the segmentation's own contours (focus.ts); those
          // shapes are cleared so that only confirmed outlines describe the subject. Without this a
          // first run (titles traced fresh) kept phantom subject shapes that a run with cached
          // titles did not, and the two scored and labelled shots differently.
          const annotated = {
            ...dna,
            shots: dna.shots.map((shot) => {
              const copy = { ...shot };
              delete copy.subjectShape;
              delete copy.subjectPath;
              delete copy.subjectAbsent;
              delete copy.body;
              return copy;
            }),
          };
          const aspect = reference.width / Math.max(1, reference.height);
          // The reference's shots carry a subject shape and outline path only where its object
          // detector confirms a person (titles and flashes keep the segmentation's contours).
          const referenceSubjects = confirmedPeople(referencePeople, (referenceAnalysis ?? (await referenceSnapshot()))?.vision?.frames);
          console.debug("reference person check", referenceSubjects.outlined, referenceSubjects.rejected, referenceSubjects.unverified, (referenceAnalysis ?? (await referenceSnapshot()))?.vision?.frames.length ?? "no vision");
          if (referenceSubjects.rejected)
            warnings.push(`Reference person outlines the object detector did not confirm were not used as a person: ${referenceSubjects.rejected} of ${referenceSubjects.outlined} outlined frames.`);
          const subjects = referenceSubjects.people ?? [];
          // Shots measured with nobody in them are marked too (contradicted outlines arrive emptied).
          annotateSubjects(annotated, referenceSubjects.samples ?? [], aspect);
          // The body's joint angles across each shot, where a person is confirmed (body-pose.ts).
          if (caps.poseModel?.installed && subjects.some((p) => p.points.length)) {
            try {
              const referencePose = await step("body pose", bodyPose(reference, quiet));
              for (const shot of annotated.shots) {
                const [from, to] = shotSpan(shot);
                const body = bodySignature(referencePose, from, to);
                if (body) shot.body = body;
              }
            } catch (e) {
              await job.checkpoint();
              warnings.push("Reference body pose unavailable: " + String(e).slice(0, 160));
            }
          }
          // Movement geometry with the subject's outline trajectory, on the reference's dense frames.
          referenceFrames ??= await referenceVisual(reference, quiet);
          for (const shot of annotated.shots) {
            const [from, to] = shotSpan(shot);
            // The reference's whole-frame edit effects (colour pulses, person flashes) are not its movement.
            const action = actionSignature(referenceFrames, subjects, from, to, aspect, effectSpans(annotated));
            if (action) shot.action = action;
            const scene = sceneSignature(referenceFrames, from, to, shot.action, shot.subjectShape?.height ?? shot.scene?.subjectSize ?? null, [], medianSharpness(referenceFrames));
            if (scene) shot.scene = shot.scene?.objects ? { ...scene, objects: shot.scene.objects } : scene;
          }
          dna = annotated;
        } catch (e) {
          await job.checkpoint();
          warnings.push("Reference subject shape unavailable: " + String(e).slice(0, 160));
        }
      }
      if (keepsLook && dna.shots.some((shot) => !shot.tone)) {
        try {
          const samples = await step("tone", sourceTone(reference, quiet));
          dna = {
            ...dna,
            shots: dna.shots.map((shot) => {
              if (shot.tone) return shot;
              const tone = medianTone(
                samples
                  .filter((t) => t.timeMs >= shot.startMs && t.timeMs < shot.endMs)
                  .map((t) => t.tone),
              );
              return tone ? { ...shot, tone } : shot;
            }),
          };
        } catch (e) {
          await job.checkpoint();
          warnings.push("Reference tone could not be measured: " + String(e).slice(0, 160));
        }
      }
      // The reference's soundtrack on the same clock as its pictures, and the links between them.
      if (reference.hasAudio) {
        try {
          const transcript =
            referenceTranscript ??
            project.transcripts.find((t) => t.assetId === reference.id && t.sourceFingerprint === reference.fingerprint);
          const words = (transcript?.segments ?? []).flatMap((s) => s.words ?? []).map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }));
          const audio = await step("audio timeline", audioTimeline(reference, words));
          if (audio) dna = { ...dna, audio, eventGraph: buildEventGraph(dna, audio, 1000 / Math.max(1, reference.fps || 30)) };
        } catch (e) {
          await job.checkpoint();
          warnings.push("Reference audio could not be measured: " + String(e).slice(0, 160));
        }
      }
      stage(1, "Extracted Style DNA");
      const referenceMs = Math.round(performance.now() - referenceStarted);
      // Exact cache results of the reference steps that have a cache.
      const refHit = (prefix: string) => {
        const fp = reference.fingerprint;
        const reads = derivedReads.slice(Math.min(readsFrom, derivedReads.length)).filter((x) => x.key.startsWith(prefix) && (x.key.endsWith(fp) || x.key.includes(fp + ":")));
        return reads.length ? (reads.some((x) => x.hit) ? "HIT" : "MISS") : undefined;
      };
      for (const [name, prefix] of [["per-frame visual", "reference-visual-v8:"], ["person masks", "person-mask-pphumanseg-552d8a98-v3:"], ["tone", "source-tone-v4:"], ["aperture", "source-aperture-v3:"], ["text", "reference-text-v8:"], ["motion", "reference-blocks-v2:"], ["audio timeline", "audio-timeline-v2:"]] as const) {
        const v = refHit(prefix);
        if (v) referenceCache[name] = v;
      }
      // A step that ran but left no cache evidence is reported as recomputed, never as a hit.
      for (const step of ["text", "motion", "beat map", "audio timeline", "speech"]) if (referenceSteps[step] !== undefined) referenceCache[step] ??= "RECOMPUTED";
      warnings.push(
        "Reference cache: " +
          Object.entries(referenceCache)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ") +
          ".",
      );
      warnings.push(
        `Reference analysis: ${clock(referenceMs)} — ` +
          Object.entries(referenceSteps)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${clock(v)}`)
            .join(", ") +
          ".",
      );
      // ---- Understanding the raw footage. Every clip's independent stages run at once and two
      // clips are analysed together; each stage is timed and reports whether its cache was reused.
      const needPeople =
        (caps.personModel?.installed && dna.shots.some((shot) => shot.subjectShape)) ||
        controls.subjectLayering === "behind-people" ||
        (controls.subjectLayering === "reference" &&
          (!!dna.personFlashes?.length ||
            !!dna.text?.some((l) => l.depth?.relation === "behind" && l.evidence?.status !== "uncertain")));
      // Body pose on the raw footage when the reference's shots carry joint angles to compare.
      const needPose = !!caps.poseModel?.installed && dna.shots.some((shot) => shot.body);
      const needSpeech = (a: Asset) =>
        a.hasAudio &&
        (/caption|speech|talking.head/i.test(controls.instructions) ||
          (controls.wording === "adapt" && !!dna.text?.length && !/["“]/.test(controls.instructions))) &&
        !!caps.model?.installed;
      const footageMs = raw.reduce((n, a) => n + a.duration * 1000, 0);
      const analysisProfile: ClipProfile[] = [];
      // Clips whose person outlines the object detector contradicted (person-evidence.ts).
      const personChecks: { clip: string; outlined: number; rejected: number; unverified: number }[] = [];
      const running = new Map<string, string[]>();
      let doneMs = 0,
        doneClips = 0;
      const progress = () => {
        const stages = analysisProfile.flatMap((c) => c.stages);
        const reused = stages.filter((x) => x.reused).length;
        // One unit for the whole job (the job system requires it): stages, a clip each.
        job.report({
          completed: 1 + doneClips,
          total,
          unit: "stages",
          detail:
            `Understanding footage · ${doneClips} of ${raw.length} clips done · ${clock(doneMs)} of ${clock(footageMs)} analysed` +
            [...running].map(([name, active]) => ` · ${name}: ${active.length ? active.join(", ") : "finishing"}`).join("") +
            (stages.length ? ` · ${reused} of ${stages.length} stages reused from cache` : ""),
        });
      };
      const understand = async (a: Asset): Promise<SourceEvidence> => {
        const started = performance.now(),
          stages: StageTiming[] = [],
          active: string[] = [];
        running.set(a.name, active);
        progress();
        const hit = (prefix: string) => () => derivedReads.some((x) => x.hit && x.key.startsWith(prefix) && x.key.endsWith(a.fingerprint));
        const timed = async <T,>(name: string, reused: () => boolean, work: () => Promise<T>): Promise<T> => {
          active.push(name);
          progress();
          const t = performance.now();
          try {
            return await work();
          } finally {
            active.splice(active.indexOf(name), 1);
            stages.push({ stage: name, ms: Math.round(performance.now() - t), reused: reused() });
            progress();
          }
        };
        await job.checkpoint();
        await mediaAnalysis.restore(a);
        const snapshot = mediaAnalysis.getSnapshot().find((x) => x.assetId === a.id && x.fingerprint === a.fingerprint);
        const vision = caps.visionModel?.installed || !!snapshot?.vision;
        const measured = !!snapshot && (vision ? !!snapshot.vision : !!snapshot.video);
        let colourHit = false,
          analysisHit = false;
        const soft = <T,>(what: string, work: () => Promise<T>) =>
          work().catch(async (e) => {
            await job.checkpoint();
            warnings.push(what + String(e).slice(0, 180));
            return undefined;
          });
        const [analysis, color, visual, aperture, tone, people, speech, pose] = await Promise.all([
          // Reused when this project already holds it, or when the native analysis reports its own cache hit.
          timed(vision ? "scenes + vision" : "scenes", () => measured || analysisHit, async () => {
            const result = await run(a, vision ? "vision" : "video");
            analysisHit = !!result.cached;
            return result;
          }),
          // The native colour measurement reports its own cache hits.
          timed("colour", () => colourHit, async () => {
            const stats = await nativeColorBackend(a, { startMs: 0, endMs: Math.max(1, Math.floor(Math.min(a.duration, 300) * 1000)) }, quiet);
            colourHit = !!stats.cached;
            return stats;
          }),
          timed("per-frame visual", hit("reference-visual-v8:"), () => referenceVisual(a, quiet)),
          // Portrait delivery crops to the content; Close Match fill framing crops baked bars.
          controls.format === "vertical" || closeMatch ? timed("aperture", hit("source-aperture-v3:"), () => sourceAperture(a, quiet)) : undefined,
          keepsLook ? timed("tone", hit("source-tone-v4:"), () => soft("Footage tone could not be measured: ", () => sourceTone(a, quiet))) : undefined,
          needPeople ? timed("person masks", hit("person-mask-pphumanseg-552d8a98-v3:"), () => soft("Person segmentation unavailable: ", () => personMasks(a, quiet))) : undefined,
          needSpeech(a) ? timed("speech", () => false, () => run(a, "speech")) : undefined,
          // Joint angles say what a body does across different recordings (body-pose.ts).
          needPose ? timed("body pose", hit("pose-mediapipe-2023mar-9d89c599-v1:"), () => soft("Body pose unavailable: ", () => bodyPose(a, quiet))) : undefined,
        ]);
        const evidence: SourceEvidence = { asset: a, analysis, color, visual };
        if (aperture) evidence.aperture = aperture;
        if (tone) evidence.tone = tone;
        if (people) {
          // The matcher trusts an outline as a person only where the object detector agrees.
          evidence.outlines = people;
          const checked = confirmedPeople(people, analysis.vision?.frames);
          if (checked.people) evidence.people = checked.people;
          if (checked.rejected) personChecks.push({ clip: a.name, outlined: checked.outlined, rejected: checked.rejected, unverified: checked.unverified });
        }
        if (speech) evidence.speech = speech;
        if (pose?.length) evidence.pose = pose;
        // The clip's long-footage index (cut-safe segments, frame cuts, candidates), persisted by
        // file identity: a second recreation or a new clip beside it never rebuilds it.
        await timed("footage index", hit("footage-index-"), async () => {
          const key = sourceIndexKey(evidence);
          const cached = await readDerived<SourceIndex>(key).catch(() => undefined);
          if (cached?.version === INDEX_VERSION && Array.isArray(cached.candidates) && Array.isArray(cached.segments)) evidence.index = cached;
          else {
            evidence.index = indexSource(evidence);
            await writeDerived(key, evidence.index, JSON.stringify(evidence.index).length * 2).catch(() => {});
          }
        });
        const tp = toneProfiles.get(a.fingerprint);
        const toneStage = stages.find((st) => st.stage === "tone");
        if (tp && toneStage && !toneStage.reused) toneStage.detail = tp;
        analysisProfile.push({ clip: a.name, footageMs: Math.round(a.duration * 1000), wallMs: Math.round(performance.now() - started), stages });
        running.delete(a.name);
        doneMs += a.duration * 1000;
        doneClips++;
        progress();
        return evidence;
      };
      const footageStarted = performance.now();
      const sources: SourceEvidence[] = new Array(raw.length);
      let nextClip = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, raw.length) }, async () => {
          while (nextClip < raw.length) {
            const k = nextClip++;
            sources[k] = await understand(raw[k]);
          }
        }),
      );
      const footageWallMs = Math.round(performance.now() - footageStarted);
      if (personChecks.length)
        warnings.push(
          "Person outlines the object detector did not confirm were not used as a person when matching shots: " +
            personChecks.map((c) => `${c.clip} ${c.rejected} of ${c.outlined} outlined frames`).join("; ") +
            ". Layering masks keep them.",
        );
      {
        const stages = analysisProfile.flatMap((c) => c.stages);
        const byStage = new Map<string, number>();
        for (const st of stages) byStage.set(st.stage, (byStage.get(st.stage) ?? 0) + st.ms);
        warnings.push(
          `Analysis time: reference ${clock(referenceMs)}; ${clock(footageMs)} of footage in ${clock(footageWallMs)} (${(footageWallMs / Math.max(1, footageMs)).toFixed(2)} s per footage second, ${stages.filter((x) => x.reused).length} of ${stages.length} stages reused). Stage totals: ` +
            [...byStage]
              .sort((x, y) => y[1] - x[1])
              .map(([k, v]) => `${k} ${clock(v)}`)
              .join(", ") +
            ".",
        );
        const tone = stages.filter((st) => st.stage === "tone" && st.detail);
        if (tone.length) {
          const sum = (k: string) => tone.reduce((n, st) => n + (st.detail![k] ?? 0), 0);
          warnings.push(
            `Tone sampling: ${sum("samples")} frames; seeking ${clock(sum("seek"))}, drawing ${clock(sum("draw"))}, pixel readback ${clock(sum("read"))}, measuring ${clock(sum("compute"))}, opening ${clock(sum("open"))}, saving ${clock(sum("save"))}.`,
          );
        }
      }
      // Cache diagnostics: which stages came from cache for every clip, and for the reference.
      const cacheStages = [...new Set(analysisProfile.flatMap((c) => c.stages.map((st) => st.stage)))].map((stage) => {
        const all = analysisProfile.flatMap((c) => c.stages.filter((st) => st.stage === stage));
        return { stage, hits: all.filter((st) => st.reused).length, total: all.length };
      });
      // Stages without any cache are recomputed every time by design (footage index rebuilds are cheap).
      const referenceReads = derivedReads.filter((x) => x.key.endsWith(reference.fingerprint));
      const cache: CacheDiagnostics = {
        stages: cacheStages,
        reference: { hits: referenceReads.filter((x) => x.hit).length, total: referenceReads.length, ms: referenceMs },
        matchingMs: 0,
      };
      await job.checkpoint();
      stage(raw.length + 1, "Processing audio");
      if (music) await mediaAnalysis.restore(music);
      if (voice) await mediaAnalysis.restore(voice);
      const beatMap = music
        ? (await run(music, "audio")).audio?.beatMap
        : undefined;
      const voiceTranscript =
        voice && caps.model?.installed
          ? (await run(voice, "speech")).transcript
          : undefined;
      if (
        !caps.model?.installed &&
        (voice || /caption/i.test(controls.instructions))
      )
        warnings.push(
          "Word transcription requires an installed speech model or an existing transcript.",
        );
      // Recreating the audio structure: measure the replacement and generate the linked sounds it lacks.
      let musicAudio: AudioTimeline | undefined,
        soundtrack: Asset | undefined,
        referenceAperture: Awaited<ReturnType<typeof sourceAperture>> | undefined;
      // Where the reference shows picture: its bars are reproduced, not filled with footage.
      if (controls.format !== "vertical") {
        try {
          referenceAperture = await sourceAperture(reference, quiet);
        } catch (e) {
          await job.checkpoint();
          warnings.push("The reference picture area could not be measured: " + String(e).slice(0, 160));
        }
      }
      if (controls.audio === "reference" && reference.hasAudio) {
        try {
          soundtrack = await soundtrackAsset(reference);
        } catch (e) {
          await job.checkpoint();
          warnings.push("The reference soundtrack could not be extracted: " + String(e).slice(0, 160));
        }
      }
      const sounds: Partial<Record<SoundKind, Asset>> = {};
      if (controls.audio === "recreate" && music && dna.audio && dna.eventGraph) {
        try {
          musicAudio = await audioTimeline(music);
          if (musicAudio) {
            const start = dna.shots[0]?.startMs ?? 0,
              end = dna.shots.at(-1)?.endMs ?? start;
            const alignment = alignStructure(dna.eventGraph, dna.audio, musicAudio, start, end);
            for (const kind of new Set(plannedSounds(dna.eventGraph, dna.audio, musicAudio, alignment, start, voice ? -20 : -12).map((s) => s.kind)))
              sounds[kind] = await generatedSound(kind);
          }
        } catch (e) {
          await job.checkpoint();
          warnings.push("The replacement music could not be measured: " + String(e).slice(0, 160));
        }
      }
      stage(raw.length + 2, "Matching shots and building editable timeline");
      await job.checkpoint();
      const matchingStarted = performance.now();
      const plan = () =>
        buildRecreation(
          project,
          revision,
          reference,
          dna,
          sources,
          controls,
          music,
          beatMap,
          voice,
          voiceTranscript,
          { reference: dna.audio, music: musicAudio, soundtrack, sounds, referenceAperture },
        );
      // Same footage: where each reference shot's own frames are in the raw clips (a regrade, crop,
      // zoom or small speed change aside). Clips up to ten minutes are searched end to end before
      // the first plan; longer clips around the moments that plan considers, then planned again.
      // A shot found this way is cut from that exact moment; the rest are matched by likeness.
      const identityStarted = performance.now();
      const probes = reference.kind === "video" ? identityProbes(dna.shots, dna.transitions) : [];
      const videoSources = sources.filter((s) => s.asset.kind === "video");
      const measureIdentity = (windowsOf: (s: (typeof sources)[number]) => { startMs: number; endMs: number }[]) =>
        Promise.all(
          videoSources.map(async (s) => {
            const windows = windowsOf(s);
            if (!windows.length) return;
            s.identity = mergeIdentity(s.identity, await sourceIdentity(reference, s.asset, probes, windows, quiet));
          }),
        );
      let identityError: string | null = null;
      try {
        if (probes.length) await measureIdentity((s) => (s.asset.duration <= 600 ? [{ startMs: 0, endMs: Math.floor(s.asset.duration * 1000) }] : []));
      } catch (e) {
        await job.checkpoint();
        identityError = String(e).slice(0, 160);
      }
      let edit = plan();
      if (probes.length && !identityError && videoSources.some((s) => s.asset.duration > 600)) {
        try {
          const rate = project.settings.fps.num / project.settings.fps.den;
          const around = new Map<string, { startMs: number; endMs: number }[]>();
          const add = (id: string, a: number, b: number) => around.set(id, [...(around.get(id) ?? []), { startMs: Math.max(0, a - 4000), endMs: b + 4000 }]);
          for (const m of edit.matches) {
            add(m.source, (m.sourceIn * 1000) / rate, ((m.sourceIn + m.duration) * 1000) / rate);
            for (const alt of (m.alternatives ?? []).slice(0, 3)) add(alt.sourceId, alt.inMs, alt.outMs);
          }
          await measureIdentity((s) => (s.asset.duration > 600 ? (around.get(s.asset.id) ?? []) : []));
          edit = plan();
        } catch (e) {
          await job.checkpoint();
          identityError = String(e).slice(0, 160);
        }
      }
      if (identityError) warnings.push("Same-footage matching could not run: " + identityError + ". Shots were matched by likeness only.");
      else if (probes.length) {
        const same = edit.matches.filter((m) => m.identity);
        warnings.push(
          `Same footage: ${same.length} of ${dna.shots.length} reference shots found frame by frame in the raw clips` +
            (same.length ? ` (match ${Math.min(...same.map((m) => m.identity!.score)).toFixed(2)}–${Math.max(...same.map((m) => m.identity!.score)).toFixed(2)})` : "") +
            `; ${probes.length} probe frames in ${clock(performance.now() - identityStarted)}.` +
            (same.length < dna.shots.length ? " The rest were matched by what they show and how they move." : ""),
        );
      }
      cache.matchingMs = Math.round(performance.now() - matchingStarted);
      // Text burned into the footage: read only the windows the plan considers (each shot's pick
      // and its three best alternatives), then plan again while a new pick lands in a window not
      // yet read (at most three plans), so clean imagery is preferred and no title duplicates
      // words the footage already shows. An unread window is never treated as clean.
      const textStarted = performance.now();
      try {
        const rate = project.settings.fps.num / project.settings.fps.den;
        const read = new Map<string, Set<string>>();
        let textWindows = 0,
          textCached = 0,
          found = false,
          plans = 1;
        for (let round = 0; round < 3; round++) {
          const wanted = new Map<string, { startMs: number; endMs: number }[]>();
          const add = (id: string, startMs: number, endMs: number) => {
            const key = `${Math.round(startMs / 100)}-${Math.round(endMs / 100)}`;
            if (read.get(id)?.has(key)) return;
            read.set(id, new Set([...(read.get(id) ?? []), key]));
            wanted.set(id, [...(wanted.get(id) ?? []), { startMs, endMs }]);
          };
          for (const m of edit.matches) {
            add(m.source, (m.sourceIn * 1000) / rate, ((m.sourceIn + m.duration) * 1000) / rate);
            if (round === 0) for (const alt of (m.alternatives ?? []).slice(0, 3)) add(alt.sourceId, alt.inMs, alt.outMs);
          }
          if (!wanted.size) break;
          const before = derivedReads.length;
          await Promise.all(
            sources.map(async (s) => {
              const windows = wanted.get(s.asset.id);
              if (!windows?.length) return;
              const measured = await sourceText(s.asset, windows, quiet);
              s.text = [...(s.text ?? []), ...measured];
              textWindows += measured.length;
              if (measured.some((w) => w.regions.some((r) => r.likelyBurnedIn))) found = true;
            }),
          );
          textCached += derivedReads.slice(before).filter((x) => x.hit && x.key.startsWith("source-text-")).length;
          if (!found) break;
          edit = plan();
          plans++;
        }
        warnings.push(`Source text: ${textWindows} candidate windows read (${textCached} from cache) in ${clock(performance.now() - textStarted)}; ${plans} plan${plans === 1 ? "" : "s"}.`);
        if (found) warnings.push("Text burned into the raw footage was found in candidate windows; the plan prefers clean imagery and does not duplicate titles the footage already shows.");
      } catch (e) {
        await job.checkpoint();
        warnings.push("Text in the raw footage could not be measured: " + String(e).slice(0, 160) + ". Titles may duplicate text burned into the footage.");
      }
      cache.matchingMs += Math.round(performance.now() - textStarted);
      warnings.push(
        "Cache: " +
          cache.stages.map((st) => `${st.stage} ${st.hits === st.total ? "HIT" : st.hits ? `HIT ${st.hits}/${st.total}` : "MISS"}`).join(", ") +
          `; reference analysis ${clock(referenceMs)} (titles ${referenceCache.titles ?? "not traced"}); matching RECOMPUTED (${clock(cache.matchingMs)}).`,
      );
      // The consolidated description of how the reference was edited.
      const grammar = referenceGrammar(dna);
      const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})).map(([k, n]) => `${n} ${k}`).join(", ");
      warnings.push(
        `Reference grammar: ${grammar.shots.length} shots (roles: ${count(grammar.shots.map((x) => x.role.interpretation))}; motion: ${count(grammar.shots.map((x) => x.motion.interpretation))}; camera: ${count(grammar.shots.map((x) => x.camera.interpretation))}); ${grammar.transitions.length} transitions (${count(grammar.transitions.map((x) => x.interpretation)) || "none"}); ${grammar.audio.anchored} of ${grammar.audio.links} visual events tied to audio; ${grammar.text.length} text intervals (${grammar.text.filter((t) => t.generated?.flagged).length} uncertain); ${grammar.depth.filter((d) => d.interpretation === "behind").length} behind the subject; ${grammar.effects.colorPulses.length} colour pulses.`,
      );
      stage(total, "Ready to preview");
      return { ...edit, dna, grammar, warnings: [...edit.warnings, ...warnings], analysisProfile: { referenceMs, footageMs, footageWallMs, clips: analysisProfile, cache } };
    },
  });
}
