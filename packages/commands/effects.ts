import { editable, type Edit } from "./index";
import {
  effectInfo,
  effectStackSchema,
  type Effect,
  type EffectType,
} from "../effects/model";
import { effectValue } from "../effects/evaluate";
import { uid, type Project } from "../project-schema";
function layer(p: Project, id: string) {
  const c = editable(p, id);
  if (
    !c ||
    c.kind === "null" ||
    p.tracks.find((t) => t.id === c.trackId)?.kind !== "video"
  )
    throw new Error("Select an unlocked visual layer to edit effects");
  return c;
}
export function addEffect(
  id: string,
  type: EffectType,
  effectId: string = uid(),
): Edit {
  return (p) => {
    const c = layer(p, id);
    c.effectStack = effectStackSchema.parse([
      ...c.effectStack,
      {
        id: effectId,
        type,
        enabled: true,
        value: effectInfo[type].initial,
        keys: [],
      },
    ]);
  };
}
export function editEffect(
  id: string,
  effectId: string,
  edit: (e: Effect) => void,
): Edit {
  return (p) => {
    const c = layer(p, id),
      e = c.effectStack.find((e) => e.id === effectId);
    if (!e) throw new Error("Effect no longer exists");
    edit(e);
    effectStackSchema.parse(c.effectStack);
  };
}
export function deleteEffect(id: string, effectId: string): Edit {
  return (p) => {
    const c = layer(p, id);
    c.effectStack = c.effectStack.filter((e) => e.id !== effectId);
  };
}
export function reorderEffect(
  id: string,
  effectId: string,
  delta: number,
): Edit {
  return (p) => {
    const c = layer(p, id),
      i = c.effectStack.findIndex((e) => e.id === effectId);
    if (i < 0) throw new Error("Effect no longer exists");
    const to = Math.max(
      0,
      Math.min(c.effectStack.length - 1, i + Math.round(delta)),
    );
    c.effectStack.splice(to, 0, c.effectStack.splice(i, 1)[0]);
  };
}
export function setEffectValue(
  id: string,
  effectId: string,
  value: number,
  frame: number,
): Edit {
  return (p) => {
    const c = layer(p, id);
    editEffect(id, effectId, (e) => {
      if (!e.keys.length) e.value = value;
      else {
        const time = Math.round(frame - c.start),
          k = e.keys.find((k) => k.frame === time);
        if (k) k.value = value;
        else e.keys.push({ frame: time, value, easing: "linear" });
      }
    })(p);
  };
}
export function toggleEffectKey(
  id: string,
  effectId: string,
  frame: number,
): Edit {
  return (p) => {
    const c = layer(p, id);
    editEffect(id, effectId, (e) => {
      const time = Math.round(frame - c.start),
        value = effectValue(e, time),
        i = e.keys.findIndex((k) => k.frame === time);
      if (i < 0) e.keys.push({ frame: time, value, easing: "linear" });
      else {
        e.keys.splice(i, 1);
        if (!e.keys.length) e.value = value;
      }
    })(p);
  };
}
