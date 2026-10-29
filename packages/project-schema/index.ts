import { blendModes, matteSchema, assertMattes } from "../compositing/model";
import { z } from "zod";
import { transcriptSchema } from "../ai/transcript";

const finite = z.number().finite();
const frame = finite.int().min(0).max(2_000_000_000);
const id = z.string().min(1).max(128);
export { interpolationModes, keyframeSchema } from "../animation/schema";
import { keyframeSchema } from "../animation/schema";
import { masksSchema } from "../masks/model";
import { effectStackSchema } from "../effects/model";
export const transformSchema = z.object({
  x: finite.min(-32768).max(32768),
  y: finite.min(-32768).max(32768),
  scale: finite.min(0.01).max(10),
  rotation: finite.min(-36000).max(36000),
  opacity: finite.min(0).max(1),
  scaleX: finite.min(0.01).max(10).default(1),
  scaleY: finite.min(0.01).max(10).default(1),
  anchorX: finite.min(-32768).max(32768).default(0),
  anchorY: finite.min(-32768).max(32768).default(0),
});
const channel = () => z.array(keyframeSchema).max(10000).default([]);
const cropSchema = z.object({
  cropLeft: finite.min(0).max(1).default(0),
  cropTop: finite.min(0).max(1).default(0),
  cropRight: finite.min(0).max(1).default(0),
  cropBottom: finite.min(0).max(1).default(0),
});
export const assetSchema = z.object({
  id,
  name: z.string().max(1024),
  kind: z.enum(["video", "audio", "image"]),
  path: z.string().max(32768),
  size: finite.min(0),
  duration: finite.min(0).max(86400 * 7),
  width: finite.int().min(0).max(65536),
  height: finite.int().min(0).max(65536),
  fps: finite.min(0).max(1000),
  codec: z.string().max(128),
  hasAudio: z.boolean(),
  fingerprint: z.string().max(1024),
});
export const clipSchema = z.object({
  id,
  trackId: id,
  // Older native saves serialized Option::None as null for generated layers.
  assetId: z.preprocess((v) => (v === null ? undefined : v), id.optional()),
  kind: z.enum(["media", "text", "shape", "composition", "null"]),
  compositionId: id.optional(),
  parentId: id.optional(),
  matte: matteSchema.optional(),
  blendMode: z.enum(blendModes).default("normal"),
  parentOffset: z
    .tuple([
      finite.min(-1e9).max(1e9),
      finite.min(-1e9).max(1e9),
      finite.min(-1e9).max(1e9),
      finite.min(-1e9).max(1e9),
      finite.min(-1e9).max(1e9),
      finite.min(-1e9).max(1e9),
    ])
    .default([1, 0, 0, 1, 0, 0]),
  name: z.string().max(1024),
  start: frame,
  duration: frame.min(1),
  sourceIn: frame,
  gain: finite.min(-60).max(12),
  transform: transformSchema,
  crop: cropSchema.default({}),
  effects: z.object({
    blur: finite.min(0).max(100),
    brightness: finite.min(0).max(3),
    contrast: finite.min(0).max(3),
    saturation: finite.min(0).max(3),
  }),
  keyframes: z.object({
    x: z.array(keyframeSchema).max(10000),
    y: z.array(keyframeSchema).max(10000),
    scale: z.array(keyframeSchema).max(10000),
    opacity: z.array(keyframeSchema).max(10000),
    rotation: channel(),
    scaleX: channel(),
    scaleY: channel(),
    anchorX: channel(),
    anchorY: channel(),
    blur: channel(),
    brightness: channel(),
    contrast: channel(),
    saturation: channel(),
    cropLeft: channel(),
    cropTop: channel(),
    cropRight: channel(),
    cropBottom: channel(),
  }),
  masks: masksSchema.default([]),
  effectStack: effectStackSchema.default([]),
  mask: z
    .object({
      type: z.enum(["rectangle", "ellipse"]),
      x: finite.min(0).max(1),
      y: finite.min(0).max(1),
      width: finite.min(0.001).max(1),
      height: finite.min(0.001).max(1),
    })
    .nullable(),
  text: z.object({
    content: z.string().max(10000),
    size: finite.min(6).max(1000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    font: z.enum(["sans-serif", "serif", "monospace"]),
    weight: z.enum(["normal", "bold"]),
    align: z.enum(["left", "center", "right"]),
  }),
  shape: z.object({
    type: z.enum(["rectangle", "ellipse"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    width: finite.min(1).max(8192),
    height: finite.min(1).max(8192),
  }),
});
export const trackSchema = z.object({
  id,
  name: z.string().max(256),
  kind: z.enum(["video", "audio"]),
  locked: z.boolean(),
  hidden: z.boolean(),
  muted: z.boolean(),
  solo: z.boolean(),
});
export const settingsSchema = z.object({
  width: finite.int().min(64).max(8192),
  height: finite.int().min(64).max(8192),
  fps: z
    .object({
      num: finite.int().min(1).max(120000),
      den: finite.int().min(1).max(10000),
    })
    .refine(
      (v) => v.num / v.den >= 1 && v.num / v.den <= 120,
      "Frame rate must be 1–120",
    ),
  colorSpace: z.literal("srgb"),
});
export const compositionSchema = z.object({
  id,
  name: z.string().min(1).max(256),
  settings: settingsSchema,
  duration: frame.min(1),
  background: z.string().regex(/^(transparent|#[0-9a-fA-F]{6})$/),
  tracks: z.array(trackSchema).min(1).max(1000),
  layers: z.array(clipSchema).max(100000),
});
export type Composition = z.infer<typeof compositionSchema>;
const projectBase = z.object({
  schemaVersion: z.literal(8),
  id,
  name: z.string().min(1).max(256),
  createdAt: z.string().datetime(),
  modifiedAt: z.string().datetime(),
  settings: z.object({
    width: finite.int().min(64).max(8192),
    height: finite.int().min(64).max(8192),
    fps: z
      .object({
        num: finite.int().min(1).max(120000),
        den: finite.int().min(1).max(10000),
      })
      .refine(
        (v) => v.num / v.den >= 1 && v.num / v.den <= 120,
        "Frame rate must be 1–120",
      ),
    colorSpace: z.literal("srgb"),
  }),
  assets: z.array(assetSchema).max(100000),
  tracks: z.array(trackSchema).min(1).max(1000),
  clips: z.array(clipSchema).max(100000),
  compositions: z.array(compositionSchema).max(64).default([]),
  transcripts: z.array(transcriptSchema).max(10000).default([]),
  markers: z
    .array(z.object({ id, frame, name: z.string().max(256) }))
    .max(100000),
});
export const projectSchema = projectBase.superRefine((p, ctx) => {
  const scopes = [
    { settings: p.settings, tracks: p.tracks, layers: p.clips },
    ...p.compositions,
  ];
  const allLayers = scopes.flatMap((s) => s.layers);
  try {
    assertParenting(p);
    assertMattes(p);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (allLayers.length > 100000)
    ctx.addIssue({ code: "custom", message: "Project layer limit exceeded" });
  for (const list of [
    [
      { id: p.id },
      ...p.assets,
      ...scopes.flatMap((s) => s.tracks),
      ...allLayers,
      ...p.markers,
      ...p.compositions,
      ...p.transcripts,
    ],
  ])
    if (new Set(list.map((x) => x.id)).size !== list.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate IDs in project graph",
      });
  for (const scope of scopes)
    for (const c of scope.layers) {
      if (
        c.start + c.duration > 2_000_000_000 ||
        (c.kind !== "media" && c.assetId)
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid layer timing or source",
        });
      const track = scope.tracks.find((t) => t.id === c.trackId),
        asset = p.assets.find((a) => a.id === c.assetId);
      if (
        c.effectStack.length &&
        (c.kind === "null" || track?.kind !== "video")
      )
        ctx.addIssue({
          code: "custom",
          message: "Effects require a visual layer",
        });
      if (c.masks.length && (c.kind === "null" || track?.kind !== "video"))
        ctx.addIssue({
          code: "custom",
          message: "Masks require a visual layer",
        });
      if (c.kind === "composition") {
        const comp = p.compositions.find((x) => x.id === c.compositionId);
        if (
          !comp ||
          (c.sourceIn + c.duration) /
            (scope.settings.fps.num / scope.settings.fps.den) >
            comp.duration / (comp.settings.fps.num / comp.settings.fps.den) +
              1e-8
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Missing composition or layer exceeds composition duration",
          });
      } else if (c.compositionId)
        ctx.addIssue({
          code: "custom",
          message: "Only composition layers can reference a composition",
        });
      if (!track || (c.kind === "media" && !asset))
        ctx.addIssue({
          code: "custom",
          message: `Broken reference on clip ${c.name}`,
        });
      if (
        track?.kind === "audio" &&
        (c.kind !== "media" || asset?.kind !== "audio")
      )
        ctx.addIssue({
          code: "custom",
          message: "Audio tracks only accept audio assets",
        });
      if (track?.kind === "video" && asset?.kind === "audio")
        ctx.addIssue({
          code: "custom",
          message: "Audio assets require an audio track",
        });
      if (
        asset &&
        asset.kind !== "image" &&
        c.sourceIn + c.duration >
          Math.ceil(
            (asset.duration * scope.settings.fps.num) / scope.settings.fps.den,
          ) +
            1
      )
        ctx.addIssue({
          code: "custom",
          message: `Clip exceeds source duration: ${c.name}`,
        });
      for (const keys of Object.values(c.keyframes)) {
        if (new Set(keys.map((k) => k.frame)).size !== keys.length)
          ctx.addIssue({ code: "custom", message: "Duplicate keyframe times" });
      }
    }
  for (const t of p.transcripts)
    if (t.assetId && !p.assets.some((a) => a.id === t.assetId))
      ctx.addIssue({
        code: "custom",
        message: "Transcript references missing asset",
      });
  const done = new Map<string, number>();
  const visit = (id: string, path: Set<string>): number => {
    if (path.has(id)) {
      ctx.addIssue({ code: "custom", message: "Cyclic composition reference" });
      return 17;
    }
    if (done.has(id)) return done.get(id)!;
    if (path.size >= 16) {
      ctx.addIssue({
        code: "custom",
        message: "Composition nesting exceeds 16 levels",
      });
      return 17;
    }
    const next = new Set(path).add(id),
      comp = p.compositions.find((c) => c.id === id);
    const depth =
      1 +
      Math.max(
        0,
        ...(comp?.layers
          .filter((c) => c.kind === "composition")
          .map((c) => visit(c.compositionId!, next)) ?? []),
      );
    done.set(id, depth);
    return depth;
  };
  for (const c of p.compositions)
    if (visit(c.id, new Set()) > 16)
      ctx.addIssue({
        code: "custom",
        message: "Composition nesting exceeds 16 levels",
      });
});
export type Project = z.infer<typeof projectBase>;
export type Asset = z.infer<typeof assetSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type AnimatedProperty = keyof Clip["keyframes"];
/** Runs at every history boundary, including NLE edits that might remove parents. */
export function assertParenting(project: Project) {
  for (const scope of [
    { layers: project.clips, tracks: project.tracks },
    ...project.compositions,
  ]) {
    const clips = new Map(scope.layers.map((c) => [c.id, c]));
    const visual = new Set(
      scope.tracks.filter((t) => t.kind === "video").map((t) => t.id),
    );
    for (const c of scope.layers) {
      if (
        c.parentId &&
        (!visual.has(c.trackId) ||
          !visual.has(clips.get(c.parentId)?.trackId ?? ""))
      )
        throw new Error(
          "Parent must reference a visual layer in the same composition",
        );
      const visited = new Set([c.id]);
      let cursor = c;
      while (cursor.parentId) {
        if (visited.has(cursor.parentId) || visited.size > 64)
          throw new Error("Cyclic parenting or parenting exceeds 64 levels");
        visited.add(cursor.parentId);
        const parent = clips.get(cursor.parentId);
        if (!parent) throw new Error("Missing parent layer");
        cursor = parent;
      }
    }
  }
}
export const uid = () => crypto.randomUUID();
export const fps = (p: Project) => p.settings.fps.num / p.settings.fps.den;
export const duration = (p: Project) =>
  p.compositions.find((c) => c.layers === p.clips)?.duration ??
  p.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
export function newProject(
  name = "Untitled project",
  width = 1920,
  height = 1080,
  rate = { num: 30, den: 1 },
): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 8,
    id: uid(),
    name,
    createdAt: now,
    modifiedAt: now,
    settings: { width, height, fps: rate, colorSpace: "srgb" },
    assets: [],
    tracks: [newTrack("video", 1), newTrack("audio", 1)],
    clips: [],
    compositions: [],
    transcripts: [],
    markers: [],
  };
}
export function newTrack(kind: Track["kind"], index: number): Track {
  return {
    id: uid(),
    name: `${kind === "video" ? "Video" : "Audio"} ${index}`,
    kind,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}
export function newClip(
  trackId: string,
  start: number,
  length: number,
  kind: Clip["kind"] = "media",
  asset?: Asset,
): Clip {
  return {
    id: uid(),
    trackId,
    start,
    duration: Math.max(1, length),
    sourceIn: 0,
    kind,
    parentOffset: [1, 0, 0, 1, 0, 0],
    blendMode: "normal",
    assetId: asset?.id,
    name: asset?.name ?? (kind === "text" ? "Your title" : "Shape"),
    gain: 0,
    transform: transformSchema.parse({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
    }),
    crop: cropSchema.parse({}),
    effects: { blur: 0, brightness: 1, contrast: 1, saturation: 1 },
    effectStack: [],
    keyframes: clipSchema.shape.keyframes.parse({
      x: [],
      y: [],
      scale: [],
      opacity: [],
    }),
    masks: [],
    mask: null,
    text: {
      content: "Your title",
      size: 96,
      color: "#ffffff",
      font: "sans-serif",
      weight: "bold",
      align: "center",
    },
    shape: { type: "rectangle", color: "#c3f96b", width: 480, height: 270 },
  };
}
export function parseProject(input: unknown): Project {
  if (
    typeof input !== "object" ||
    input === null ||
    !("schemaVersion" in input)
  )
    throw new Error("Not a supp.edit project: schemaVersion is missing.");
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(input.schemaVersion as number))
    throw new Error(
      `Unsupported project version ${input.schemaVersion}. This build reads versions 1–8. The file was not changed.`,
    );
  // Copy before migration; old files and callers' objects remain untouched.
  return projectSchema.parse({ ...input, schemaVersion: 8 });
}
export function timecode(frame: number, rate: number): string {
  const nominal = Math.round(rate),
    totalSeconds = Math.floor(frame / nominal),
    f = frame % nominal;
  return [
    Math.floor(totalSeconds / 3600),
    Math.floor(totalSeconds / 60) % 60,
    totalSeconds % 60,
    Math.min(nominal - 1, f),
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
