import { z } from "zod";
const unit = z.number().finite().min(0).max(1);
const glyph = z.array(z.number().int().min(0).max(0xffffffff)).length(16);
export const appearanceSchema = z
  .object({
    differenceInk: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    startMs: z.number().int().nonnegative(),
    templateRows: glyph.optional(),
    depth: z
      .object({
        relation: z.enum(["front", "behind", "unknown"]),
        observations: z
          .array(
            z
              .object({
                timeMs: z.number().int().nonnegative(),
                insideRetention: unit,
                outsideRetention: unit,
              })
              .strict(),
          )
          .max(128),
      })
      .strict()
      .optional(),
    endMs: z.number().int().positive(),
    x: unit,
    y: unit,
    width: unit,
    height: unit,
    geometry: z
      .array(
        z
          .object({
            timeMs: z.number().int().nonnegative(),
            rows: glyph.optional(),
            x: unit,
            y: unit,
            width: unit,
            height: unit,
          })
          .strict(),
      )
      .max(128)
      .optional(),
    inkMetrics: z
      .object({
        family: z.string().regex(/^[a-zA-Z0-9 ,-]{1,128}$/),
        weight: z.enum(["400", "700", "900"]),
        widthEm: z.number().positive().max(256),
        heightEm: z.number().positive().max(4),
        centerXEm: z.number().finite().min(-4).max(4),
        centerYEm: z.number().finite().min(-4).max(4),
      })
      .strict()
      .optional(),
    content: z.string().min(1).max(120).optional(),
    role: z.enum(["caption", "persistent-overlay"]).optional(),
    observations: z.number().int().positive().optional(),
    passAgreements: z.number().int().nonnegative().optional(),
    glyphRows: z
      .array(z.number().int().min(0).max(0xffffffff))
      .length(16)
      .optional(),
    evidence: z
      .object({
        status: z.enum(["audio-visual", "visual-consensus", "uncertain","reviewed"]),
        kind: z.enum([
          "captioned-lyrics",
          "captioned-speech",
          "title",
          "label",
          "unresolved",
        ]),
        wordStartsMs: z.array(z.number().nonnegative()).max(20),
        beatDistanceMs: z.number().nonnegative().nullable(),
      })
      .strict()
      .optional(),
    face: z
      .object({
        family: z.string().regex(/^[a-zA-Z0-9 ,-]{1,128}$/),
        weight: z.enum(["400", "700", "900"]),
        fit: unit,
      })
      .strict()
      .optional(),
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
