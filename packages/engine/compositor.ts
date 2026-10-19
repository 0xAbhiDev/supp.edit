import { type Project, type Clip } from "../project-schema";
import { animated } from "../commands";
import { ResourcePool } from "./resources";
export class Compositor {
  readonly pool: ResourcePool;
  constructor(
    private canvas: HTMLCanvasElement,
    silent = false,
  ) {
    this.pool = new ResourcePool(silent);
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
    if (this.canvas.width !== p.settings.width)
      this.canvas.width = p.settings.width;
    if (this.canvas.height !== p.settings.height)
      this.canvas.height = p.settings.height;
    const active = p.clips.filter(
        (c) => frame >= c.start && frame < c.start + c.duration,
      ),
      solo = p.tracks.some((t) => t.solo),
      prepared = new Map<string, CanvasImageSource>();
    let failure: Error | null = null;
    await Promise.all(
      active.map(async (c) => {
        const track = p.tracks.find((t) => t.id === c.trackId),
          asset = p.assets.find((a) => a.id === c.assetId);
        if (!track || !asset) return;
        if (track.kind === "video" && track.hidden) return;
        try {
          const r = await this.pool.prepare(c, asset, p, frame, playing, speed);
          if (!(r.element instanceof HTMLAudioElement))
            prepared.set(c.id, r.element);
          if (asset.hasAudio)
            await this.pool.audio(
              c,
              asset,
              p,
              frame,
              playing,
              speed,
              !track.muted && (!solo || track.solo),
            );
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
        }
      }),
    );
    await this.pool.pauseInactive(
      new Set(
        active
          .filter((c) => !p.tracks.find((t) => t.id === c.trackId)?.hidden)
          .map((c) => c.id),
      ),
    );
    if (strict && failure) throw failure;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Topmost video track in the UI composites last. Track order is persistent.
    for (const track of [...p.tracks].reverse()) {
      if (track.kind !== "video" || track.hidden) continue;
      for (const c of active.filter((c) => c.trackId === track.id))
        this.draw(ctx, p, c, frame, prepared.get(c.id));
    }
    void this.pool.prune(new Set(active.map((c) => c.id)));
    return failure as Error | null;
  }
  private draw(
    ctx: CanvasRenderingContext2D,
    p: Project,
    c: Clip,
    frame: number,
    source?: CanvasImageSource,
  ) {
    const t = animated(c, frame),
      { width, height } = p.settings;
    ctx.save();
    ctx.translate(width / 2 + t.x, height / 2 + t.y);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scale, t.scale);
    ctx.globalAlpha = t.opacity;
    ctx.filter = `blur(${c.effects.blur}px) brightness(${c.effects.brightness}) contrast(${c.effects.contrast}) saturate(${c.effects.saturation})`;
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
    return this.pool.dispose();
  }
}
