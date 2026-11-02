import type { EditCandidate } from "./planner";
import type { GymStyleProfile } from "./styles";
import { cosine } from "../media-analysis/evidence";
import { eventImpact, type MusicEvent } from "./music";
const unit = (v: number) => Math.max(0, Math.min(1, v));
export function styleRelevance(
  candidate: Pick<EditCandidate, "frame" | "semanticScore">,
  profile: GymStyleProfile,
) {
  if (!profile.preferredLabels.length) return candidate.semanticScore;
  const labels = candidate.frame.labels.filter((l) =>
    profile.preferredLabels.includes(l.label),
  );
  return labels.reduce(
    (n, l) => Math.max(n, unit((l.similarity - 0.18) / 0.17)),
    0,
  );
}
export function rankHooks(
  candidates: readonly EditCandidate[],
  profile: GymStyleProfile,
  events: readonly MusicEvent[],
) {
  const openingImpact = eventImpact(
    events,
    profile.hookSeconds * 500,
    profile.hookSeconds * 500,
  );
  return candidates
    .map((c) => {
      const others = candidates
        .filter((o) => o.assetId !== c.assetId)
        .slice(0, 32);
      const novelty = others.length
        ? 1 -
          others.reduce(
            (sum, o) =>
              sum +
              unit((cosine(c.frame.embedding, o.frame.embedding) - 0.7) / 0.3),
            0,
          ) /
            others.length
        : 0;
      const music = 1 - Math.abs(c.motionScore - openingImpact);
      const relevance =
        0.6 * c.promptRelevance + 0.4 * styleRelevance(c, profile);
      const h = profile.hook,
        score =
          h.quality * c.visualQuality +
          h.visibility * c.subjectScore +
          h.motion * c.motionScore +
          h.relevance * relevance +
          h.novelty * novelty +
          h.music * music;
      return { candidate: c, score, novelty, musicCompatibility: music };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.candidate.id.localeCompare(b.candidate.id),
    );
}
