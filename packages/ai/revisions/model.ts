import { z } from "zod";
const id = z.string().min(1).max(128);
const frame = z.number().int().min(0).max(2_000_000_000);
export const revisionRecordSchema = z
  .object({
    id,
    request: z.string().trim().min(1).max(4000),
    summary: z.string().min(1).max(2000),
    createdAt: z.string().datetime(),
    changedLayerIds: z.array(id).max(512),
  })
  .strict();
export type RevisionRecord = z.infer<typeof revisionRecordSchema>;
export const sequenceRevisionSchema = z
  .object({
    sequenceId: id,
    duration: frame.min(1),
    changes: z
      .array(
        z
          .object({
            clipId: id,
            start: frame,
            duration: frame.min(1),
            source: z
              .object({
                assetId: id,
                fingerprint: z.string().min(1).max(8192),
                sourceIn: frame,
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(512),
    remove: z.array(id).max(512),
    // Explicit marker movements preserve names and unrelated user markers.
    markers: z.array(z.object({ id, frame }).strict()).max(10000),
    record: revisionRecordSchema,
  })
  .strict();
export type SequenceRevision = z.infer<typeof sequenceRevisionSchema>;
