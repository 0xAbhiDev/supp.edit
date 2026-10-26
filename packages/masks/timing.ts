import type { Clip } from "../project-schema";
/** Preserve samples at absolute timeline times when a layer's in point changes. */
export function offsetMaskKeys(c: Clip, delta: number) {
  for (const m of c.masks) {
    for (const keys of Object.values(m.keyframes))
      for (const k of keys) k.frame -= delta;
    for (const k of m.pathKeys) k.frame -= delta;
  }
}
