import { referenceVisual } from "./visual-source";
import { personMasks } from "./subject-mask";
import { traceTitles } from "./focus";
import { sourceTone } from "./source-tone";
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
import { alignReplacement, plannedSounds } from "./audio-structure";
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
        const analysis = await run(a, vision ? "vision" : "video");
        const color = await nativeColorBackend(
          a,
          {
            startMs: 0,
            endMs: Math.max(1, Math.floor(Math.min(a.duration, 300) * 1000)),
          },
          { ...job, report: () => {} },
        );
        const visual = await referenceVisual(a, { ...job, report: () => {} });
        return { asset: a, analysis, color, visual };
      };
      const total = raw.length + 3;
      const stage = (completed: number, detail: string) =>
        job.report({ completed, total, unit: "stages", detail });
      stage(0, "Analyzing reference");
      const quiet = { ...job, report: () => {} };
      let referenceTranscript: Project["transcripts"][number] | undefined;
      async function measureReference() {
        const measured = await visuals(reference);
        let text = null;
        try {
          text = await referenceText(reference, quiet);
          if (
            text?.length &&
            controls.subjectLayering === "reference" &&
            caps.personModel?.installed
          ) {
            try {
              const masks = await personMasks(reference, quiet);
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
          ? (await run(reference, "audio")).audio?.beatMap
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
              (await run(reference, "speech")).transcript ?? undefined;
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
          await referenceMotion(reference, quiet),
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
        const contours=caps.personModel?.installed ? await personMasks(reference,quiet) : [];
        referencePeople=contours;
        const focused=await traceTitles(reference,dna,controls.interval,contours,referenceTranscript,quiet,undefined,controls.reviewedTitleCues);
        dna=focused.dna;
        warnings.push(...focused.warnings);
      }
      const closeMatch = controls.mode === "Close Match";
      // Modes that keep the reference's measured look need its tone and the footage's.
      const keepsLook = controls.mode !== "Creative Remix";
      // Pose-aware shot choice: the reference subject's shape per shot.
      if (caps.personModel?.installed && controls.mode !== "Creative Remix") {
        try {
          if (!referencePeople.length) referencePeople = await personMasks(reference, quiet);
          const annotated = { ...dna, shots: dna.shots.map((shot) => ({ ...shot })) };
          annotateSubjects(annotated, referencePeople, reference.width / Math.max(1, reference.height));
          dna = annotated;
        } catch (e) {
          await job.checkpoint();
          warnings.push("Reference subject shape unavailable: " + String(e).slice(0, 160));
        }
      }
      if (keepsLook && dna.shots.some((shot) => !shot.tone)) {
        try {
          const samples = await sourceTone(reference, quiet);
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
          const audio = await audioTimeline(reference, words);
          if (audio) dna = { ...dna, audio, eventGraph: buildEventGraph(dna, audio, 1000 / Math.max(1, reference.fps || 30)) };
        } catch (e) {
          await job.checkpoint();
          warnings.push("Reference audio could not be measured: " + String(e).slice(0, 160));
        }
      }
      stage(1, "Extracted Style DNA");
      const sources: SourceEvidence[] = [];
      for (const a of raw) {
        stage(1 + sources.length, "Understanding " + a.name);
        const evidence: SourceEvidence = await visuals(a);
        // Portrait delivery crops to the content; Close Match fill framing crops baked bars.
        if (controls.format === "vertical" || closeMatch)
          evidence.aperture = await sourceAperture(a, quiet);
        if (keepsLook) {
          try {
            evidence.tone = await sourceTone(a, quiet);
          } catch (e) {
            await job.checkpoint();
            warnings.push("Footage tone could not be measured: " + String(e).slice(0, 160));
          }
        }
        if (
          (caps.personModel?.installed && dna.shots.some((shot) => shot.subjectShape)) ||
          controls.subjectLayering === "behind-people" ||
          (controls.subjectLayering === "reference" &&
            (!!dna.personFlashes?.length || dna.text?.some(
              (l) =>
                l.depth?.relation === "behind" &&
                l.evidence?.status !== "uncertain",
            )))
        ) {
          try {
            evidence.people = await personMasks(a, quiet);
          } catch (e) {
            await job.checkpoint();
            warnings.push(
              "Person segmentation unavailable: " + String(e).slice(0, 180),
            );
          }
        }
        if (
          a.hasAudio &&
          (/caption|speech|talking.head/i.test(controls.instructions) ||
            (controls.wording === "adapt" &&
              !!dna.text?.length &&
              !/["“]/.test(controls.instructions))) &&
          caps.model?.installed
        )
          evidence.speech = await run(a, "speech");
        sources.push(evidence);
      }
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
              span = (dna.shots.at(-1)?.endMs ?? 0) - start;
            const alignment = alignReplacement(dna.eventGraph, musicAudio, span, start);
            for (const kind of new Set(plannedSounds(dna.eventGraph, dna.audio, musicAudio, alignment, start).map((s) => s.kind)))
              sounds[kind] = await generatedSound(kind);
          }
        } catch (e) {
          await job.checkpoint();
          warnings.push("The replacement music could not be measured: " + String(e).slice(0, 160));
        }
      }
      stage(raw.length + 2, "Matching shots and building editable timeline");
      await job.checkpoint();
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
      stage(total, "Ready to preview");
      return { ...edit, dna, warnings: [...edit.warnings, ...warnings] };
    },
  });
}
