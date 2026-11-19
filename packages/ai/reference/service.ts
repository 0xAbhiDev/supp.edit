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
} from "../media-analysis/model";
import { nativeColorBackend } from "../rough-cut/matching";
import { extractDNA, type StyleDNA } from "./dna";
import { buildRecreation, type Controls, type SourceEvidence } from "./planner";
import { audioTimeline, generatedSound, soundtrackAsset } from "../audio/service";
import type { AudioTimeline } from "../audio/timeline";
import type { SoundKind } from "../audio/synth";
import { buildEventGraph } from "./event-graph";
import { plannedSounds } from "./audio-structure";
import { alignStructure } from "./structural-alignment";
import { actionSignature, shotSpan } from "./action-signature";
import { medianSharpness, sceneSignature } from "./scene-signature";
import type { VisualFrame } from "./visual";
import { derivedReads, readDerived, writeDerived } from "../../platform/derived";
import { INDEX_VERSION, indexSource, sourceIndexKey, type SourceIndex } from "./footage-index";

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
  return mediaAnalysis.jobs.enqueue({
    scope: project.id,
    label: "Recreate this style · LOCAL",
    run: async (job) => {
      const caps = await mediaAnalysis.capabilities(),
        warnings: string[] = [];
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
      // Where reference analysis spends its time (each step, for the analysis profile).
      const referenceSteps: Record<string, number> = {};
      const step = async <T,>(name: string, work: Promise<T>): Promise<T> => {
        const t = performance.now();
        try {
          return await work;
        } finally {
          referenceSteps[name] = (referenceSteps[name] ?? 0) + performance.now() - t;
        }
      };
      const referenceStarted = performance.now();
      async function measureReference() {
        const measured = await step("scenes, colour, per-frame visual", visuals(reference));
        referenceFrames = measured.visual;
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
          ? (await step("beat map", run(reference, "audio"))).audio?.beatMap
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
            transcript =
              (await step("speech", run(reference, "speech"))).transcript ?? undefined;
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
        const focused=await step("titles", traceTitles(reference,dna,controls.interval,contours,referenceTranscript,quiet,undefined,controls.reviewedTitleCues));
        dna=focused.dna;
        warnings.push(...focused.warnings);
      }
      const closeMatch = controls.mode === "Close Match";
      // Modes that keep the reference's measured look need its tone and the footage's.
      const keepsLook = controls.mode !== "Creative Remix";
      // Pose-aware shot choice: the reference subject's shape per shot.
      if (caps.personModel?.installed && controls.mode !== "Creative Remix") {
        try {
          if (!referencePeople.length) referencePeople = await step("person masks", personMasks(reference, quiet));
          const annotated = { ...dna, shots: dna.shots.map((shot) => ({ ...shot })) };
          const aspect = reference.width / Math.max(1, reference.height);
          annotateSubjects(annotated, referencePeople, aspect);
          // Movement geometry with the subject's outline trajectory, on the reference's dense frames.
          referenceFrames ??= await referenceVisual(reference, quiet);
          for (const shot of annotated.shots) {
            const [from, to] = shotSpan(shot);
            const action = actionSignature(referenceFrames, referencePeople, from, to, aspect);
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
      const needSpeech = (a: Asset) =>
        a.hasAudio &&
        (/caption|speech|talking.head/i.test(controls.instructions) ||
          (controls.wording === "adapt" && !!dna.text?.length && !/["“]/.test(controls.instructions))) &&
        !!caps.model?.installed;
      const footageMs = raw.reduce((n, a) => n + a.duration * 1000, 0);
      const analysisProfile: ClipProfile[] = [];
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
        const soft = <T,>(what: string, work: () => Promise<T>) =>
          work().catch(async (e) => {
            await job.checkpoint();
            warnings.push(what + String(e).slice(0, 180));
            return undefined;
          });
        const [analysis, color, visual, aperture, tone, people, speech] = await Promise.all([
          timed(vision ? "scenes + vision" : "scenes", () => measured, () => run(a, vision ? "vision" : "video")),
          // Colour samples are cached natively (invisible here): a cached answer returns in about a
          // second whatever the footage length, a cold pass takes many; reuse is inferred from that.
          timed("colour", () => true, () => nativeColorBackend(a, { startMs: 0, endMs: Math.max(1, Math.floor(Math.min(a.duration, 300) * 1000)) }, quiet)),
          timed("per-frame visual", hit("reference-visual-v5:"), () => referenceVisual(a, quiet)),
          // Portrait delivery crops to the content; Close Match fill framing crops baked bars.
          controls.format === "vertical" || closeMatch ? timed("aperture", hit("source-aperture-v3:"), () => sourceAperture(a, quiet)) : undefined,
          keepsLook ? timed("tone", hit("source-tone-v4:"), () => soft("Footage tone could not be measured: ", () => sourceTone(a, quiet))) : undefined,
          needPeople ? timed("person masks", hit("person-mask-pphumanseg-552d8a98-v3:"), () => soft("Person segmentation unavailable: ", () => personMasks(a, quiet))) : undefined,
          needSpeech(a) ? timed("speech", () => false, () => run(a, "speech")) : undefined,
        ]);
        const evidence: SourceEvidence = { asset: a, analysis, color, visual };
        if (aperture) evidence.aperture = aperture;
        if (tone) evidence.tone = tone;
        if (people) evidence.people = people;
        if (speech) evidence.speech = speech;
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
        for (const st of stages) if (st.stage === "colour") st.reused = st.ms < 1500;
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
      const edit = buildRecreation(
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
      cache.matchingMs = Math.round(performance.now() - matchingStarted);
      warnings.push(
        "Cache: " +
          cache.stages.map((st) => `${st.stage} ${st.hits === st.total ? "HIT" : st.hits ? `HIT ${st.hits}/${st.total}` : "MISS"}`).join(", ") +
          `; reference analysis ${cache.reference.total && cache.reference.hits === cache.reference.total ? "HIT" : cache.reference.hits ? `HIT ${cache.reference.hits}/${cache.reference.total}` : "MISS"} (${clock(referenceMs)}); matching recomputed (${clock(cache.matchingMs)}).`,
      );
      stage(total, "Ready to preview");
      return { ...edit, dna, warnings: [...edit.warnings, ...warnings], analysisProfile: { referenceMs, footageMs, footageWallMs, clips: analysisProfile, cache } };
    },
  });
}
