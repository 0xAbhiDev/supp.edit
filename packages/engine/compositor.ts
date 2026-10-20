import { type Project, type Clip } from "../project-schema";
import { animated } from "../commands";
import { ResourcePool } from "./resources";
import { GpuRenderer } from "./gpu";
import { projectIndex } from "./project-index";
import type { RendererMode } from "./diagnostics";
export class Compositor {
  readonly pool: ResourcePool;
  private gpu: GpuRenderer | null = null;
  private cancelled = false;
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
  async render(
    p: Project,
    frame: number,
    playing = false,
    speed = 1,
    strict = false,
  ) {
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D is unavailable");
    const scale = strict ? 1 : (this.options.scale ?? 1);
    const width = Math.max(1, Math.round(p.settings.width * scale)),
      height = Math.max(1, Math.round(p.settings.height * scale));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const index = projectIndex(p),
      active = index.all
        .range(frame, frame + 1)
        .sort((a, b) => index.order.get(a.id)! - index.order.get(b.id)!),
      solo = p.tracks.some((t) => t.solo),
      prepared = new Map<string, CanvasImageSource>();
    this.pool.setActive(new Set(active.map((c) => c.id)));
    let failure: Error | null = null;
    await Promise.all(
      active.map(async (c) => {
        const track = index.trackById.get(c.trackId),
          asset = c.assetId ? index.assets.get(c.assetId) : undefined;
        if (!track || !asset) return;
        if (track.kind === "video" && track.hidden) return;
        try {
          const r = await this.pool.prepare(c, asset, p, frame, playing, speed);
          if (!(r.element instanceof HTMLAudioElement))
            prepared.set(
              c.id,
              await this.pool.visual(r, c, asset, p, frame, playing),
            );
          if (asset.hasAudio)
            await this.pool.audio(
              r,
              c,
              playing,
              speed,
              !track.muted && (!solo || track.solo),
            );
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
        }
      }),
    );
    if (this.cancelled) {
      this.pool.pauseInactive(new Set());
      this.pool.releaseFrames();
      return null;
    }
    await this.pool.pauseInactive(
      new Set(
        active
          .filter((c) => !p.tracks.find((t) => t.id === c.trackId)?.hidden)
          .map((c) => c.id),
      ),
    );
    if (strict && failure) {
      this.pool.releaseFrames();
      throw failure;
    }
    const drawLayers = (draw: (c: Clip) => void) => {
      for (const track of [...p.tracks].reverse()) {
        if (track.kind !== "video" || track.hidden) continue;
        for (const c of active) if (c.trackId === track.id) draw(c);
      }
    };
    try {
      let gpuRendered = false;
      if (this.gpu)
        try {
          this.gpu.begin(width, height);
          drawLayers((c) => this.gpu!.draw(p, c, frame, prepared.get(c.id)));
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          ctx.filter = "none";
          ctx.drawImage(this.gpu.canvas, 0, 0);
          gpuRendered = true;
        } catch (e) {
          this.fallback = String(e);
          this.gpu.dispose();
          this.gpu = null;
        }
      if (!gpuRendered) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.scale(scale, scale);
        drawLayers((c) =>
          this.draw(ctx, p, c, frame, prepared.get(c.id), scale),
        );
      }
      const activeIds = new Set(active.map((c) => c.id));
      this.pool.prune(activeIds);
      if (!strict)
        this.pool.prefetch(
          p,
          index.all.range(
            frame + 1,
            frame + Math.ceil(p.settings.fps.num / p.settings.fps.den),
          ),
          activeIds,
        );
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
  ) {
    const t = animated(c, frame),
      { width, height } = p.settings;
    ctx.save();
    ctx.translate(width / 2 + t.x, height / 2 + t.y);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scale, t.scale);
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
      const a = p.assets.find((a) => a.id === c.assetId);
      if (a && a.kind !== "audio") {
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
    this.gpu?.dispose();
    this.gpu = null;
    return this.pool.dispose();
  }
}
