import type { EffectType } from "../effects/model";
/** Canvas fallback only. Explicit channel math avoids browser CSS-filter coefficient quantization. */
export function colorEffect(
  source: HTMLCanvasElement,
  target: CanvasRenderingContext2D,
  type: Exclude<EffectType, "blur">,
  value: number,
) {
  const pixels = source
      .getContext("2d")!
      .getImageData(0, 0, source.width, source.height),
    d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i] / 255,
      g = d[i + 1] / 255,
      b = d[i + 2] / 255,
      luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (let ch = 0; ch < 3; ch++) {
      const v = d[i + ch] / 255;
      const result =
        type === "brightness"
          ? v * value
          : type === "contrast"
            ? (v - 0.5) * value + 0.5
            : luma + (v - luma) * value;
      d[i + ch] = Math.round(Math.max(0, Math.min(1, result)) * 255);
    }
  }
  target.putImageData(pixels, 0, 0);
}
