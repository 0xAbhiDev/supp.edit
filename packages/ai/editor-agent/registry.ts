import { z } from "zod";
import {typographyCommandSchema,createTypography} from "../../typography/commands";
import {
  type Project,
  type AnimatedProperty,
  interpolationModes,
  settingsSchema,
} from "../../project-schema";
import { type Edit, moveClip, trimClip, deleteClip } from "../../commands";
import {
  addKey,
  setProperty,
  setInterpolation,
} from "../../commands/animation";
import { addEffect, setEffectValue, editEffect } from "../../commands/effects";
import {
  effectTypes,
  effectInfo,
  grainParametersSchema,
} from "../../effects/model";
import { properties, propertyNames } from "../../animation";
import { transcriptSchema } from "../transcript";
import {
  importTranscript,
  captionsForClip,
  captionStyles,
} from "../../commands/transcripts";
import { rippleDeleteRanges } from "../../commands/nle";
import {
  createSequence,
  insertSequenceRange,
  addSequenceMarker,
} from "../../commands/sequences";
import { inComposition } from "../../commands/compositions";
import { aiEditMetadataSchema } from "../rough-cut/model";
import { sequenceRevisionSchema } from "../revisions/model";
import { reviseSequence } from "../../commands/revisions";
import { duplicateSequence, reframeSequence } from "../../commands/reframe";
import { reframeSchema } from "../reframe/model";
import { timeRemapSchema } from "../../time-remap/model";
import { setTimeRemap } from "../../commands/time-remap";
import { addPunchIn } from "../../commands/punch-in";
import { treatmentRevisionSchema } from "../revisions/treatment-model";
import {
  rememberTreatments,
  reviseTreatments,
} from "../../commands/treatments";
const id = z.string().min(1).max(128),
  frame = z.number().int().min(0).max(2_000_000_000),
  value = z.number().finite();
