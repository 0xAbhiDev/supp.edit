import type { AnimatedProperty, Clip, Keyframe } from "../project-schema";
import { editable, type Edit } from "./index";
import { clampValue, propertyValue, sortedKeys, writeBase } from "../animation";

export type KeyRef = { property: AnimatedProperty; frame: number };
export type CopiedKey = KeyRef & { key: Keyframe };
const match = (ref: KeyRef, property: AnimatedProperty, frame: number) =>
  ref.property === property && ref.frame === frame;
function validFrame(frame: number) {
  if (!Number.isInteger(frame) || Math.abs(frame) > 2_000_000_000)
    throw new Error("Invalid keyframe time");
  return frame;
}
function validValue(property: AnimatedProperty, value: number) {
  if (!Number.isFinite(value)) throw new Error("Keyframe value must be finite");
  return clampValue(property, value);
}
function put(c: Clip, property: AnimatedProperty, key: Keyframe) {
  const keys = c.keyframes[property],
    existing = keys.find((k) => k.frame === key.frame);
  if (existing) Object.assign(existing, key);
  else {
    if (keys.length >= 10000)
      throw new Error("A channel can contain at most 10,000 keys");
    keys.push(key);
  }
  keys.sort((a, b) => a.frame - b.frame);
}
export function setProperty(
  id: string,
  property: AnimatedProperty,
  value: number,
  frame: number,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    value = validValue(property, value);
    if (c.keyframes[property].length) {
      const local = validFrame(Math.round(frame - c.start));
      const existing = c.keyframes[property].find((k) => k.frame === local);
      if (existing) existing.value = value;
      else put(c, property, { frame: local, value, easing: "linear" });
    } else writeBase(c, property, value);
  };
}
export function addKey(
  id: string,
  property: AnimatedProperty,
  frame: number,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (
      c &&
      !c.keyframes[property].some(
        (k) => k.frame === Math.round(frame - c.start),
      )
    )
      put(c, property, {
        frame: validFrame(Math.round(frame - c.start)),
        value: propertyValue(c, property, frame),
        easing: "linear",
      });
  };
}
export function enableAnimation(
  id: string,
  property: AnimatedProperty,
  enabled: boolean,
  frame: number,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    if (enabled) {
      if (!c.keyframes[property].length) addKey(id, property, frame)(p);
    } else {
      writeBase(c, property, propertyValue(c, property, frame));
      c.keyframes[property] = [];
    }
  };
}
export function removeKeys(id: string, refs: KeyRef[]): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    for (const ref of refs)
      c.keyframes[ref.property] = c.keyframes[ref.property].filter(
        (k) => k.frame !== ref.frame,
      );
  };
}
/** Reject collisions atomically; moving a selection never silently deletes a neighbour. */
export function moveKeys(
  id: string,
  refs: KeyRef[],
  deltaFrame: number,
  deltaValue = 0,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    const changes = refs
      .map((ref) => ({
        ref,
        key: c.keyframes[ref.property].find((k) => k.frame === ref.frame),
      }))
      .filter((x) => x.key);
    for (const { ref, key } of changes) {
      const frame = validFrame(key!.frame + Math.round(deltaFrame));
      if (
        c.keyframes[ref.property].some(
          (k) =>
            k.frame === frame &&
            !refs.some((r) => match(r, ref.property, k.frame)),
        )
      )
        throw new Error("A keyframe already exists at that time");
    }
    for (const { ref, key } of changes) {
      key!.frame += Math.round(deltaFrame);
      key!.value = validValue(ref.property, key!.value + deltaValue);
    }
    for (const property of new Set(refs.map((r) => r.property)))
      c.keyframes[property].sort((a, b) => a.frame - b.frame);
  };
}
export function copyKeys(c: Clip, refs: KeyRef[]): CopiedKey[] {
  return refs.flatMap((ref) => {
    const k = c.keyframes[ref.property].find((k) => k.frame === ref.frame);
    return k
      ? [{ ...ref, key: JSON.parse(JSON.stringify(k)) as Keyframe }]
      : [];
  });
}
export function pasteKeys(
  id: string,
  keys: CopiedKey[],
  localFrame: number,
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c || !keys.length) return;
    const first = Math.min(...keys.map((k) => k.key.frame));
    for (const { property, key } of keys) {
      const frame = validFrame(Math.round(localFrame + key.frame - first));
      if (c.keyframes[property].some((k) => k.frame === frame))
        throw new Error(
          "Paste would replace an existing keyframe; choose an empty time",
        );
    }
    for (const { property, key } of keys)
      put(c, property, {
        ...key,
        frame: validFrame(Math.round(localFrame + key.frame - first)),
      });
  };
}
export function setInterpolation(
  id: string,
  refs: KeyRef[],
  easing: Keyframe["easing"],
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    for (const ref of refs) {
      const key = c.keyframes[ref.property].find((k) => k.frame === ref.frame);
      if (key) key.easing = easing;
    }
  };
}
export function setHandle(
  id: string,
  ref: KeyRef,
  side: "inHandle" | "outHandle",
  handle: { x: number; y: number },
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) return;
    if (!Number.isFinite(handle.x) || !Number.isFinite(handle.y))
      throw new Error("Invalid tangent");
    const keys = sortedKeys(c.keyframes[ref.property]),
      i = keys.findIndex((k) => k.frame === ref.frame),
      k = keys[i];
    if (!k) return;
    const h = {
      x: Math.max(0.001, Math.min(1, handle.x)),
      y: Math.max(-100000, Math.min(100000, handle.y)),
    };
    k[side] = h;
    const controlling = side === "inHandle" ? keys[i - 1] : k;
    if (
      controlling &&
      !["bezier", "continuous-bezier"].includes(controlling.easing)
    )
      controlling.easing = "bezier";
    if (k.easing === "continuous-bezier" && keys[i - 1] && keys[i + 1]) {
      const previous = k.frame - keys[i - 1].frame,
        next = keys[i + 1].frame - k.frame;
      const opposite = side === "inHandle" ? "outHandle" : "inHandle";
      const x = k[opposite]?.x ?? 1 / 3;
      k[opposite] = {
        x,
        y: Math.max(
          -100000,
          Math.min(
            100000,
            ((-h.y * x) / h.x) *
              (side === "inHandle" ? next / previous : previous / next),
          ),
        ),
      };
      keys[i - 1].easing = "continuous-bezier";
    }
  };
}
