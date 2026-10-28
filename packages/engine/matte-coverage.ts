import type { Matte } from "../compositing/model";
/** CPU fallback only. GPU luma extraction stays entirely in the fragment shader. */
export class MatteCoverage {
  private canvas = document.createElement("canvas");
  raster(
    source: HTMLCanvasElement,
    mode: Matte["mode"],
    width: number,
    height: number,
  ) {
    if (mode === "alpha") return source;
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    if (mode === "alpha-inverted") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(source, 0, 0, width, height);
    } else {
      ctx.drawImage(source, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height),
        data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        const luma =
          ((data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) *
            data[i + 3]) /
          255;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = mode === "luma" ? luma : 255 - luma;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    return this.canvas;
  }
  get bytes() {
    return this.canvas.width * this.canvas.height * 4;
  }
  dispose() {
    this.canvas.width = this.canvas.height = 0;
  }
}
