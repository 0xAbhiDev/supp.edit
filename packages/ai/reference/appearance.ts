import { z } from "zod";
const unit = z.number().finite().min(0).max(1);
export const appearanceSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    x: unit,
    y: unit,
    width: unit,
    height: unit,
    words: z.number().int().positive().max(20),
  })
  .strict()
  .refine((x) => x.endMs > x.startMs);
export type TextAppearance = z.infer<typeof appearanceSchema>;
