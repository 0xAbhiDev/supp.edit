import { current, isDraft } from "immer";
import {
  type Clip,
  type Project,
  type AnimatedProperty,
  fps,
  newClip,
  uid,
} from "../project-schema";
import { editable, type Edit } from "./index";
import { offsetMaskKeys } from "../masks/timing";
function sourceLimit(p: Project, c: Clip) {
  const a = p.assets.find((a) => a.id === c.assetId);
  return a && a.kind !== "image"
    ? Math.floor(a.duration * fps(p))
    : 2_000_000_000;
}
function timed(p: Project, c: Clip) {
  return p.assets.some((a) => a.id === c.assetId && a.kind !== "image");
}
function offsetKeys(c: Clip, delta: number) {
  offsetMaskKeys(c, delta);
  for (const key of Object.keys(c.keyframes) as AnimatedProperty[])
    c.keyframes[key] = c.keyframes[key].map((k) => ({
      ...k,
      frame: k.frame - delta,
    }));
}
function isolated(p: Project, c: Clip) {
  if (
    p.clips.some(
      (o) =>
        o.id !== c.id &&
        o.trackId === c.trackId &&
        o.start < c.start + c.duration &&
        o.start + o.duration > c.start,
    )
  )
    throw new Error(
      "This edit requires a non-overlapping clip on its target track.",
    );
}
function neighbors(p: Project, c: Clip) {
  const before = p.clips.filter(
      (o) =>
        o.trackId === c.trackId &&
        o.id !== c.id &&
        o.start + o.duration === c.start,
    ),
    after = p.clips.filter(
      (o) =>
        o.trackId === c.trackId &&
        o.id !== c.id &&
        o.start === c.start + c.duration,
    );
  return {
    before: before.length === 1 ? before[0] : undefined,
    after: after.length === 1 ? after[0] : undefined,
  };
}
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(n)));

/** Track-local ripple: preserve other tracks and shift subsequent clips by the actual clamped change. */
export function rippleTrim(
  id: string,
  edge: "in" | "out",
  target: number,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    isolated(p, c);
    const end = c.start + c.duration;
    let delta: number;
    if (edge === "out") {
      delta = clamp(
        target - end,
        1 - c.duration,
        sourceLimit(p, c) - c.sourceIn - c.duration,
      );
      c.duration += delta;
    } else {
      const removed = clamp(
        target - c.start,
        timed(p, c) ? -c.sourceIn : -c.start,
        c.duration - 1,
      );
      c.sourceIn = Math.max(0, c.sourceIn + removed);
      c.duration -= removed;
      offsetKeys(c, removed);
      delta = -removed;
    }
    for (const other of p.clips)
      if (
        other.trackId === c.trackId &&
        other.id !== c.id &&
        other.start >= end
      )
        other.start += delta;
  };
}
export function rollEdit(id: string, edge: "in" | "out", target: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    isolated(p, c);
    const adjacent = neighbors(p, c);
    const left = edge === "out" ? c : adjacent.before,
      right = edge === "in" ? c : adjacent.after;
    if (!left || !right)
      throw new Error("Roll requires one adjacent clip at this edit point.");
    isolated(p, left);
    isolated(p, right);
    const delta = clamp(
      target - right.start,
      Math.max(
        1 - left.duration,
        timed(p, right) ? -right.sourceIn : -right.start,
      ),
      Math.min(
        right.duration - 1,
        sourceLimit(p, left) - left.sourceIn - left.duration,
      ),
    );
    left.duration += delta;
    right.start += delta;
    right.sourceIn = Math.max(0, right.sourceIn + delta);
    right.duration -= delta;
    offsetKeys(right, delta);
  };
}
export function slipEdit(id: string, delta: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    if (!timed(p, c)) throw new Error("Slip requires a video or audio source.");
    c.sourceIn = clamp(c.sourceIn + delta, 0, sourceLimit(p, c) - c.duration);
  };
}
export function slideEdit(id: string, delta: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    isolated(p, c);
    const { before: left, after: right } = neighbors(p, c);
    if (!left || !right)
      throw new Error("Slide requires contiguous neighbors on both sides.");
    isolated(p, left);
    isolated(p, right);
    delta = clamp(
      delta,
      Math.max(
        1 - left.duration,
        timed(p, right) ? -right.sourceIn : -right.start,
        -c.start,
      ),
      Math.min(
        right.duration - 1,
        sourceLimit(p, left) - left.sourceIn - left.duration,
      ),
    );
    left.duration += delta;
    c.start += delta;
    right.start += delta;
    right.sourceIn = Math.max(0, right.sourceIn + delta);
    right.duration -= delta;
    offsetKeys(right, delta);
  };
}
function piece(c: Clip, start: number, end: number, id = c.id) {
  const result = structuredClone(isDraft(c) ? current(c) : c);
  const delta = start - c.start;
  result.id = id;
  result.start = start;
  result.duration = end - start;
  result.sourceIn += delta;
  offsetKeys(result, delta);
  return result;
}
export function sourceEdit(
  assetId: string,
  trackId: string,
  start: number,
  mode: "insert" | "overwrite",
  sourceIn = 0,
  length?: number,
): Edit {
  return (p) => {
    const asset = p.assets.find((a) => a.id === assetId),
      track = p.tracks.find((t) => t.id === trackId);
    if (!asset || !track || track.locked) return;
    if ((asset.kind === "audio") !== (track.kind === "audio"))
      throw new Error("Choose a compatible target track.");
    start = Math.max(0, Math.round(start));
    sourceIn = Math.max(0, Math.round(sourceIn));
    const maximum =
      asset.kind === "image"
        ? 2_000_000_000
        : Math.floor(asset.duration * fps(p));
    if (sourceIn >= maximum)
      throw new Error("Source In is past the end of the media.");
    const duration = Math.min(
      maximum - sourceIn,
      Math.max(
        1,
        Math.round(
          length ?? (asset.kind === "image" ? fps(p) * 5 : maximum - sourceIn),
        ),
      ),
    );
    const end = start + duration,
      next: Clip[] = [];
    for (const c of p.clips) {
      if (c.trackId !== trackId) {
        next.push(c);
        continue;
      }
      const finish = c.start + c.duration;
      if (mode === "insert") {
        if (c.start < start && finish > start) {
          next.push(piece(c, c.start, start));
          const right = piece(c, start, finish, uid());
          right.start += duration;
          next.push(right);
        } else {
          if (c.start >= start) c.start += duration;
          next.push(c);
        }
      } else {
        if (finish <= start || c.start >= end) {
          next.push(c);
          continue;
        }
        if (c.start < start) next.push(piece(c, c.start, start));
        if (finish > end)
          next.push(piece(c, end, finish, c.start < start ? uid() : c.id));
      }
    }
    const added = newClip(trackId, start, duration, "media", asset);
    added.sourceIn = sourceIn;
    next.push(added);
    p.clips = next;
  };
}
export function editPoints(p: Project) {
  return [
    ...new Set([0, ...p.clips.flatMap((c) => [c.start, c.start + c.duration])]),
  ].sort((a, b) => a - b);
}
