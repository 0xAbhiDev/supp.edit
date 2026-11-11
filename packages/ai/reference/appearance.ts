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
    content: z.string().min(1).max(120).optional(),
    foreground: z
      .string()
      .regex(/^#[0-9A-F]{6}$/i)
      .optional(),
    accent: z
      .string()
      .regex(/^#[0-9A-F]{6}$/i)
      .nullable()
      .optional(),
    accentWord: z.number().int().nonnegative().max(19).nullable().optional(),
    widthChange: z.number().min(-1).max(2).optional(),
    verticalChange: z.number().min(-1).max(1).optional(),
    revealOffsetMs: z.number().int().nonnegative().nullable().optional(),
    words: z.number().int().positive().max(20),
  })
  .strict()
  .refine((x) => x.endMs > x.startMs);
export type TextAppearance = z.infer<typeof appearanceSchema>;
