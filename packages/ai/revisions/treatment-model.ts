import { z } from "zod";
import { keyframeSchema } from "../../animation/schema";
import { timeRemapSchema } from "../../time-remap/model";
import { effectStackSchema } from "../../effects/model";
import { revisionRecordSchema } from "./model";
const id = z.string().min(1).max(128),
  keys = z.array(keyframeSchema).max(10000);
export const treatmentSchema = z
  .object({
    clipId: id,
    gain: z.number().finite().min(-60).max(12).optional(),
    gainKeys: keys.optional(),
    scale: z.number().finite().min(0.01).max(10).optional(),
    scaleKeys: keys.optional(),
    timeRemap: timeRemapSchema.nullable().optional(),
    effects: effectStackSchema.optional(),
  })
  .strict();
export type Treatment = z.infer<typeof treatmentSchema>;
export const treatmentRevisionSchema = z
  .object({
    sequenceId: id,
    changes: z.array(treatmentSchema).min(1).max(512),
    generated: z.array(treatmentSchema).max(512).optional(),
    record: revisionRecordSchema,
  })
  .strict();
