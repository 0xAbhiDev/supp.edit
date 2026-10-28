import { type Project, type Clip } from "../project-schema";
import { resolveClip } from "../animation";
import { canvasMatrix, type Affine } from "../animation/affine";
import { ResourcePool } from "./resources";
import { GpuRenderer } from "./gpu";
import { projectIndex } from "./project-index";
import {
  buildRenderGraph,
  type RenderScope,
  type RenderLayer,
} from "./render-graph";
import type { RendererMode } from "./diagnostics";
import { MaskRasterizer } from "./masks";
import { MatteCoverage } from "./matte-coverage";
import { canvasBlend, type BlendMode } from "../compositing/model";
export class Compositor {
  readonly pool: ResourcePool;
  private gpu: GpuRenderer | null = null;
  private cancelled = false;
  private masks = new MaskRasterizer();
  private maskedLayer = document.createElement("canvas");
  private matteSurfaces = new Map<string, HTMLCanvasElement>();
  private matteCoverage = new MatteCoverage();
  private emptyMatte = document.createElement("canvas");
  get matteSurfaceBytes() {
    return (
      this.matteCoverage.bytes +
      [...this.matteSurfaces.values()].reduce(
        (n, c) => n + c.width * c.height * 4,
        0,
      )
    );
  }
  get maskSurfaceBytes() {
    return (
      this.masks.bytes + this.maskedLayer.width * this.maskedLayer.height * 4
    );
  }
  cancel() {
    this.cancelled = true;
    this.pool.pauseInactive(new Set());
  }
  fallback = "";
  get backend() {
    return this.gpu ? "WebGL2 texture compositor" : "Canvas2D fallback";
  }
  get device() {
    return this.gpu?.device ?? "CPU / system canvas";
  }
  get textureBytes() {
    return this.gpu?.bytes ?? 0;
  }
  get compositionSurfaceBytes() {
    return [...this.surfaces.values()].reduce(
      (bytes, s) => bytes + s.width * s.height * 4,
      0,
    );
  }
  constructor(
    private canvas: HTMLCanvasElement,
    silent = false,
    private options: { renderer?: RendererMode; scale?: number } = {},
  ) {
    this.pool = new ResourcePool(silent);
    if (options.renderer !== "cpu")
      try {
        this.gpu = new GpuRenderer();
      } catch (e) {
        this.fallback = String(e);
      }
  }
  private surfaces = new Map<string, HTMLCanvasElement>();
  async render(
    p: Project,
    frame: number,
    playing = false,
    speed = 1,
    strict = false,
    background = "#000000",
  ) {
    const scale = strict ? 1 : (this.options.scale ?? 1);
    const graph = buildRenderGraph(p, frame, scale, background);
    const scopes: RenderScope[] = [];
    const walk = (scope: RenderScope) => {
      scopes.push(scope);
      for (const layer of scope.layers) if (layer.child) walk(layer.child);
    };
    walk(graph);
    const matteIds = new Set<string>();
    let matteBytes = 0;
    for (const scope of scopes) {
      const used = new Set(
        scope.layers.flatMap((l) =>
          l.clip.matte ? [l.clip.matte.layerId] : [],
        ),
      );
      for (const l of scope.layers)
        if (used.has(l.clip.id)) {
          matteIds.add(l.resourceId);
          matteBytes +=
            Math.round(scope.project.settings.width * scale) *
            Math.round(scope.project.settings.height * scale) *
            4;
        }
    }
    if (matteBytes > 128 * 1024 * 1024)
      throw new Error("Matte surfaces exceed the 128 MiB frame budget");
    for (const [id, canvas] of this.matteSurfaces)
      if (!matteIds.has(id)) {
        canvas.width = canvas.height = 0;
        this.matteSurfaces.delete(id);
      }
    this.emptyMatte.width = this.emptyMatte.height = 1;
    const prepared = new Map<string, CanvasImageSource>();
    const activeIds = new Set(
      scopes.flatMap((s) => s.layers.map((l) => l.resourceId)),
    );
    const usedSurfaces = new Set(scopes.slice(1).map((s) => s.path));
    for (const [key, surface] of this.surfaces)
      if (!usedSurfaces.has(key)) {
        surface.width = surface.height = 0;
        this.surfaces.delete(key);
      }
    this.pool.setActive(activeIds);
    let failure: Error | null = null;
    await Promise.all(
      scopes.flatMap((scope) =>
        scope.layers.map(async (layer) => {
          const { project: scene, frame: time } = scope,
            c = layer.clip;
          const asset = scene.assets.find((a) => a.id === c.assetId);
          const track = scene.tracks.find((t) => t.id === c.trackId);
          if (c.kind !== "media" || !asset || !track) return;
          const resourceClip = {
            ...c,
            id: layer.resourceId,
            gain: c.gain + scope.gain,
          };
          try {
            const r = await this.pool.prepare(
              resourceClip,
              asset,
              scene,
              time,
              playing,
              speed,
            );
            if (!(r.element instanceof HTMLAudioElement))
              prepared.set(
                layer.resourceId,
                await this.pool.visual(
                  r,
                  resourceClip,
                  asset,
                  scene,
                  time,
                  playing,
                ),
              );
            if (asset.hasAudio)
              await this.pool.audio(
                r,
                resourceClip,
                playing,
                speed,
                scope.audible &&
                  !track.hidden &&
                  !track.muted &&
                  (!scene.tracks.some((t) => t.solo) || track.solo),
              );
          } catch (e) {
            failure = e instanceof Error ? e : new Error(String(e));
          }
        }),
      ),
    );
    try {
      this.pool.pauseInactive(this.cancelled ? new Set() : activeIds);
      if (this.cancelled) return null;
      if (strict && failure) throw failure;
      const drawScope = (scope: RenderScope, canvas: HTMLCanvasElement) => {
        for (const layer of scope.layers)
          if (layer.child) {
            let surface = this.surfaces.get(layer.child.path);
            if (!surface) {
              surface = document.createElement("canvas");
              this.surfaces.set(layer.child.path, surface);
            }
            drawScope(layer.child, surface);
            prepared.set(layer.resourceId, surface);
          }
        const scene = scope.project,
          width = Math.max(1, Math.round(scene.settings.width * scale)),
          height = Math.max(1, Math.round(scene.settings.height * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("Canvas2D is unavailable");
        const layers = scope.layers.filter(
          (l) =>
            l.clip.kind !== "null" &&
            scene.tracks.find((t) => t.id === l.clip.trackId)?.kind === "video",
        );
        const coverage = (clip: Clip) =>
          this.masks.raster(
            clip,
            scope.frame,
            scene.settings.width,
            scene.settings.height,
            scale,
          );
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.clearRect(0, 0, width, height);

        const paintCpu = (
          target: CanvasRenderingContext2D,
          l: RenderLayer,
          matte?: HTMLCanvasElement,
          mode: BlendMode = l.clip.blendMode,
        ) => {
          const mask = coverage(l.clip);
          target.save();
          target.globalCompositeOperation = canvasBlend(mode);
          if (mask || l.clip.matte || mode !== "normal") {
            const surface = this.maskedLayer;
            surface.width = width;
            surface.height = height;
            const layer = surface.getContext("2d")!;
            layer.scale(scale, scale);
            this.draw(
              layer,
              scene,
              l.clip,
              scope.frame,
              prepared.get(l.resourceId),
              scale,
              l.matrix,
            );
            if (mask) {
              layer.setTransform(scale, 0, 0, scale, 0, 0);
              layer.transform(...canvasMatrix(scene, l.matrix));
              layer.globalCompositeOperation = "destination-in";
              layer.drawImage(
                mask,
                -scene.settings.width / 2,
                -scene.settings.height / 2,
                scene.settings.width,
                scene.settings.height,
              );
            }
            if (l.clip.matte) {
              const alpha = this.matteCoverage.raster(
                matte ?? this.emptyMatte,
                l.clip.matte.mode,
                width,
                height,
              );
              layer.resetTransform();
              layer.globalCompositeOperation = "destination-in";
              layer.drawImage(alpha, 0, 0, width, height);
            }
            target.drawImage(surface, 0, 0);
          } else {
            target.scale(scale, scale);
            this.draw(
              target,
              scene,
              l.clip,
              scope.frame,
              prepared.get(l.resourceId),
              scale,
              l.matrix,
            );
          }
          target.restore();
        };
        const makeMattes = (useGpu: boolean) => {
          const cache = new Map<string, HTMLCanvasElement>(),
            visiting = new Set<string>();
          const byId = new Map(layers.map((l) => [l.clip.id, l]));
          const renderMatte = (id: string): HTMLCanvasElement => {
            const cached = cache.get(id);
            if (cached) return cached;
            const l = byId.get(id);
            if (!l) return this.emptyMatte;
            if (visiting.has(id) || visiting.size >= 32)
              throw new Error("Invalid matte render cycle or depth");
            visiting.add(id);
            const dependency = l.clip.matte
              ? renderMatte(l.clip.matte.layerId)
              : undefined;
            let surface = this.matteSurfaces.get(l.resourceId);
            if (!surface) {
              surface = document.createElement("canvas");
              this.matteSurfaces.set(l.resourceId, surface);
            }
            surface.width = width;
            surface.height = height;
            const out = surface.getContext("2d")!;
            if (useGpu) {
              this.gpu!.begin(width, height, "transparent");
              this.gpu!.draw(
                scene,
                { ...l.clip, id: l.resourceId, blendMode: "normal" },
                scope.frame,
                prepared.get(l.resourceId),
                l.matrix,
                coverage(l.clip),
                dependency,
              );
              out.drawImage(this.gpu!.canvas, 0, 0);
            } else paintCpu(out, l, dependency, "normal");
            visiting.delete(id);
            cache.set(id, surface);
            return surface;
          };
          for (const l of layers)
            if (l.clip.matte) renderMatte(l.clip.matte.layerId);
          return (l: RenderLayer) =>
            l.clip.matte
              ? (cache.get(l.clip.matte.layerId) ?? this.emptyMatte)
              : undefined;
        };
        let gpuRendered = false;
        if (this.gpu)
          try {
            const matte = makeMattes(true);
            this.gpu.begin(width, height, scope.background);
            for (const l of layers)
              if (l.output)
                this.gpu.draw(
                  scene,
                  { ...l.clip, id: l.resourceId },
                  scope.frame,
                  prepared.get(l.resourceId),
                  l.matrix,
                  coverage(l.clip),
                  matte(l),
                );
            ctx.drawImage(this.gpu.canvas, 0, 0);
            gpuRendered = true;
          } catch (e) {
            this.fallback = String(e);
            this.gpu.dispose();
            this.gpu = null;
          }
        if (!gpuRendered) {
          const matte = makeMattes(false);
          if (scope.background !== "transparent") {
            ctx.fillStyle = scope.background;
            ctx.fillRect(0, 0, width, height);
          }
          for (const l of layers) if (l.output) paintCpu(ctx, l, matte(l));
        }
      };
      drawScope(graph, this.canvas);
      this.pool.prune(activeIds);
      if (!strict && !p.compositions.length) {
        const index = projectIndex(p);
        this.pool.prefetch(
          p,
          index.all
            .range(
              frame + 1,
              frame + Math.ceil(p.settings.fps.num / p.settings.fps.den),
            )
            .map((c) => ({ ...c, id: "root/" + c.id })),
          activeIds,
        );
      }
      return failure as Error | null;
    } finally {
      this.pool.releaseFrames();
    }
  }
  private draw(
    ctx: CanvasRenderingContext2D,
    p: Project,
    c: Clip,
    frame: number,
    source?: CanvasImageSource,
    resolution = 1,
    matrix?: Affine,
  ) {
    c = resolveClip(c, frame);
    const t = c.transform,
      { width, height } = p.settings;
    ctx.save();
    if (!matrix) throw new Error("Missing layer transform");
    ctx.transform(...canvasMatrix(p, matrix));
    const crop = c.crop;
    ctx.beginPath();
    ctx.rect(
      (crop.cropLeft - 0.5) * width,
      (crop.cropTop - 0.5) * height,
      Math.max(0, 1 - crop.cropLeft - crop.cropRight) * width,
      Math.max(0, 1 - crop.cropTop - crop.cropBottom) * height,
    );
    ctx.clip();
    ctx.globalAlpha = t.opacity;
    ctx.filter = `blur(${c.effects.blur * resolution}px) brightness(${c.effects.brightness}) contrast(${c.effects.contrast}) saturate(${c.effects.saturation})`;
    if (c.mask) {
      const m = c.mask,
        x = (m.x - 0.5) * width,
        y = (m.y - 0.5) * height,
        w = m.width * width,
        h = m.height * height;
      ctx.beginPath();
      if (m.type === "ellipse")
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else ctx.rect(x, y, w, h);
      ctx.clip();
    }
    if (c.kind === "text") {
      ctx.font = `${c.text.weight} ${c.text.size}px ${c.text.font}`;
      ctx.fillStyle = c.text.color;
      ctx.textAlign = c.text.align;
      ctx.textBaseline = "middle";
      const lines = c.text.content.split("\n");
      lines.forEach((line, i) =>
        ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * c.text.size * 1.2),
      );
    } else if (c.kind === "shape") {
      ctx.fillStyle = c.shape.color;
      ctx.beginPath();
      if (c.shape.type === "ellipse")
        ctx.ellipse(
          0,
          0,
          c.shape.width / 2,
          c.shape.height / 2,
          0,
          0,
          2 * Math.PI,
        );
      else
        ctx.rect(
          -c.shape.width / 2,
          -c.shape.height / 2,
          c.shape.width,
          c.shape.height,
        );
      ctx.fill();
    } else if (source) {
      const a =
        c.kind === "composition"
          ? p.compositions.find((a) => a.id === c.compositionId)?.settings
          : p.assets.find((a) => a.id === c.assetId);
      if (a && !("kind" in a && a.kind === "audio")) {
        const scale = Math.min(width / a.width, height / a.height);
        ctx.drawImage(
          source,
          (-a.width * scale) / 2,
          (-a.height * scale) / 2,
          a.width * scale,
          a.height * scale,
        );
      }
    } else {
      ctx.filter = "none";
      ctx.fillStyle = "#24262b";
      ctx.fillRect(-width / 2, -height / 2, width, height);
      ctx.fillStyle = "#ffb8a1";
      ctx.font = `${Math.max(14, width / 50)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Media offline or unsupported", 0, 0);
    }
    ctx.restore();
  }
  dispose() {
    for (const c of this.matteSurfaces.values()) c.width = c.height = 0;
    this.matteSurfaces.clear();
    this.matteCoverage.dispose();
    this.emptyMatte.width = this.emptyMatte.height = 0;
    this.masks.dispose();
    this.maskedLayer.width = this.maskedLayer.height = 0;
    for (const surface of this.surfaces.values())
      surface.width = surface.height = 0;
    this.surfaces.clear();
    this.gpu?.dispose();
    this.gpu = null;
    return this.pool.dispose();
  }
}
