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
  type Keyframe,
  type AnimatedProperty,
  fps,
  uid,
} from "../project-schema";
enablePatches();
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
export function evaluate(
  keys: Keyframe[],
  frame: number,
  base: number,
): number {
  if (!keys.length) return base;
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return sorted[0].value;
  const right = sorted.findIndex((k) => k.frame > frame);
  if (right === -1) return sorted[sorted.length - 1].value;
  const a = sorted[right - 1],
    b = sorted[right];
  let t = (frame - a.frame) / (b.frame - a.frame);
  if (a.easing === "hold") t = 0;
  if (a.easing === "ease-in-out") t = t * t * (3 - 2 * t);
  return a.value + (b.value - a.value) * t;
}
export function animated(clip: Clip, frame: number) {
  const t = { ...clip.transform };
  for (const key of Object.keys(clip.keyframes) as AnimatedProperty[])
    t[key] = evaluate(clip.keyframes[key], frame - clip.start, t[key]);
  t.opacity = Math.min(1, Math.max(0, t.opacity));
  t.scale = Math.min(10, Math.max(0.01, t.scale));
  return t;
}
export function splitClip(id: string, at: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c || at <= c.start || at >= c.start + c.duration) return;
    const offset = at - c.start;
    const right: Clip = structuredClone(current(c));
    right.id = uid();
    right.start = at;
    right.duration -= offset;
    right.sourceIn += offset;
    for (const key of Object.keys(c.keyframes) as AnimatedProperty[]) {
      // Retain out-of-range keys so both pieces preserve the exact original interpolation.
      right.keyframes[key] = c.keyframes[key].map((k) => ({
        ...k,
        frame: k.frame - offset,
      }));
    }
    c.duration = offset;
    p.clips.push(right);
  };
}
export function trimClip(id: string, edge: "in" | "out", target: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    const asset = p.assets.find((a) => a.id === c.assetId);
    const max =
      asset && asset.kind !== "image"
        ? Math.floor(asset.duration * fps(p))
        : 2_000_000_000;
    if (edge === "out") {
      c.duration = Math.max(1, Math.min(target - c.start, max - c.sourceIn));
      return;
    }
    const delta = Math.max(
      -Math.min(c.start, c.sourceIn),
      Math.min(target - c.start, c.duration - 1),
    );
    for (const key of Object.keys(c.keyframes) as AnimatedProperty[]) {
      c.keyframes[key] = c.keyframes[key].map((k) => ({
        ...k,
        frame: k.frame - delta,
      }));
    }
    c.start += delta;
    c.sourceIn += delta;
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
        value: animated(c, frame)[key],
        easing: "linear",
      });
    keys.sort((a, b) => a.frame - b.frame);
  };
}
export function setTransform(
  id: string,
  key: keyof Clip["transform"],
  value: number,
  frame: number,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    const keys = key in c.keyframes ? c.keyframes[key as AnimatedProperty] : [];
    if (keys.length) {
      const local = Math.max(0, frame - c.start),
        existing = keys.find((k) => k.frame === local);
      if (existing) existing.value = value;
      else keys.push({ frame: local, value, easing: "linear" });
      keys.sort((a, b) => a.frame - b.frame);
    } else c.transform[key] = value;
  };
}
