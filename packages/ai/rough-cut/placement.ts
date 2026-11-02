import { fps, type Project } from "../../project-schema";
import type { BeatMap } from "../media-analysis/model";
import { cosine } from "../media-analysis/evidence";
import type { EditBrief } from "./model";
import type { EditCandidate, PlannedShot } from "./planner";
import { gymStyles } from "./styles";
import { rankHooks } from "./hooks";
import { eventImpact, type MusicEvent } from "./music";
import { nearestStrongBeat } from "./beats";

/** Source-bound scheduling. Music influences selection and a few boundaries, never a generated beat grid. */
export function placeStyledShots(
  project: Project,
  brief: EditBrief,
  candidates: readonly EditCandidate[],
  target: number,
  events: MusicEvent[],
  beatMap: BeatMap | null,
  manualOrder: boolean,
): PlannedShot[] {
  const style = gymStyles[brief.style!],
    rate = fps(project),
    minimum = Math.ceil(0.9 * rate),
    shots: PlannedShot[] = [];
  const remaining = candidates
    .map((candidate) => {
      const asset = project.assets.find(
        (a) =>
          a.id === candidate.assetId && a.fingerprint === candidate.fingerprint,
      );
      if (!asset) throw new Error("Candidate media is missing or changed");
      const start = Math.ceil((candidate.sourceStartMs * rate) / 1000),
        end = Math.min(
          Math.floor((candidate.sourceEndMs * rate) / 1000),
          Math.floor(asset.duration * rate),
        );
      return { candidate, start, end, available: end - start };
    })
    .filter((c) => c.available >= minimum);
  const hooks = rankHooks(
    remaining.map((c) => c.candidate),
    style,
    events,
  );
  const tolerance = { off: 0, loose: 120, balanced: 300, tight: 650 }[
    brief.beatSync
  ];
  let cursor = 0;
  while (remaining.length && target - cursor >= minimum) {
    const influence = brief.beatSync === "off" ? 0 : style.musicInfluence;
    const impact = eventImpact(events, (cursor / rate) * 1000, 600);
    const futureImpact = Math.max(
      0,
      ...events
        .filter(
          (e) =>
            e.timeMs > (cursor / rate + style.shotSeconds) * 1000 &&
            e.timeMs < (target / rate) * 1000,
        )
        .map((e) => eventImpact([e], e.timeMs)),
    );
    const chosen = manualOrder
      ? remaining[0]
      : shots.length === 0
        ? remaining.find((c) => c.candidate.id === hooks[0].candidate.id)!
        : [...remaining].sort(
            (a, b) => score(b.candidate) - score(a.candidate),
          )[0];
    function score(c: EditCandidate) {
      const similarity = shots.reduce(
        (n, s) =>
          Math.max(
            n,
            c.assetId === s.candidate.assetId
              ? 0.65
              : Math.max(
                  0,
                  (cosine(c.frame.embedding, s.candidate.frame.embedding) -
                    0.75) /
                    0.25,
                ),
          ),
        0,
      );
      // Reserve some stronger visual moments for a later stronger measured event.
      const eventFit =
        influence *
        (impact - 0.35 * futureImpact) *
        (0.6 * c.motionScore + 0.4 * c.overallScore);
      const previous = shots.at(-1)?.candidate;
      const flow =
        previous?.motionScore === undefined
          ? 0
          : 0.04 * (1 - Math.abs(previous.motionScore - c.motionScore));
      return (
        c.overallScore -
        (brief.style === "cinematic" ? 0.23 : 0.16) * similarity +
        eventFit +
        flow
      );
    }
    remaining.splice(remaining.indexOf(chosen), 1);
    const capacity = remaining.reduce((n, c) => n + c.available, 0),
      left = target - cursor;
    const desired = Math.round(
      (shots.length ? style.shotSeconds : style.hookSeconds) * rate,
    );
    // A hook remains 1–2s. Later shots can use more of their measured ranges to meet duration.
    let length = Math.min(
      chosen.available,
      left,
      shots.length ? Math.max(desired, left - capacity) : desired,
    );
    if (
      left - length > 0 &&
      left - length < minimum &&
      left <= chosen.available
    )
      length = left;
    const proposedMs = ((cursor + length) / rate) * 1000;
    const nearby = tolerance
      ? events
          .filter(
            (e) =>
              e.kind !== "beat" && Math.abs(e.timeMs - proposedMs) <= tolerance,
          )
          .sort((a, b) => boundaryScore(b) - boundaryScore(a))
      : [];
    function boundaryScore(e: MusicEvent) {
      const structure =
        e.kind === "section-change" || e.kind === "possible-drop" ? 1.2 : 1;
      return (
        structure * e.strength * e.confidence -
        (0.45 * Math.abs(e.timeMs - proposedMs)) / Math.max(1, tolerance)
      );
    }
    const boundary = nearby.find((e) => {
      const d = Math.round((e.timeMs * rate) / 1000) - cursor;
      return (
        d >= minimum &&
        d <= chosen.available &&
        d <= left &&
        (left - d === 0 || left - d >= minimum) &&
        (!shots.length ? d <= Math.round(2 * rate) : left - d <= capacity)
      );
    });
    if (boundary) length = Math.round((boundary.timeMs * rate) / 1000) - cursor;
    if (length < minimum) continue;
    const highlight = events
      .filter(
        (e) =>
          e.kind !== "beat" &&
          e.timeMs > (cursor / rate + 0.25) * 1000 &&
          e.timeMs < ((cursor + length) / rate - 0.25) * 1000,
      )
      .sort(
        (a, b) => eventImpact([b], b.timeMs) - eventImpact([a], a.timeMs),
      )[0];
    const offset =
      highlight && influence >= 0.4
        ? (highlight.timeMs * rate) / 1000 - cursor
        : length * 0.5;
    const sourceIn = Math.max(
      chosen.start,
      Math.min(
        chosen.end - length,
        Math.round((chosen.candidate.motionPeakMs * rate) / 1000 - offset),
      ),
    );
    shots.push({
      candidate: chosen.candidate,
      sourceIn,
      startFrame: cursor,
      duration: length,
      beatAligned: !!(
        tolerance &&
        beatMap &&
        nearestStrongBeat(
          beatMap,
          ((cursor + length) / rate) * 1000,
          500 / rate,
        )
      ),
      role: shots.length ? "BUILD" : "HOOK",
      placementReason: !shots.length
        ? `Hook rank ${hooks.findIndex((h) => h.candidate.id === chosen.candidate.id) + 1}/${hooks.length}; quality, person visibility, relevance, novelty and music compatibility`
        : boundary
          ? `Cut near ${boundary.kind}: ${boundary.evidence}`
          : "Profile pacing; measured visual-energy continuity (pose and direction unavailable)",
    });
    cursor += length;
  }
  if (shots.length > 1) shots[shots.length - 1].role = "END";
  const peak = [...shots.slice(1, -1)].sort(
    (a, b) =>
      b.candidate.motionScore +
      b.candidate.overallScore +
      style.musicInfluence * eventImpact(events, (b.startFrame / rate) * 1000) -
      (a.candidate.motionScore +
        a.candidate.overallScore +
        style.musicInfluence *
          eventImpact(events, (a.startFrame / rate) * 1000)),
  )[0];
  if (peak) peak.role = "PEAK";
  return shots;
}
