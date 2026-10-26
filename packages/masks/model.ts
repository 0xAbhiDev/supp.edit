import { z } from "zod";
import { keyframeSchema } from "../animation/schema";
const finite = z.number().finite();
const id = z.string().min(1).max(128);
const tangent = z.object({
  x: finite.min(-8).max(8),
  y: finite.min(-8).max(8),
});
export const vertexSchema = z.object({
  id,
  x: finite.min(-4).max(5),
  y: finite.min(-4).max(5),
  in: tangent,
  out: tangent,
});
const vertices = z.array(vertexSchema).min(3).max(128);
export const maskRanges = {
  opacity: [0, 1],
  feather: [0, 256],
  expansion: [-512, 512],
} as const;
export type MaskProperty = keyof typeof maskRanges;
const channel = (min: number, max: number) =>
  z
    .array(keyframeSchema.extend({ value: finite.min(min).max(max) }))
    .max(1000)
    .refine(
      (k) => new Set(k.map((k) => k.frame)).size === k.length,
      "Duplicate mask keyframe",
    );
export const bezierMaskSchema = z
  .object({
    id,
    name: z.string().max(256),
    enabled: z.boolean(),
    mode: z.enum(["add", "subtract", "intersect", "difference"]),
    inverted: z.boolean(),
    closed: z.literal(true),
    vertices,
    opacity: finite.min(0).max(1),
    feather: finite.min(0).max(256),
    expansion: finite.min(-512).max(512),
    keyframes: z.object({
      opacity: channel(0, 1),
      feather: channel(0, 256),
      expansion: channel(-512, 512),
    }),
    pathKeys: z
      .array(
        z.object({
          frame: finite.int().min(-2_000_000_000).max(2_000_000_000),
          easing: z.enum(["linear", "hold"]),
          vertices,
        }),
      )
      .max(128),
  })
  .superRefine((m, ctx) => {
    if (new Set(m.vertices.map((v) => v.id)).size !== m.vertices.length)
      ctx.addIssue({ code: "custom", message: "Duplicate mask vertex IDs" });
    if (new Set(m.pathKeys.map((k) => k.frame)).size !== m.pathKeys.length)
      ctx.addIssue({ code: "custom", message: "Duplicate mask path keyframe" });
    for (const k of m.pathKeys)
      if (
        k.vertices.length !== m.vertices.length ||
        k.vertices.some((v, i) => v.id !== m.vertices[i].id)
      )
        ctx.addIssue({
          code: "custom",
          message: "Animated mask paths must have matching vertex topology",
        });
  });
export const masksSchema = z
  .array(bezierMaskSchema)
  .max(32)
  .refine(
    (m) => new Set(m.map((m) => m.id)).size === m.length,
    "Duplicate mask IDs",
  );
export type BezierMask = z.infer<typeof bezierMaskSchema>;
export type MaskVertex = z.infer<typeof vertexSchema>;
export function vertex(x: number, y: number): MaskVertex {
  return {
    id: crypto.randomUUID(),
    x,
    y,
    in: { x: 0, y: 0 },
    out: { x: 0, y: 0 },
  };
}
export function newMask(
  shape: "rectangle" | "ellipse" | MaskVertex[] = "rectangle",
): BezierMask {
  let points: MaskVertex[];
  if (Array.isArray(shape)) points = shape;
  else if (shape === "rectangle")
    points = [
      vertex(0.25, 0.25),
      vertex(0.75, 0.25),
      vertex(0.75, 0.75),
      vertex(0.25, 0.75),
    ];
  else {
    const k = 0.25 * 0.5522847498307936;
    points = [
      vertex(0.5, 0.25),
      vertex(0.75, 0.5),
      vertex(0.5, 0.75),
      vertex(0.25, 0.5),
    ];
    points[0].in.x = -k;
    points[0].out.x = k;
    points[1].in.y = -k;
    points[1].out.y = k;
    points[2].in.x = k;
    points[2].out.x = -k;
    points[3].in.y = k;
    points[3].out.y = -k;
  }
  return bezierMaskSchema.parse({
    id: crypto.randomUUID(),
    name: "Bezier mask",
    enabled: true,
    mode: "add",
    inverted: false,
    closed: true,
    vertices: points,
    opacity: 1,
    feather: 0,
    expansion: 0,
    keyframes: { opacity: [], feather: [], expansion: [] },
    pathKeys: [],
  });
}
