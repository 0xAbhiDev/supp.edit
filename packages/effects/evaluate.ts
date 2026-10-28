import { evaluate } from "../animation";
import type { Clip } from "../project-schema";
import { effectInfo, type Effect } from "./model";
export function effectValue(e: Effect, localFrame: number) {
  const { min, max } = effectInfo[e.type];
  return Math.max(min, Math.min(max, evaluate(e.keys, localFrame, e.value)));
}
export function resolvedEffects(c: Clip, frame: number) {
  return c.effectStack
    .filter((e) => e.enabled)
    .map((e) => ({ type: e.type, value: effectValue(e, frame - c.start) }));
}
export function offsetEffectKeys(c: Clip, delta: number) {
  for (const e of c.effectStack) for (const k of e.keys) k.frame -= delta;
}
