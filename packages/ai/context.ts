import type { Project, Clip } from "../project-schema";
import type { Transcript } from "./transcript";

export interface ContextSelection {
  frame?: number;
  selectedClipIds?: readonly string[];
  selectedLayerId?: string | null;
  activeCompositionId?: string | null;
}
export interface CompositionContext {
  id: string;
  width: number;
  height: number;
  durationFrames: number;
  layerIds: readonly string[];
}
/** Future adapters must return this allowlist, never an entire project or native paths. */
export interface CompositionContextAdapter {
  snapshot(project: Project, compositionId: string): CompositionContext | null;
}
export interface AIProjectContext {
  readonly frame: number;
  readonly layers: readonly Readonly<{
    id: string;
    name: string;
    kind: Clip["kind"];
    start: number;
    duration: number;
    sourceIn: number;
  }>[];
  readonly snapshotId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly revision: number;
  readonly sequence: {
    readonly id: string;
    readonly name: "Main sequence";
    readonly durationFrames: number;
    readonly width: number;
    readonly height: number;
    readonly fps: Readonly<{ num: number; den: number }>;
  };
  readonly activeComposition: Readonly<CompositionContext> | null;
  readonly selectedClipIds: readonly string[];
  readonly selectedLayerId: string | null;
  readonly media: readonly Readonly<{
    id: string;
    kind: "video" | "audio" | "image";
    duration: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
  }>[];
  readonly transcripts: readonly Readonly<{
    id: string;
    source: Transcript["source"];
    segmentCount: number;
    endMs: number;
  }>[];
  readonly masks: readonly Readonly<{
    layerId: string;
    mask: NonNullable<Clip["mask"]>;
  }>[];
  readonly effects: readonly Readonly<{
    layerId: string;
    parameters: Clip["effects"];
  }>[];
  readonly effectStacks: readonly Readonly<{
    layerId: string;
    entries: readonly Readonly<{
      id: string;
      type: Clip["effectStack"][number]["type"];
      enabled: boolean;
      value: number;
      keyCount: number;
    }>[];
  }>[];
  readonly bezierMasks: readonly Readonly<{
    layerId: string;
    maskId: string;
    mode: Clip["masks"][number]["mode"];
    enabled: boolean;
    inverted: boolean;
    vertexCount: number;
    pathKeyCount: number;
    opacity: number;
    feather: number;
    expansion: number;
  }>[];
  readonly compositing: readonly Readonly<{
    layerId: string;
    blendMode: Clip["blendMode"];
    matte: Readonly<NonNullable<Clip["matte"]>> | null;
  }>[];
}
export function freezeSnapshot<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
export function snapshotContext(
  project: Project & { transcripts?: Transcript[] },
  revision: number,
  selection: ContextSelection = {},
  compositions?: CompositionContextAdapter,
): AIProjectContext {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error("Invalid project revision");
  const frame = selection.frame ?? 0;
  if (!Number.isSafeInteger(frame) || frame < 0 || frame > 2_000_000_000)
    throw new Error("Invalid context frame");
  const selectedClipIds = [...new Set(selection.selectedClipIds ?? [])].filter(
    (id) => project.clips.some((c) => c.id === id),
  );
  const selected = project.clips.filter(
    (c) => selectedClipIds.includes(c.id) || c.id === selection.selectedLayerId,
  );
  const composition = selection.activeCompositionId
    ? compositions?.snapshot(project, selection.activeCompositionId)
    : null;
  if (selection.activeCompositionId && !composition)
    throw new Error("Return to the main sequence before using AI Studio");
  // Explicit field projection is the privacy boundary; no object spread from project/media.
  return freezeSnapshot({
    frame,
    layers: selected.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      start: c.start,
      duration: c.duration,
      sourceIn: c.sourceIn,
    })),
    snapshotId: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    revision,
    sequence: {
      id: `${project.id}:main`,
      name: "Main sequence",
      durationFrames: project.clips.reduce(
        (end, c) => Math.max(end, c.start + c.duration),
        0,
      ),
      width: project.settings.width,
      height: project.settings.height,
      fps: { num: project.settings.fps.num, den: project.settings.fps.den },
    },
    activeComposition: composition
      ? {
          id: composition.id,
          width: composition.width,
          height: composition.height,
          durationFrames: composition.durationFrames,
          layerIds: [...composition.layerIds],
        }
      : null,
    selectedClipIds,
    selectedLayerId: project.clips.some(
      (c) => c.id === selection.selectedLayerId,
    )
      ? selection.selectedLayerId!
      : null,
    media: project.assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      duration: a.duration,
      width: a.width,
      height: a.height,
      fps: a.fps,
      hasAudio: a.hasAudio,
    })),
    transcripts: (project.transcripts ?? []).map((t) => ({
      id: t.id,
      source: t.source,
      segmentCount: t.segments.length,
      endMs: t.segments.reduce((end, s) => Math.max(end, s.endMs), 0),
    })),
    masks: selected.flatMap((c) =>
      c.mask
        ? [
            {
              layerId: c.id,
              mask: {
                type: c.mask.type,
                x: c.mask.x,
                y: c.mask.y,
                width: c.mask.width,
                height: c.mask.height,
              },
            },
          ]
        : [],
    ),
    effects: selected.map((c) => ({
      layerId: c.id,
      parameters: {
        blur: c.effects.blur,
        brightness: c.effects.brightness,
        contrast: c.effects.contrast,
        saturation: c.effects.saturation,
      },
    })),
    bezierMasks: selected.flatMap((c) =>
      c.masks.map((m) => ({
        layerId: c.id,
        maskId: m.id,
        mode: m.mode,
        enabled: m.enabled,
        inverted: m.inverted,
        vertexCount: m.vertices.length,
        pathKeyCount: m.pathKeys.length,
        opacity: m.opacity,
        feather: m.feather,
        expansion: m.expansion,
      })),
    ),
    compositing: selected.map((c) => ({
      layerId: c.id,
      blendMode: c.blendMode,
      matte: c.matte ? { layerId: c.matte.layerId, mode: c.matte.mode } : null,
    })),
    effectStacks: selected.map((c) => ({
      layerId: c.id,
      entries: c.effectStack.map((e) => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        value: e.value,
        keyCount: e.keys.length,
      })),
    })),
  });
}
