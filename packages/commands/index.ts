import {
  produceWithPatches,
  applyPatches,
  enablePatches,
  current,
  type Patch,
  type Draft,
} from "immer";
import {
  type Project,
  type Clip,
  type AnimatedProperty,
  fps,
  uid,
  newTrack,
  assertParenting,
} from "../project-schema";
enablePatches();
import { assertMattes } from "../compositing/model";
import { assertEffectStacks } from "../effects/model";
import { assertTimeRemaps } from "../time-remap/validate";
import { offsetSource, timelineFrameAt } from "../time-remap/model";
export {
  rippleTrim,
  rollEdit,
  slipEdit,
  slideEdit,
  sourceEdit,
  editPoints,
} from "./nle";
import { sourceEdit } from "./nle";
export type Edit = (draft: Draft<Project>) => void;
export interface HistoryEntry {
  name: string;
  forward: Patch[];
  inverse: Patch[];
  beforeVersion: number;
  afterVersion: number;
}
export class History {
  currentVersion = 0;
  private sequence = 0;
  private versions = new WeakMap<Project, number>();
  constructor(initial?: Project) {
    if (initial) this.versions.set(initial, 0);
  }
  version(project: Project) {
    return this.versions.get(project);
  }
  past: HistoryEntry[] = [];
  future: HistoryEntry[] = [];
  execute(project: Project, name: string, edit: Edit): Project {
    if (!this.versions.has(project))
      this.versions.set(project, this.currentVersion);
    const [next, forward, inverse] = produceWithPatches(project, edit);
    if (!forward.length) return project;
    assertParenting(next);
    assertMattes(next);
    assertEffectStacks(next);
    assertTimeRemaps(next);
    const modifiedAt = new Date().toISOString();
    forward.push({ op: "replace", path: ["modifiedAt"], value: modifiedAt });
    inverse.unshift({
      op: "replace",
      path: ["modifiedAt"],
      value: project.modifiedAt,
    });
    const beforeVersion = this.currentVersion,
      afterVersion = ++this.sequence;
    this.currentVersion = afterVersion;
    this.past.push({ name, forward, inverse, beforeVersion, afterVersion });
    this.future = [];
    if (this.past.length > 500) this.past.shift();
    const result = { ...next, modifiedAt };
    this.versions.set(result, afterVersion);
    return result;
  }
  undo(project: Project): Project {
    const entry = this.past.pop();
    if (!entry) return project;
    this.future.push(entry);
    const result = applyPatches(project, entry.inverse);
    this.currentVersion = entry.beforeVersion;
    this.versions.set(result, this.currentVersion);
    return result;
  }
  redo(project: Project): Project {
    const entry = this.future.pop();
    if (!entry) return project;
    this.past.push(entry);
    const result = applyPatches(project, entry.forward);
    this.currentVersion = entry.afterVersion;
    this.versions.set(result, this.currentVersion);
    return result;
  }
}
export function editable(p: Project, clipId: string) {
  const c = p.clips.find((c) => c.id === clipId);
  return c && !p.tracks.find((t) => t.id === c.trackId)?.locked ? c : undefined;
}
export function duplicateClip(id: string): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    const track = p.tracks.find((t) => t.id === c.trackId)!;
    const copy = structuredClone(current(c));
    copy.id = uid();
    copy.name += " copy";
    const nextTrack = newTrack(track.kind, p.tracks.length + 1);
    nextTrack.name = copy.name;
    p.tracks.splice(p.tracks.indexOf(track), 0, nextTrack);
    copy.trackId = nextTrack.id;
    p.clips.push(copy);
  };
}
export { evaluate, animated } from "../animation";
import { propertyValue } from "../animation";
import { offsetMaskKeys } from "../masks/timing";
import { offsetEffectKeys } from "../effects/evaluate";
import { setProperty } from "./animation";
export * from "./animation";
export function splitClip(id: string, at: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c || at <= c.start || at >= c.start + c.duration) return;
    const offset = at - c.start;
    const right: Clip = structuredClone(current(c));
    right.id = uid();
    right.start = at;
    right.duration -= offset;
    offsetSource(right, offset);
    for (const key of Object.keys(c.keyframes) as AnimatedProperty[]) {
      // Retain out-of-range keys so both pieces preserve the exact original interpolation.
      right.keyframes[key] = c.keyframes[key].map((k) => ({
        ...k,
        frame: k.frame - offset,
      }));
    }
    offsetMaskKeys(right, offset);
    offsetEffectKeys(right, offset);
    c.duration = offset;
    p.clips.push(right);
  };
}
export function trimClip(id: string, edge: "in" | "out", target: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    const asset = p.assets.find((a) => a.id === c.assetId);
    const composition =
      c.kind === "composition"
        ? p.compositions.find((x) => x.id === c.compositionId)
        : undefined;
    const max = composition
      ? Math.floor(
          (composition.duration * fps(p) * composition.settings.fps.den) /
            composition.settings.fps.num,
        )
      : asset && asset.kind !== "image"
        ? Math.floor(asset.duration * fps(p))
        : 2_000_000_000;
    if (edge === "out") {
      c.duration = Math.max(
        1,
        Math.min(target - c.start, Math.floor(timelineFrameAt(c, max) + 1e-8)),
      );
      return;
    }
    const delta = Math.max(
      Math.max(-c.start, Math.ceil(timelineFrameAt(c, 0) - 1e-8)),
      Math.min(target - c.start, c.duration - 1),
    );
    for (const key of Object.keys(c.keyframes) as AnimatedProperty[]) {
      c.keyframes[key] = c.keyframes[key].map((k) => ({
        ...k,
        frame: k.frame - delta,
      }));
    }
    offsetMaskKeys(c, delta);
    offsetEffectKeys(c, delta);
    c.start += delta;
    offsetSource(c, delta);
    c.duration -= delta;
  };
}
export function moveClip(id: string, start: number, trackId?: string): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    if (trackId) {
      const old = p.tracks.find((t) => t.id === c.trackId),
        next = p.tracks.find((t) => t.id === trackId);
      if (!next || next.locked || old?.kind !== next.kind) return;
      c.trackId = trackId;
    }
    c.start = Math.max(0, Math.round(start));
  };
}
export function deleteClip(id: string, ripple = false): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    if (p.clips.some((child) => child.parentId === id))
      throw new Error("Unparent child layers before deleting their controller");
    if (p.clips.some((child) => child.matte?.layerId === id))
      throw new Error("Remove matte references before deleting their source");
    if (ripple)
      for (const other of p.clips)
        if (other.trackId === c.trackId && other.start >= c.start + c.duration)
          other.start -= c.duration;
    p.clips = p.clips.filter((v) => v.id !== id);
  };
}
export function insertAsset(
  assetId: string,
  trackId: string,
  start: number,
): Edit {
  return (p) => {
    const asset = p.assets.find((a) => a.id === assetId),
      track = p.tracks.find((t) => t.id === trackId);
    if (
      !asset ||
      !track ||
      (asset.kind === "audio") !== (track.kind === "audio")
    )
      return;
    sourceEdit(assetId, trackId, start, "insert")(p);
  };
}
export function toggleKeyframe(
  id: string,
  key: AnimatedProperty,
  frame: number,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    const local = Math.max(0, frame - c.start),
      keys = c.keyframes[key],
      existing = keys.findIndex((k) => k.frame === local);
    if (existing !== -1) keys.splice(existing, 1);
    else
      keys.push({
        frame: local,
        value: propertyValue(c, key, frame),
        easing: "linear",
      });
    keys.sort((a, b) => a.frame - b.frame);
  };
}
export const setTransform = setProperty;
