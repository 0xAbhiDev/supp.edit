import { z } from "zod";
import type { Project } from "../project-schema";
export const blendModes = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "add",
] as const;
export type BlendMode = (typeof blendModes)[number];
export const matteModes = [
  "alpha",
  "alpha-inverted",
  "luma",
  "luma-inverted",
] as const;
export const matteSchema = z.object({
  layerId: z.string().min(1).max(128),
  mode: z.enum(matteModes),
  keepSourceVisible: z.boolean().optional(),
});
export type Matte = z.infer<typeof matteSchema>;
/** A matte samples another visual layer in the same scope, independently of stack position. */
export function assertMattes(p: Project) {
  for (const scope of [
    { layers: p.clips, tracks: p.tracks },
    ...p.compositions,
  ]) {
    const layers = new Map(scope.layers.map((c) => [c.id, c])),
      visual = new Set(
        scope.tracks.filter((t) => t.kind === "video").map((t) => t.id),
      );
    for (const c of scope.layers) {
      if (!blendModes.includes(c.blendMode))
        throw new Error("Unknown blend mode");
      if (
        c.blendMode !== "normal" &&
        (!visual.has(c.trackId) || c.kind === "null")
      )
        throw new Error("Blend modes require a visual layer");
      if (!c.matte) continue;
      if (!matteModes.includes(c.matte.mode))
        throw new Error("Unknown matte mode");
      const source = layers.get(c.matte.layerId);
      if (
        !source ||
        !visual.has(source.trackId) ||
        !visual.has(c.trackId) ||
        c.kind === "null" ||
        source.kind === "null"
      )
        throw new Error(
          "Matte must reference a visual layer in the same composition",
        );
      const visited = new Set([c.id]);
      let cursor = c;
      while (cursor.matte) {
        if (visited.has(cursor.matte.layerId) || visited.size > 32)
          throw new Error("Cyclic matte or matte chain exceeds 32 sources");
        visited.add(cursor.matte.layerId);
        const next = layers.get(cursor.matte.layerId);
        if (!next) throw new Error("Missing matte source");
        cursor = next;
      }
    }
  }
}
export const canvasBlend = (mode: BlendMode): GlobalCompositeOperation =>
  mode === "normal" ? "source-over" : mode === "add" ? "lighter" : mode;
