import { type Project, type Clip, uid } from "../../project-schema";
import { type SequenceRevision } from "./model";
import { previewEditPlan } from "../editor-agent/execution";
import { type MediaAnalysis } from "../media-analysis/model";
import { type RankedEvidence } from "../rough-cut/planner";
import { strongEvents } from "../rough-cut/beats";
import {
  replaceRequest,
  removeRequest,
  strongestRequest,
  tighterMusicRequest,
  ordinalIndex,
} from "./requests";

export function revisionTarget(project: Project, activeId: string | null) {
  if (activeId) {
    const target = project.compositions.find((c) => c.id === activeId);
    if (!target) throw new Error("The active sequence no longer exists");
    return target;
  }
  if (project.compositions.length === 1) return project.compositions[0];
  throw new Error("Select the sequence you want to revise in the timeline");
}

/** Revises current ranges in place. It deliberately never calls the rough-cut builder. */
export function planRevision(
  request: string,
  project: Project,
  revision: number,
  activeId: string | null,
  analyses: readonly MediaAnalysis[] = [],
  evidence?: RankedEvidence,
) {
  const c = revisionTarget(project, activeId),
    rate = c.settings.fps.num / c.settings.fps.den;
  const shots = c.layers
    .filter(
      (l) =>
        l.kind === "media" &&
        project.assets.find((a) => a.id === l.assetId)?.kind === "video",
    )
    .sort((a, b) => a.start - b.start);
  if (!shots.length)
    throw new Error("This sequence has no video shots to revise");
  if (shots.length > 256)
    throw new Error("Revise up to 256 shots in one request");
  // A montage with gaps, multiple camera tracks or nested edits needs an explicit selection.
  if (
    shots.some(
      (s, i) =>
        s.trackId !== shots[0].trackId ||
        s.start !== (i ? shots[i - 1].start + shots[i - 1].duration : 0),
    )
  )
    throw new Error(
      "This revision needs a contiguous video edit on one track; preserve other layouts with precise clip commands",
    );
  const oldEnd = shots.at(-1)!.start + shots.at(-1)!.duration;
  let order = shots.map((s) => ({ ...s })),
    summary = "";
  const remove: string[] = [],
    changes: SequenceRevision["changes"] = [];
  const durations = request.match(
    /(?:make (?:it|this)|shorten (?:it|this) to)\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i,
  );
  if (
    durations ||
    (!tighterMusicRequest.test(request) &&
      /make (?:it|this) shorter|tighten (?:the )?cuts/i.test(request))
  ) {
    const target = durations
      ? Math.round(Number(durations[1]) * rate)
      : Math.round(oldEnd * 0.8);
    if (target >= oldEnd || target < Math.max(3 * rate, shots.length))
      throw new Error("Choose a shorter duration of at least three seconds");
    // Cumulative rounding gives the requested duration exactly, without frame drift.
    order = order.map((s) => ({
      ...s,
      duration:
        Math.round(((s.start + s.duration) * target) / oldEnd) -
        Math.round((s.start * target) / oldEnd),
    }));
    summary = `Shorten ${c.name} from ${(oldEnd / rate).toFixed(2)}s to ${(target / rate).toFixed(2)}s; keep all ${shots.length} shots`;
  } else if (/use (?:an?other|different) clip first/i.test(request)) {
    const index = order.findIndex((s) => s.assetId !== order[0].assetId);
    if (index < 0)
      throw new Error(
        "There is no different source in this sequence to use first",
      );
    const [first] = order.splice(index, 1);
    order.unshift(first);
    summary = `Move ${first.name} to the opening; keep the existing source ranges`;
  } else if (strongestRequest.test(request)) {
    if (!evidence)
      throw new Error(
        "Analyze the current sources to compare the opening shots",
      );
    const scores = order.map((s) => ({
      id: s.id,
      score: Math.max(
        -1,
        ...evidence.candidates
          .filter(
            (x) =>
              x.assetId === s.assetId &&
              x.sourceStartMs < ((s.sourceIn + s.duration) * 1000) / rate &&
              x.sourceEndMs > (s.sourceIn * 1000) / rate,
          )
          .map((x) => x.overallScore),
      ),
    }));
    const best = scores.sort((a, b) => b.score - a.score)[0];
    if (best.score < 0)
      throw new Error("No source-bound evidence matches the current shots");
    const index = order.findIndex((s) => s.id === best.id),
      [first] = order.splice(index, 1);
    order.unshift(first);
    summary = `Move the highest-ranked current shot (${first.name}) to the opening`;
  } else if (removeRequest.test(request)) {
    if (order.length < 2) throw new Error("Keep at least one shot in the edit");
    const ordinal = removeRequest.exec(request)![1],
      index = /final|last/i.test(ordinal)
        ? order.length - 1
        : ordinalIndex(ordinal)!;
    if (!order[index])
      throw new Error(`There is no ${ordinal} shot in this sequence`);
    remove.push(order.splice(index, 1)[0].id);
    summary = `Remove shot ${index + 1} and shorten the music to the new ending`;
  } else if (
    /opening faster|faster opening|intro faster|first \d+ seconds faster/i.test(
      request,
    )
  ) {
    const count = request.match(/first (\d+) seconds/i),
      until = count ? Number(count[1]) * rate : order[0].duration;
    order = order.map((s) => ({
      ...s,
      duration:
        s.start < until
          ? Math.max(1, Math.round(s.duration * 0.65))
          : s.duration,
    }));
    summary =
      "Tighten opening shot durations to 65%; preserve playback speed and all later source ranges";
  } else if (
    /sync (?:the )?ending/i.test(request) ||
    tighterMusicRequest.test(request)
  ) {
    const music = c.layers.filter(
      (l) => project.assets.find((a) => a.id === l.assetId)?.kind === "audio",
    );
    if (music.length !== 1)
      throw new Error("Ending sync needs one music clip in this sequence");
    const m = music[0],
      asset = project.assets.find((a) => a.id === m.assetId)!;
    const map = analyses.find(
      (a) =>
        a.assetId === asset.id &&
        a.fingerprint === asset.fingerprint &&
        a.audio,
    )?.audio?.beatMap;
    if (!map)
      throw new Error(
        "Analyze the sequence music before synchronizing its ending",
      );
    if (tighterMusicRequest.test(request)) {
      const events = strongEvents(map).map(
        (b) => Math.round((b.timeMs * rate) / 1000) - m.sourceIn + m.start,
      );
      let boundary = 0;
      for (let i = 0; i < order.length - 1; i++) {
        const shot = order[i],
          asset = project.assets.find((a) => a.id === shot.assetId)!;
        const oldBoundary = shot.start + shot.duration;
        const aligned =
          events
            .filter(
              (f) =>
                f > boundary + rate * 0.6 &&
                f < order[i + 1].start + order[i + 1].duration - rate * 0.6 &&
                f - boundary + shot.sourceIn <=
                  Math.floor(asset.duration * rate) &&
                Math.abs(f - oldBoundary) <= rate * 0.3,
            )
            .sort(
              (a, b) => Math.abs(a - oldBoundary) - Math.abs(b - oldBoundary),
            )[0] ?? oldBoundary;
        shot.duration = aligned - boundary;
        boundary = aligned;
      }
      order.at(-1)!.duration = oldEnd - boundary;
      summary =
        "Move nearby cut boundaries to measured strong music events within 300ms; preserve total duration";
    } else {
      const last = order.at(-1)!;
      const event = strongEvents(map)
        .map((b) => Math.round((b.timeMs * rate) / 1000) - m.sourceIn + m.start)
        .filter(
          (f) =>
            f <= oldEnd &&
            f > last.start + rate * 0.6 &&
            f >= oldEnd - rate * 2,
        )
        .at(-1);
      if (event === undefined || event === oldEnd)
        throw new Error(
          event === oldEnd
            ? "The ending is already on a measured strong beat"
            : "No measured strong beat is close enough to the ending",
        );
      last.duration = event - last.start;
      summary = `End on the measured music event at ${(event / rate).toFixed(2)}s`;
    }
  } else if (
    replaceRequest.test(request) ||
    /use more|less bench/i.test(request)
  ) {
    if (!evidence?.candidates.length)
      throw new Error("Analyze the source footage to choose a replacement");
    const explicit = replaceRequest.exec(request),
      less = /less bench/i.test(request);
    const semanticScore = (s: Clip) =>
      Math.max(
        -1,
        ...evidence.candidates
          .filter(
            (x) =>
              x.assetId === s.assetId &&
              x.sourceStartMs < ((s.sourceIn + s.duration) * 1000) / rate &&
              x.sourceEndMs > (s.sourceIn * 1000) / rate,
          )
          .map((x) => x.promptRelevance),
      );
    const ranked = [...order].sort((a, b) =>
      less
        ? semanticScore(b) - semanticScore(a)
        : semanticScore(a) - semanticScore(b),
    );
    const index = explicit
        ? ordinalIndex(explicit[1])!
        : order.findIndex((s) => s.id === ranked[0].id),
      old = order[index];
    if (!old)
      throw new Error(`There is no ${explicit?.[1]} shot in this sequence`);
    if (
      c.layers.some(
        (l) =>
          l.kind === "text" &&
          l.start < old.start + old.duration &&
          l.start + l.duration > old.start,
      )
    )
      throw new Error(
        "Replacement would leave existing text/captions attached to different footage. Remove or revise those captions first",
      );
    const used = new Set(order.map((s) => s.assetId));
    const candidates = evidence.candidates.filter(
      (x) =>
        x.assetId !== old.assetId &&
        Math.floor((x.sourceEndMs * rate) / 1000) -
          Math.ceil((x.sourceStartMs * rate) / 1000) >=
          old.duration,
    );
    const candidate = explicit
      ? (candidates.find((x) => !used.has(x.assetId)) ?? candidates[0])
      : candidates.find((x) =>
          less
            ? x.promptRelevance < semanticScore(old) - 0.02
            : x.promptRelevance > semanticScore(old) + 0.02,
        );
    if (!candidate)
      throw new Error(
        "No suitable different source has enough footage for this shot",
      );
    const asset = project.assets.find((a) => a.id === candidate.assetId)!;
    const sourceIn = Math.max(
      Math.ceil((candidate.sourceStartMs * rate) / 1000),
      Math.min(
        Math.floor((candidate.sourceEndMs * rate) / 1000) - old.duration,
        Math.round((candidate.motionPeakMs * rate) / 1000 - old.duration / 2),
      ),
    );
    order[index] = { ...old, assetId: asset.id, sourceIn, name: asset.name };
    changes.push({
      clipId: old.id,
      start: old.start,
      duration: old.duration,
      source: { assetId: asset.id, fingerprint: asset.fingerprint, sourceIn },
    });
    summary = `Replace shot ${index + 1} with ${asset.name}, preserving its duration and layer edits${explicit ? "" : "; selected by visual similarity, exercise identity is uncertain"}`;
  } else if (/remove captions/i.test(request)) {
    const captionTracks = new Set(
      c.tracks.filter((t) => /captions/i.test(t.name)).map((t) => t.id),
    );
    remove.push(
      ...c.layers
        .filter((l) => l.kind === "text" && captionTracks.has(l.trackId))
        .map((l) => l.id),
    );
    if (!remove.length)
      throw new Error("There are no caption text layers in this sequence");
    summary = `Remove ${remove.length} caption layers; preserve other text and video`;
  } else
    throw new Error(
      "Supported revisions: make it shorter / 20 seconds, another clip first, replace third shot, remove final clip, faster opening, tighten cuts, sync ending, use more of an exercise, or remove captions",
    );

  let end = 0;
  for (const s of order) {
    s.start = end;
    end += s.duration;
  }
  function change(clip: Clip, start: number, duration: number) {
    const existing = changes.find((x) => x.clipId === clip.id);
    if (existing) {
      existing.start = start;
      existing.duration = duration;
    } else if (start !== clip.start || duration !== clip.duration)
      changes.push({ clipId: clip.id, start, duration });
  }
  for (const s of order)
    change(
      shots.find((x) => x.id === s.id)!,
      s.start,
      s.duration,
    );
  const remap = (frame: number) => {
    const old = shots.find(
      (s) => frame >= s.start && frame < s.start + s.duration,
    );
    const next = order.find((s) => s.id === old?.id);
    return next && old
      ? next.start + Math.min(frame - old.start, next.duration - 1)
      : Math.max(0, end - 1);
  };
  for (const layer of c.layers.filter(
    (l) => !shots.some((s) => s.id === l.id) && !remove.includes(l.id),
  )) {
    if (
      end === oldEnd &&
      order.every((s) => s.start === shots.find((x) => x.id === s.id)!.start)
    )
      continue;
    const audio =
      project.assets.find((a) => a.id === layer.assetId)?.kind === "audio";
    if (audio && layer.start === 0 && layer.start + layer.duration >= oldEnd) {
      change(layer, 0, end);
      continue;
    }
    const anchor = shots.find(
        (s) =>
          layer.start >= s.start &&
          layer.start + layer.duration <= s.start + s.duration,
      ),
      next = order.find((s) => s.id === anchor?.id);
    if (!anchor || !next || layer.start - anchor.start >= next.duration)
      throw new Error(
        `Revision would detach “${layer.name}” from its shot. Adjust that layer first or use a precise clip edit`,
      );
    change(
      layer,
      next.start + layer.start - anchor.start,
      Math.min(layer.duration, next.duration - (layer.start - anchor.start)),
    );
  }
  if (!changes.length && !remove.length)
    throw new Error("This request already matches the current edit");
  const record = {
    id: uid(),
    request,
    summary,
    createdAt: new Date().toISOString(),
    changedLayerIds: [...changes.map((x) => x.clipId), ...remove],
  };
  const call: SequenceRevision = {
    sequenceId: c.id,
    duration: end,
    changes,
    remove,
    markers: (c.markers ?? [])
      .map((m) => ({ id: m.id, frame: remap(m.frame) }))
      .filter((m) => m.frame !== c.markers?.find((x) => x.id === m.id)?.frame),
    record,
  };
  return previewEditPlan(
    {
      id: uid(),
      projectId: project.id,
      revision,
      compositionId: null,
      resultCompositionId: c.id,
      processing: "LOCAL",
      summary,
      commands: [{ tool: "sequence.revise", ...call }],
    },
    project,
    revision,
  );
}
