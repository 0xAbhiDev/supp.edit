import { current } from "immer";
import {
  newClip,
  newTrack,
  uid,
  projectSchema,
  type Project,
  type Composition,
} from "../project-schema";
import type { Edit } from "./index";

// The main sequence keeps its v1/v2 representation. A composition is a scoped
// view of the same clip/track model, so animation and editor commands are shared.
const views = new WeakMap<Project, Map<string, Project>>();
export function compositionView(project: Project, id: string | null): Project {
  if (!id) return project;
  const comp = project.compositions.find((c) => c.id === id);
  if (!comp) return project;
  let cache = views.get(project);
  if (!cache) views.set(project, (cache = new Map()));
  let view = cache.get(id);
  if (!view) {
    view = {
      ...project,
      name: comp.name,
      settings: comp.settings,
      tracks: comp.tracks,
      clips: comp.layers,
      markers: [],
    };
    cache.set(id, view);
  }
  return view;
}
export function inComposition(id: string | null, edit: Edit): Edit {
  if (!id)
    return (p) => {
      edit(p);
      projectSchema.parse(p);
    };
  return (p) => {
    const c = p.compositions.find((c) => c.id === id);
    if (!c) throw new Error("Composition no longer exists");
    const view = {
      ...p,
      name: c.name,
      settings: c.settings,
      tracks: c.tracks,
      clips: c.layers,
      markers: [],
    };
    edit(view);
    c.name = view.name;
    c.settings = view.settings;
    c.tracks = view.tracks;
    c.layers = view.clips;
    // Structure is small: validate here, never while rendering a frame.
    projectSchema.parse(p);
  };
}
export function createComposition(
  name: string,
  length = 150,
  id: string = uid(),
): Edit {
  return (p) => {
    p.compositions.push({
      id,
      name,
      settings: { ...p.settings },
      duration: length,
      background: "transparent",
      tracks: [newTrack("video", 1)],
      layers: [],
    });
  };
}
export function addCompositionLayer(compositionId: string, start = 0): Edit {
  return (p) => {
    const comp = p.compositions.find((c) => c.id === compositionId);
    if (!comp) throw new Error("Composition no longer exists");
    const track = newTrack("video", p.tracks.length + 1);
    track.name = comp.name;
    const length = Math.floor(
      (comp.duration * (p.settings.fps.num / p.settings.fps.den)) /
        (comp.settings.fps.num / comp.settings.fps.den),
    );
    const clip = newClip(track.id, start, length, "composition");
    clip.name = comp.name;
    clip.compositionId = comp.id;
    p.tracks.unshift(track);
    p.clips.push(clip);
  };
}
export function precompose(
  ids: string[],
  name: string,
  id: string = uid(),
): Edit {
  return (p) => {
    const selected = p.clips.filter((c) => ids.includes(c.id));
    if (!selected.length) throw new Error("Select at least one layer");
    if (
      p.clips.some(
        (c) => c.parentId && ids.includes(c.id) !== ids.includes(c.parentId),
      )
    )
      throw new Error(
        "Select the complete parent hierarchy before precomposing",
      );
    if (selected.some((c) => p.tracks.find((t) => t.id === c.trackId)?.locked))
      throw new Error("Unlock selected layers first");
    if (
      selected.some(
        (c) => p.tracks.find((t) => t.id === c.trackId)?.kind !== "video",
      )
    )
      throw new Error("Precompose visual layers only");
    // Require a contiguous visual stack to preserve compositing order.
    const tracks = p.tracks.filter((t) =>
      selected.some((c) => c.trackId === t.id),
    );
    const indices = tracks.map((t) => p.tracks.indexOf(t));
    if (Math.max(...indices) - Math.min(...indices) + 1 !== tracks.length)
      throw new Error("Select a contiguous stack of tracks");
    const start = Math.min(...selected.map((c) => c.start)),
      end = Math.max(...selected.map((c) => c.start + c.duration));
    if (
      p.clips.some(
        (c) =>
          !ids.includes(c.id) &&
          tracks.some((t) => t.id === c.trackId) &&
          c.start < end &&
          c.start + c.duration > start,
      )
    )
      throw new Error(
        "Select all overlapping clips on these tracks before precomposing",
      );
    const mapping = new Map(tracks.map((t) => [t.id, uid()]));
    const comp: Composition = {
      id,
      name,
      settings: { ...p.settings },
      duration: end - start,
      background: "transparent",
      tracks: tracks.map((t) => ({ ...t, id: mapping.get(t.id)! })),
      layers: selected.map((c) => ({
        ...structuredClone(current(c)),
        trackId: mapping.get(c.trackId)!,
        start: c.start - start,
      })),
    };
    p.compositions.push(comp);
    p.clips = p.clips.filter((c) => !ids.includes(c.id));
    const track = newTrack("video", p.tracks.length + 1);
    track.name = name;
    p.tracks.splice(Math.min(...indices), 0, track);
    const layer = newClip(track.id, start, end - start, "composition");
    layer.name = name;
    layer.compositionId = id;
    p.clips.push(layer);
  };
}
export function deleteComposition(id: string): Edit {
  return (p) => {
    if (
      [...p.clips, ...p.compositions.flatMap((c) => c.layers)].some(
        (c) => c.compositionId === id,
      )
    )
      throw new Error(
        "Remove composition instances before deleting their source",
      );
    p.compositions = p.compositions.filter((c) => c.id !== id);
  };
}
