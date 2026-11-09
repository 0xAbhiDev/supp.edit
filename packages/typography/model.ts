import { z } from "zod";
const n = z.number().finite(),
  color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const typographyStyles = [
  "Minimal",
  "Creator",
  "Bold",
  "Motivational",
  "Aggressive",
  "Cinematic",
  "Luxury",
  "Fitness",
  "Karaoke",
  "Documentary",
] as const;
export const textTreatments = [
  "Fade",
  "Scale In",
  "Pop",
  "Punch",
  "Slide",
  "Blur Reveal",
  "Word Build",
  "Tracking Reveal",
  "Typewriter",
  "Karaoke Highlight",
  "Impact Word",
  "Background Word",
  "Stacked Words",
  "Scale Bounce",
  "Phrase Build",
  "Masked Reveal",
  "Overshoot",
  "Spring Motion",
  "Directional Entrance",
  "Directional Exit",
] as const;
export type TextTreatment = (typeof textTreatments)[number];
export type TypographyStyle = (typeof typographyStyles)[number];
export const textSchema = z.object({
  content: z.string().max(10000),
  size: n.min(6).max(1000),
  color,
  font: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[\p{L}\p{N} _,-]+$/u),
  weight: z.enum([
    "normal",
    "bold",
    "100",
    "200",
    "300",
    "400",
    "500",
    "600",
    "700",
    "800",
    "900",
  ]),
  align: z.enum(["left", "center", "right"]),
  tracking: n.min(-10).max(100).default(0),
  lineSpacing: n.min(0.5).max(3).default(1.2),
  reveal: n.min(0).max(1).default(1),
  revealUnit: z.enum(["words", "characters", "phrases"]).default("words"),
  highlight: n.min(-1).max(10000).default(-1),
  highlightColor: color.default("#C9FF69"),
  wordStarts: z.array(n.int().min(0).max(2e9)).max(256).optional(),
  highlightScale: n.min(1).max(1.5).default(1),
  direction: z.enum(["left", "right", "up", "down"]).default("left"),
  strokeWidth: n.min(0).max(40).default(0),
  strokeColor: color.default("#000000"),
  shadowBlur: n.min(0).max(100).default(0),
  shadowX: n.min(-100).max(100).default(0),
  shadowY: n.min(-100).max(100).default(0),
  shadowColor: color.default("#000000"),
  backgroundColor: color.default("#000000"),
  backgroundOpacity: n.min(0).max(1).default(0),
  backgroundRadius: n.min(0).max(1000).default(0),
  padding: n.min(0).max(100).default(12),
  maxWidth: n.min(0).max(8192).default(0),
  emphasis: z
    .array(
      z.object({
        word: n.int().min(0).max(10000),
        scale: n.min(0.5).max(2),
        color,
        weight: z.enum(["normal", "bold", "900"]),
      }),
    )
    .max(256)
    .default([]),
  // Layer role is intent only: no implied segmentation/foreground extraction.
  role: z.enum(["overlay", "background"]).default("overlay"),
  safeZone: z.boolean().default(true),
});
export type TextStyle = z.infer<typeof textSchema>;
/** Conservative configurable authoring bounds, not a promise about platform UI. */
export function socialSafeArea(width: number, height: number) {
  return {
    left: width * 0.08,
    right: width * 0.82,
    top: height * 0.14,
    bottom: height * 0.75,
  };
}
