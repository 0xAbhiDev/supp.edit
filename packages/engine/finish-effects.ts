import { grainOf, curvesOf, type Effect } from "../effects/model";
import { curveTables } from "../effects/curves";
export type FinishType =
  "grain" | "vignette" | "sharpen" | "temperature" | "tonalContrast" | "curves";
export const isFinishEffect = (type: string): type is FinishType =>
  ["grain", "vignette", "sharpen", "temperature", "tonalContrast", "curves"].includes(
    type,
  );
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
function noise(x: number, y: number, seed: number) {
  let h =
    (Math.imul(x, 73856093) ^
      Math.imul(y, 19349663) ^
      Math.imul(seed, 83492791)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5;
}
/** Deterministic monochrome grain; coordinates/seed/hash match the GPU path. */
export function finishPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  type: FinishType,
  value: number,
  parameters: Effect["parameters"],
  frame: number,
  scale = 1,
) {
  const grain = grainOf({ parameters }),
    source = type === "sharpen" ? data.slice() : data,
    size = Math.max(0.25, (grain.size ?? 1.2) * scale),
    softness = grain.softness ?? 0.6,
    seed = Math.floor(frame) >>> 0;
  if (type === "curves") {
    const curves = curvesOf({ parameters });
    if (!curves) return;
    // Evaluated on the 0–1 level of each 8-bit channel, as the shader evaluates it.
    const tables = curveTables(curves, value);
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      for (let ch = 0; ch < 3; ch++)
        data[i + ch] = Math.round(clamp(tables[ch][data[i + ch]]) * 255);
    }
    return;
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!source[i + 3]) continue;
      let delta = 0,
        factor = 1;
      if (type === "grain") {
        const gx = (x + 0.5) / size,
          gy = (y + 0.5) / size,
          ix = Math.floor(gx),
          iy = Math.floor(gy),
          tx = smooth(gx - ix),
          ty = smooth(gy - iy);
        const a = noise(ix, iy, seed),
          b = noise(ix + 1, iy, seed),
          c = noise(ix, iy + 1, seed),
          d = noise(ix + 1, iy + 1, seed);
        const blended = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
        delta = (a * (1 - softness) + blended * softness) * value;
      } else if (type === "vignette")
        factor =
          1 -
          value *
            smooth(
              (Math.hypot(
                ((x + 0.5) / width) * 2 - 1,
                ((y + 0.5) / height) * 2 - 1,
              ) /
                Math.SQRT2 -
                0.25) /
                0.75,
            );
      for (let ch = 0; ch < 3; ch++) {
        const v = source[i + ch] / 255;
        let result = v;
        if (type === "grain") result = v + delta;
        else if (type === "vignette") result = v * factor;
        else if (type === "temperature")
          result = v * (1 + value * (ch === 0 ? 0.08 : ch === 2 ? -0.08 : 0));
        else if (type === "tonalContrast")
          result = v + (value - 1) * (v - 0.5) * 4 * v * (1 - v);
        else {
          let sum = 0,
            weight = 0,
            lo = v,
            hi = v;
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const j = (ny * width + nx) * 4,
              a = source[j + 3] / 255,
              n = source[j + ch] / 255;
            if (a) {
              sum += n * a;
              weight += a;
              lo = Math.min(lo, n);
              hi = Math.max(hi, n);
            }
          }
          if (weight)
            result = clamp(
              v + clamp((v - sum / weight) * value, -0.025, 0.025),
              lo,
              hi,
            );
        }
        data[i + ch] = Math.round(clamp(result) * 255);
      }
    }
}
