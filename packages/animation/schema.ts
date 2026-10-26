import { z } from "zod";
const finite = z.number().finite();
export const interpolationModes = [
  "linear",
  "hold",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "bezier",
  "auto-bezier",
  "continuous-bezier",
] as const;
const handle = z.object({
  x: finite.min(0).max(1),
  y: finite.min(-100000).max(100000),
});
export const keyframeSchema = z.object({
  frame: finite.int().min(-2_000_000_000).max(2_000_000_000),
  value: finite.min(-100000).max(100000),
  easing: z.enum(interpolationModes),
  inHandle: handle.optional(),
  outHandle: handle.optional(),
});
