import { type Edit } from "./index";
import {
  type Project,
  newTrack,
  newClip,
  projectSchema,
} from "../project-schema";
import { type AIEditMetadata } from "../ai/rough-cut/model";
import { inComposition } from "./compositions";
import { sourceEdit } from "./nle";
export function createSequence(input: {
  id: string;
  name: string;
  settings: Project["settings"];
  duration: number;
  videoTrackId: string;
  audioTrackId: string;
  /** Name of the default audio track; `audioTrack: false` creates none (nothing would use it). */
  audioTrackName?: string;
  audioTrack?: boolean;
  ai: AIEditMetadata;
}): Edit {
  return (p) => {
    if (p.compositions.some((c) => c.id === input.id))
      throw new Error("Sequence ID already exists");
    const video = {
        ...newTrack("video", 1),
        id: input.videoTrackId,
        name: "Selected moments",
      },
      audio = {
        ...newTrack("audio", 1),
        id: input.audioTrackId,
        name: input.audioTrackName ?? "Music",
      };
    p.compositions.push({
      id: input.id,
      name: input.name,
      settings: { ...input.settings },
      duration: input.duration,
      background: "#000000",
      tracks: input.audioTrack === false ? [video] : [video, audio],
      layers: [],
      markers: [],
      ai: input.ai,
    });
  };
}
export function insertSequenceRange(input: {
  sequenceId: string;
  clipId: string;
  trackId: string;
  assetId: string;
  fingerprint: string;
  startFrame: number;
  sourceIn: number;
  duration: number;
  gain: number;
}): Edit {
  return inComposition(input.sequenceId, (p) => {
    const asset = p.assets.find((a) => a.id === input.assetId),
      track = p.tracks.find((t) => t.id === input.trackId);
    if (!asset || asset.fingerprint !== input.fingerprint)
      throw new Error("Planned media is missing or changed");
    if (!track || track.locked)
      throw new Error("Planned track is missing or locked");
    if (
      p.clips.some(
        (c) =>
          c.id === input.clipId ||
          (c.trackId === track.id &&
            c.start < input.startFrame + input.duration &&
            c.start + c.duration > input.startFrame),
      )
    )
      throw new Error("Planned insertion overlaps an existing clip");
    sourceEdit(
      input.assetId,
      input.trackId,
      input.startFrame,
      "overwrite",
      input.sourceIn,
      input.duration,
      input.clipId,
    )(p);
    const added = p.clips.find((c) => c.id === input.clipId);
    if (!added || added.duration !== input.duration)
      throw new Error("Planned media range exceeds the source");
    added.gain = input.gain;
  });
}
export function addSequenceMarker(
  sequenceId: string,
  marker: { id: string; frame: number; name: string },
): Edit {
  return (p) => {
    const c = p.compositions.find((c) => c.id === sequenceId);
    if (!c) throw new Error("Sequence no longer exists");
    if (marker.frame >= c.duration)
      throw new Error("Marker is beyond the planned sequence");
    (c.markers ??= []).push({ ...marker });
  };
}
/** A valid export graph with one root instance avoids duplicating globally unique layer IDs. */
export function sequenceExportSnapshot(
  project: Project,
  sequenceId: string | null,
): Project {
  if (!sequenceId) return project;
  const c = project.compositions.find((c) => c.id === sequenceId);
  if (!c) throw new Error("Choose an existing sequence");
  const track = newTrack("video", 1),
    layer = newClip(track.id, 0, c.duration, "composition");
  layer.compositionId = c.id;
  layer.name = c.name;
  return projectSchema.parse({
    ...project,
    name: c.name,
    settings: c.settings,
    tracks: [track],
    clips: [layer],
    markers: [],
  });
}
