/** Person outlines the shot matcher may treat as a person.
 *
 * The person segmentation model answers "where is the person" on every frame, including frames
 * with nobody in them: on a countertop it outlines the most salient object (a pan, a bowl), every
 * frame. Taken as a person, such a phantom outline turns the matcher's pose, outline and subject
 * path terms (its strongest movement evidence) into noise, and decides close calls between real
 * candidates on a shape that is not there.
 *
 * The object detector, which samples the same clip independently (every 2.5 s of long scenes),
 * says whether a person is in the picture. An outline is kept as person evidence when a detector
 * sample of the same scene, within a few seconds, finds a person; it becomes "measured, nobody
 * there" when the samples around it all show no person. Where no detector sample covers it (no
 * vision model, a scene past the vision budget) the outline is kept unchanged: nothing contradicts
 * it. Only the matcher reads the confirmed outlines; subject layering masks and frame-cut
 * evidence keep the segmentation's own outlines. */
import type { PersonSample } from "./subject-mask";
import type { VisionFrame } from "../media-analysis/model";

/** The detector's lowest reported person confidence is about 0.3; anything it reports counts. */
export const PERSON_CONFIDENCE = 0.3;
/** How far from an outline a detector sample of the same scene still speaks for it. */
export const PERSON_NEAR_MS = 5000;

const personIn = (frame: Pick<VisionFrame, "detections">) =>
  frame.detections.some((d) => d.label.toLowerCase() === "person" && d.confidence >= PERSON_CONFIDENCE);

export interface PersonEvidence {
  /** Outlines for the matcher (undefined when none is a confirmed person). */
  people: PersonSample[] | undefined;
  /** Every sample, contradicted ones emptied: where the clip was measured with nobody in it. */
  samples: PersonSample[] | undefined;
  /** Outlined samples the detector contradicted. */
  rejected: number;
  /** Outlined samples no detector sample covered (kept). */
  unverified: number;
  outlined: number;
}

export function confirmedPeople(
  outlines: readonly PersonSample[] | undefined,
  frames: readonly Pick<VisionFrame, "timeMs" | "sceneStartMs" | "sceneEndMs" | "detections">[] | undefined,
): PersonEvidence {
  const outlined = outlines?.filter((p) => p.points.length).length ?? 0;
  if (!outlines?.length || !frames?.length) {
    const kept = outlines?.length ? [...outlines] : undefined;
    return { people: outlined ? kept : undefined, samples: kept, rejected: 0, unverified: outlined, outlined };
  }
  const samples = [...frames].sort((a, b) => a.timeMs - b.timeMs).map((f) => ({ t: f.timeMs, s: f.sceneStartMs, e: f.sceneEndMs, person: personIn(f) }));
  const firstFrom = (t: number) => {
    let lo = 0,
      hi = samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let rejected = 0,
    unverified = 0;
  const people = outlines.map((p) => {
    if (!p.points.length) return p;
    let covered = false,
      person = false;
    for (let k = firstFrom(p.timeMs - PERSON_NEAR_MS); k < samples.length && samples[k].t <= p.timeMs + PERSON_NEAR_MS; k++) {
      const f = samples[k];
      if (p.timeMs < f.s || p.timeMs >= f.e) continue;
      covered = true;
      if (f.person) {
        person = true;
        break;
      }
    }
    if (!covered) {
      unverified++;
      return p;
    }
    if (person) return p;
    rejected++;
    return { timeMs: p.timeMs, points: [] };
  });
  return { people: people.some((p) => p.points.length) ? people : undefined, samples: people, rejected, unverified, outlined };
}
