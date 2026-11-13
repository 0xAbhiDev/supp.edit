import { fps, type Clip, type Project, type Track } from "../project-schema";
import { compositionView } from "../commands/compositions";
import { projectIndex } from "./project-index";
import { layerTransforms, type Affine } from "../animation/affine";

export interface RenderLayer {
  clip: Clip;
  resourceId: string;
  matrix: Affine;
  output: boolean;
  child?: RenderScope;
}
export interface RenderScope {
  project: Project;
  frame: number;
  background: string;
  path: string;
  layers: RenderLayer[];
  audible: boolean;
  gain: number;
}
/** Frame-local dependency graph. Times remain fractional until source sampling,
 * preserving seconds across compositions with different frame rates. */
export function buildRenderGraph(
  project: Project,
  frame: number,
  scale = 1,
  background = "#000000",
): RenderScope {
  let surfaceBytes = 0,
    scopes = 0;
  const build = (
    p: Project,
    time: number,
    path: string,
    bg: string,
    ancestors: string[],
    audible: boolean,
    gain: number,
  ): RenderScope => {
    if (++scopes > 256 || ancestors.length > 16)
      throw new Error(
        "Composition render graph exceeds its depth or instance budget",
      );
    surfaceBytes +=
      Math.round(p.settings.width * scale) *
      Math.round(p.settings.height * scale) *
      4;
    if (surfaceBytes > 256 * 1024 * 1024)
      throw new Error(
        "Composition surfaces exceed the 256 MiB frame budget. Reduce preview resolution.",
      );
    const transforms = layerTransforms(p, time);
    const index = projectIndex(p),
      active = index.all
        .range(time, time + Number.EPSILON * Math.max(1, time) * 2)
        .sort((a, b) => index.order.get(a.id)! - index.order.get(b.id)!);
    const solo = p.tracks.some((t) => t.solo),
      visualSolo = p.tracks.some((t) => t.kind === "video" && t.solo),
      layers: RenderLayer[] = [];
    const consumed = new Set(
      p.clips.flatMap((c) =>
        c.matte && !c.matte.keepSourceVisible ? [c.matte.layerId] : [],
      ),
    );
    const added = new Set<string>(),
      activeById = new Map(active.map((c) => [c.id, c]));
    const append = (c: Clip, track: Track, output: boolean) => {
      if (added.has(c.id)) return;
      added.add(c.id);
      const layer: RenderLayer = {
        clip: c,
        resourceId: `${path}/${c.id}`,
        matrix: transforms.world(c.id),
        output: output && !consumed.has(c.id),
      };
      if (c.kind === "composition") {
        const comp = project.compositions.find((x) => x.id === c.compositionId);
        if (!comp) throw new Error(`Missing composition source: ${c.name}`);
        if (ancestors.includes(comp.id))
          throw new Error("Cyclic composition reference");
        const sourceFrame =
          ((time - c.start + c.sourceIn) / fps(p)) *
          (comp.settings.fps.num / comp.settings.fps.den);
        if (sourceFrame >= 0 && sourceFrame < comp.duration)
          layer.child = build(
            compositionView(project, comp.id),
            sourceFrame,
            layer.resourceId,
            comp.background,
            [...ancestors, comp.id],
            audible && !track.hidden && !track.muted && (!solo || track.solo),
            gain + c.gain,
          );
      }
      layers.push(layer);
    };
    for (const track of [...p.tracks].reverse()) {
      if (
        track.kind === "video" &&
        (track.hidden || (visualSolo && !track.solo))
      )
        continue;
      for (const c of active.filter((c) => c.trackId === track.id))
        append(c, track, true);
    }
    // A hidden matte is still a render dependency; inactive sources sample transparent.
    for (let i = 0; i < layers.length; i++) {
      const id = layers[i].clip.matte?.layerId,
        source = id ? activeById.get(id) : undefined;
      if (source) {
        const track = p.tracks.find((t) => t.id === source.trackId);
        if (!track || track.kind !== "video" || source.kind === "null")
          throw new Error("Invalid matte dependency");
        append(source, track, false);
      }
    }
    surfaceBytes +=
      new Set(
        layers.flatMap((l) => (l.clip.matte ? [l.clip.matte.layerId] : [])),
      ).size *
      Math.round(p.settings.width * scale) *
      Math.round(p.settings.height * scale) *
      4;
    if (surfaceBytes > 256 * 1024 * 1024)
      throw new Error(
        "Composition and matte surfaces exceed the 256 MiB frame budget",
      );
    return {
      project: p,
      frame: time,
      path,
      background: bg,
      layers,
      audible,
      gain,
    };
  };
  return build(project, frame, "root", background, [], true, 0);
}