export const toolCallSchema = z.discriminatedUnion("tool", [
  typographyCommandSchema,
  z.object({ tool: z.literal("sequence.remember"), sequenceId: id }).strict(),
  treatmentRevisionSchema
    .extend({ tool: z.literal("sequence.treatment") })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.punchIn"),
      sequenceId: id,
      clipId: id,
      controllerId: id,
      amount: z.number().finite().nonnegative().max(0.07),
      peak: frame.positive(),
      baseScale: z.number().finite().min(0.94).max(1.04).optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.speed"),
      sequenceId: id,
      clipId: id,
      curve: timeRemapSchema,
    })
    .strict(),
  reframeSchema.extend({ tool: z.literal("sequence.reframe") }).strict(),
  z
    .object({
      tool: z.literal("sequence.duplicate"),
      sequenceId: id,
      id,
      name: z.string().min(1).max(256),
    })
    .strict(),
  sequenceRevisionSchema
    .extend({ tool: z.literal("sequence.revise") })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.create"),
      id,
      name: z.string().min(1).max(256),
      settings: settingsSchema,
      duration: frame.min(1),
      videoTrackId: id,
      audioTrackId: id,
      ai: aiEditMetadataSchema,
    })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.insert"),
      sequenceId: id,
      clipId: id,
      trackId: id,
      assetId: id,
      fingerprint: z.string().min(1).max(8192),
      startFrame: frame,
      sourceIn: frame,
      duration: frame.min(1),
      gain: value.min(-60).max(12),
    })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.marker"),
      sequenceId: id,
      id,
      frame,
      name: z.string().max(256),
    })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.keyframe"),
      sequenceId: id,
      clipId: id,
      property: z.enum(["x", "y", "scale", "gain"]),
      value,
      frame,
      easing: z.enum(interpolationModes),
    })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.effect"),
      sequenceId: id,
      clipId: id,
      effectId: id,
      type: z.enum(effectTypes),
      value,
      parameters: grainParametersSchema.optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("sequence.captions"),
      sequenceId: id,
      clipId: id,
      transcriptId: id,
      trackId: id,
      prefix: id,
      style: z.enum(captionStyles).optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("transcript.import"),
      transcript: transcriptSchema,
    })
    .strict(),
  z
    .object({
      tool: z.literal("transcript.captions"),
      transcriptId: id,
      clipId: id,
      trackId: id,
      prefix: id,
      style: z.enum(captionStyles).optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("timeline.rippleDelete"),
      ranges: z
        .array(z.object({ startFrame: frame, endFrame: frame }).strict())
        .min(1)
        .max(512),
      prefix: id,
    })
    .strict(),
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
      parameters: grainParametersSchema.optional(),
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
    name: "sequence.punchIn",
    description:
      "Compose a small zoom through an editable parent controller, preserving shot camera keys",
  },
  {
    name: "sequence.speed",
    description: "Set a source-bounded editable speed curve in a sequence",
  },
  {
    name: "sequence.reframe",
    description:
      "Apply bounded source-verified editable camera animation and portrait canvas",
  },
  {
    name: "sequence.duplicate",
    description:
      "Duplicate a sequence with fresh stable identities, preserving its source",
  },
  {
    name: "sequence.revise",
    description: "Patch an existing sequence and record one undoable revision",
  },
  {
    name: "sequence.create",
    description: "Create a new independent editable sequence with provenance",
  },
  {
    name: "sequence.insert",
    description:
      "Insert a source-bound media range into an unlocked sequence track",
  },
  {
    name: "sequence.marker",
    description: "Add a named sequence marker at a measured frame",
  },
  {
    name: "sequence.keyframe",
    description:
      "Set real transform keys through the shared animation commands",
  },
  {
    name: "sequence.effect",
    description: "Add an editable ordered effect in a named sequence",
  },
  {
    name: "sequence.captions",
    description: "Create editable timed text in a named sequence",
  },
  {
    name: "transcript.import",
    description: "Save source-bound timestamped speech in the project",
  },
  {
    name: "transcript.captions",
    description: "Create editable text layers from source speech timing",
  },
  {
    name: "timeline.rippleDelete",
    description:
      "Ripple-delete measured ranges across all unlocked sequence tracks",
  },
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
  if(call.tool === "text.create") return createTypography(call);
  if (call.tool === "sequence.punchIn")
    return inComposition(
      call.sequenceId,
      addPunchIn(
        call.clipId,
        call.controllerId,
        call.amount,
        call.peak,
        call.baseScale,
      ),
    );
  if (call.tool === "sequence.speed")
    return inComposition(
      call.sequenceId,
      setTimeRemap(call.clipId, call.curve),
    );
  if (call.tool === "sequence.reframe") {
    const { tool: _tool, ...change } = call;
    return reframeSequence(change);
  }
  if (call.tool === "sequence.duplicate")
    return duplicateSequence(call.sequenceId, call.id, call.name);
  return (p) => {
    if (call.tool === "sequence.remember") {
      rememberTreatments(call.sequenceId)(p);
      return;
    }
    if (call.tool === "sequence.treatment") {
      reviseTreatments(
        call.sequenceId,
        call.changes,
        call.record,
        call.generated,
      )(p);
      return;
    }
    if (call.tool === "sequence.revise") {
      const { tool: _tool, ...revision } = call;
      reviseSequence(revision)(p);
      return;
    }
    if (call.tool === "sequence.create") {
      createSequence(call)(p);
      return;
    }
    if (call.tool === "sequence.insert") {
      insertSequenceRange(call)(p);
      return;
    }
    if (call.tool === "sequence.marker") {
      addSequenceMarker(call.sequenceId, {
        id: call.id,
        frame: call.frame,
        name: call.name,
      })(p);
      return;
    }
    if (call.tool === "sequence.keyframe") {
      inComposition(
        call.sequenceId,
        toolEdit({
          tool: "keyframe.set",
          clipId: call.clipId,
          property: call.property,
          value: call.value,
          frame: call.frame,
          easing: call.easing,
        }),
      )(p);
      return;
    }
    if (call.tool === "sequence.effect") {
      inComposition(
        call.sequenceId,
        toolEdit({
          tool: "effect.add",
          clipId: call.clipId,
          effectId: call.effectId,
          type: call.type,
          value: call.value,
          parameters: call.parameters,
        }),
      )(p);
      return;
    }
    if (call.tool === "sequence.captions") {
      inComposition(
        call.sequenceId,
        captionsForClip(
          call.transcriptId,
          call.clipId,
          call.trackId,
          call.prefix,
          call.style,
        ),
      )(p);
      return;
    }
    if (call.tool === "transcript.import") {
      importTranscript(call.transcript)(p);
      return;
    }
    if (call.tool === "timeline.rippleDelete") {
      rippleDeleteRanges(call.ranges, call.prefix)(p);
      return;
    }
    const c = requireLayer(p, call.clipId);
    switch (call.tool) {
      case "transcript.captions":
        captionsForClip(
          call.transcriptId,
          call.clipId,
          call.trackId,
          call.prefix,
          call.style,
        )(p);
        break;
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
          if (call.parameters) e.parameters = call.parameters;
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
