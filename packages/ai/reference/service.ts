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
        return { asset: a, analysis, color };
      };
      const total = raw.length + 3;
      const stage = (completed: number, detail: string) =>
        job.report({ completed, total, unit: "stages", detail });
      stage(0, "Analyzing reference");
      const quiet = { ...job, report: () => {} };
      async function measureReference() {
        const measured = await visuals(reference);
        let text = null;
        try {
          text = await referenceText(reference, quiet);
        } catch (e) {
          await job.checkpoint();
          warnings.push(
            "Reference text analysis unavailable: " + String(e).slice(0, 240),
          );
        }
        const refMusic = reference.hasAudio
          ? (await run(reference, "audio")).audio?.beatMap
          : undefined;
        return extractDNA(
          reference,
          measured.analysis,
          refMusic,
          measured.color,
          await referenceMotion(reference, quiet),
          text,
        );
      }
      const dna = profile ?? (await measureReference());
      stage(1, "Extracted Style DNA");
      const sources: SourceEvidence[] = [];
      for (const a of raw) {
        stage(1 + sources.length, "Understanding " + a.name);
        const evidence: SourceEvidence = await visuals(a);
        if (
          a.hasAudio &&
          /caption|speech|talking.head/i.test(controls.instructions) &&
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
      );
      stage(total, "Ready to preview");
      return { ...edit, dna, warnings: [...edit.warnings, ...warnings] };
    },
  });
}
