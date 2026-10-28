import { z } from "zod";
import {
  type Project,
  type AnimatedProperty,
  interpolationModes,
} from "../../project-schema";
import { type Edit, moveClip, trimClip, deleteClip } from "../../commands";
import {
  addKey,
  setProperty,
  setInterpolation,
} from "../../commands/animation";
import { addEffect, setEffectValue, editEffect } from "../../commands/effects";
import { effectTypes, effectInfo } from "../../effects/model";
import { properties, propertyNames } from "../../animation";
const id = z.string().min(1).max(128),
  frame = z.number().int().min(0).max(2_000_000_000),
  value = z.number().finite();
export const toolCallSchema = z.discriminatedUnion("tool", [
  z
    .object({ tool: z.literal("clip.move"), clipId: id, startFrame: frame })
    .strict(),
  z
    .object({
      tool: z.literal("clip.trim"),
      clipId: id,
      edge: z.enum(["in", "out"]),
      targetFrame: frame,
    })
    .strict(),
  z.object({ tool: z.literal("clip.delete"), clipId: id }).strict(),
  z
    .object({
      tool: z.literal("effect.add"),
      clipId: id,
      effectId: id,
      type: z.enum(effectTypes),
      value,
    })
    .strict(),
  z
    .object({
      tool: z.literal("effect.update"),
      clipId: id,
      effectId: id,
      value,
      frame,
    })
    .strict(),
  z
    .object({
      tool: z.literal("keyframe.set"),
      clipId: id,
      property: z.enum(
        propertyNames as [AnimatedProperty, ...AnimatedProperty[]],
      ),
      value,
      frame,
      easing: z.enum(interpolationModes),
    })
    .strict(),
]);
export type EditorToolCall = z.infer<typeof toolCallSchema>;
/** Only implemented command adapters are advertised. No generated code or arbitrary property paths. */
export const editorTools = Object.freeze([
  {
    name: "clip.move",
    description: "Move an unlocked clip within its existing track",
  },
  {
    name: "clip.trim",
    description: "Trim an unlocked clip to an exact timeline frame",
  },
  {
    name: "clip.delete",
    description: "Delete an unlocked, unreferenced clip without ripple",
  },
  {
    name: "effect.add",
    description: "Add a real ordered effect with a stable ID",
  },
  {
    name: "effect.update",
    description:
      "Edit an ordered effect; animated values key at the requested frame",
  },
  {
    name: "keyframe.set",
    description:
      "Set a supported scalar keyframe using the shared animation commands",
  },
] as const);
function requireLayer(p: Project, id: string) {
  const c = p.clips.find((c) => c.id === id);
  if (!c) throw new Error("Planned layer no longer exists");
  if (p.tracks.find((t) => t.id === c.trackId)?.locked)
    throw new Error("Unlock the planned layer before applying");
  return c;
}
function range(v: number, min: number, max: number) {
  if (v < min || v > max)
    throw new Error("Requested value is outside the supported range");
}
export function toolEdit(input: unknown): Edit {
  const call = toolCallSchema.parse(input);
  return (p) => {
    const c = requireLayer(p, call.clipId);
    switch (call.tool) {
      case "clip.move":
        moveClip(c.id, call.startFrame)(p);
        break;
      case "clip.trim": {
        trimClip(c.id, call.edge, call.targetFrame)(p);
        if (
          (call.edge === "in" ? c.start : c.start + c.duration) !==
          call.targetFrame
        )
          throw new Error("Requested trim exceeds source or clip bounds");
        break;
      }
      case "clip.delete":
        deleteClip(c.id, false)(p);
        break;
      case "effect.add": {
        const info = effectInfo[call.type];
        range(call.value, info.min, info.max);
        addEffect(c.id, call.type, call.effectId)(p);
        editEffect(c.id, call.effectId, (e) => {
          e.value = call.value;
        })(p);
        break;
      }
      case "effect.update": {
        const effect = c.effectStack.find((e) => e.id === call.effectId);
        if (!effect) throw new Error("Planned effect no longer exists");
        const info = effectInfo[effect.type];
        range(call.value, info.min, info.max);
        setEffectValue(c.id, effect.id, call.value, call.frame)(p);
        break;
      }
      case "keyframe.set": {
        const info = properties[call.property];
        range(call.value, info.min, info.max);
        addKey(c.id, call.property, call.frame)(p);
        setProperty(c.id, call.property, call.value, call.frame)(p);
        setInterpolation(
          c.id,
          [{ property: call.property, frame: call.frame - c.start }],
          call.easing,
        )(p);
        break;
      }
    }
  };
}
