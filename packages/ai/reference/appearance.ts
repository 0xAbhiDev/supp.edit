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
    role: z.enum(["caption", "persistent-overlay"]).optional(),
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

/** Flag recurring edge labels (including OCR variants) without guessing their words. */
export function classifyTextOverlays(
  text: readonly TextAppearance[],
  durationMs: number,
): TextAppearance[] {
  const token = (s: string) =>
    s.toLocaleUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
  return text.map((t) => {
    const name = token(t.content ?? "");
    if (t.words !== 1 || name.length < 7) return { ...t };
    const peers = text.filter((other) => {
      const candidate = token(other.content ?? "");
      return (
        other.words === 1 &&
        candidate.length >= 7 &&
        (candidate.slice(-7) === name.slice(-7) ||
          candidate.slice(1).includes(name.slice(1)) ||
          name.slice(1).includes(candidate.slice(1)))
      );
    });
    const intervals = peers
      .map((p) => [p.startMs, p.endMs])
      .sort((a, b) => a[0] - b[0]);
    let coverage = 0,
      end = 0;
    for (const [a, b] of intervals) {
      coverage += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
    const edge = peers.filter(
      (p) => p.x > 0.7 || p.x + p.width < 0.3 || p.y > 0.8,
    );
    const recurring =
      peers.length >= 4 &&
      edge.length >= peers.length / 2 &&
      coverage >= durationMs * 0.18 &&
      end - intervals[0][0] >= durationMs * 0.5;
    return {
      ...t,
      ...(recurring ? { role: "persistent-overlay" as const } : {}),
    };
  });
}
