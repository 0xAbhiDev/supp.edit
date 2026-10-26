import type { Clip } from "../project-schema";
import { resolveMask, maskPath } from "../masks/evaluate";
import { LruCache } from "./lru";
const release = (c: HTMLCanvasElement) => {
  c.width = c.height = 0;
};
/** Shared coverage rasterization gives CPU and GPU the same cubic geometry/alpha.
 * No pixel readback: the GPU uploads the coverage canvas directly.
 */
export class MaskRasterizer {
  private cache = new LruCache<string, HTMLCanvasElement>(
    64 * 1024 * 1024,
    8,
    release,
  );
  private raw = document.createElement("canvas");
  private filtered = document.createElement("canvas");
  get bytes() {
    return (
      this.cache.bytes +
      (this.raw.width * this.raw.height +
        this.filtered.width * this.filtered.height) *
        4
    );
  }
  raster(
    c: Clip,
    frame: number,
    width: number,
    height: number,
    scale = 1,
  ): HTMLCanvasElement | undefined {
    const masks = c.masks
      .filter((m) => m.enabled)
      .map((m) => resolveMask(m, frame - c.start));
    if (!masks.length) return;
    const w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    const key = JSON.stringify([
      w,
      h,
      masks.map(
        ({ vertices, opacity, feather, expansion, mode, inverted }) => ({
          vertices,
          opacity,
          feather,
          expansion,
          mode,
          inverted,
        }),
      ),
    ]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const padding =
      Math.ceil(
        Math.max(...masks.map((m) => 3 * m.feather + Math.abs(m.expansion))) *
          scale,
      ) + 2;
    const rw = w + 2 * padding,
      rh = h + 2 * padding;
    if (
      w * h * 4 > this.cache.maxBytes ||
      rw * rh * 8 + w * h * 4 > 128 * 1024 * 1024
    )
      throw new Error(
        "Mask surface exceeds the 128 MiB working budget at this resolution",
      );
    const output = document.createElement("canvas");
    output.width = w;
    output.height = h;
    const out = output.getContext("2d")!;
    this.raw.width = rw;
    this.raw.height = rh;
    this.filtered.width = w;
    this.filtered.height = h;
    const raw = this.raw.getContext("2d")!,
      filtered = this.filtered.getContext("2d")!;
    if (masks[0].mode === "subtract" || masks[0].mode === "intersect") {
      out.fillStyle = "#fff";
      out.fillRect(0, 0, w, h);
    }
    for (const m of masks) {
      raw.resetTransform();
      raw.globalCompositeOperation = "source-over";
      raw.clearRect(0, 0, rw, rh);
      raw.setTransform(scale, 0, 0, scale, padding, padding);
      raw.fillStyle = raw.strokeStyle = "#fff";
      raw.lineJoin = "round";
      const path = new Path2D(maskPath(m.vertices, width, height));
      raw.fill(path);
      if (m.expansion !== 0) {
        raw.globalCompositeOperation =
          m.expansion < 0 ? "destination-out" : "source-over";
        raw.lineWidth = 2 * Math.abs(m.expansion);
        raw.stroke(path);
      }
      filtered.globalCompositeOperation = "source-over";
      filtered.filter = "none";
      filtered.clearRect(0, 0, w, h);
      if (m.inverted) {
        filtered.fillStyle = "#fff";
        filtered.fillRect(0, 0, w, h);
        filtered.globalCompositeOperation = "destination-out";
      }
      filtered.filter = m.feather > 0 ? `blur(${m.feather * scale}px)` : "none";
      filtered.drawImage(this.raw, -padding, -padding);
      filtered.filter = "none";
      out.globalAlpha = m.opacity;
      out.globalCompositeOperation = (
        {
          add: "source-over",
          subtract: "destination-out",
          intersect: "destination-in",
          difference: "xor",
        } as const
      )[m.mode];
      out.drawImage(this.filtered, 0, 0);
    }
    this.cache.set(key, output, w * h * 4);
    return output;
  }
  dispose() {
    this.cache.clear();
    release(this.raw);
    release(this.filtered);
  }
}
