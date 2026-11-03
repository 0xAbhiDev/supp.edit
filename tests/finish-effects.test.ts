import { describe, it, expect } from "vitest";
import { finishPixels } from "../packages/engine/finish-effects";
import { effectSchema } from "../packages/effects/model";
const gray = (width: number, height: number, value = 128) => {
  const d = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < d.length; i += 4) d.set([value, value, value, 255], i);
  return d;
};
describe("Editable finishing pixels", () => {
  it("grain is deterministic, monochrome, subtle, time-varying and respects alpha", () => {
    const a = gray(32, 32),
      b = a.slice(),
      c = a.slice();
    a[3] = b[3] = c[3] = 0;
    finishPixels(a, 32, 32, "grain", 0.025, { size: 1.2, softness: 0.6 }, 7);
    finishPixels(b, 32, 32, "grain", 0.025, { size: 1.2, softness: 0.6 }, 7);
    finishPixels(c, 32, 32, "grain", 0.025, { size: 1.2, softness: 0.6 }, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.slice(0, 4)).toEqual(new Uint8ClampedArray([128, 128, 128, 0]));
    for (let i = 4; i < a.length; i += 4) {
      expect(a[i]).toBe(a[i + 1]);
      expect(a[i]).toBe(a[i + 2]);
      expect(Math.abs(a[i] - 128)).toBeLessThanOrEqual(4);
    }
    const coarse = gray(32, 32);
    finishPixels(coarse, 32, 32, "grain", 0.025, { size: 4, softness: 1 }, 7);
    expect(coarse).not.toEqual(a);
  });
  it("tonal contrast holds endpoints and is monotone without crushing near-black values", () => {
    const d = gray(256, 1);
    for (let i = 0; i < 256; i++) d.set([i, i, i, 255], i * 4);
    finishPixels(d, 256, 1, "tonalContrast", 1.09, undefined, 0);
    expect(d[0]).toBe(0);
    expect(d[255 * 4]).toBe(255);
    expect(d[8 * 4]).toBeGreaterThan(0);
    for (let i = 1; i < 256; i++)
      expect(d[i * 4]).toBeGreaterThanOrEqual(d[(i - 1) * 4]);
  });
  it("vignette preserves the center and sharpening avoids overshoot or transparent-edge halos", () => {
    const d = gray(21, 21);
    finishPixels(d, 21, 21, "vignette", 0.2, undefined, 0);
    expect(d[(10 * 21 + 10) * 4]).toBe(128);
    expect(d[0]).toBeLessThan(110);
    const edge = gray(5, 5);
    for (let i = 0; i < 25; i++)
      if (i % 5 > 2) edge.set([255, 255, 255, 0], i * 4);
    const before = edge.slice();
    finishPixels(edge, 5, 5, "sharpen", 1, undefined, 0);
    expect(edge).toEqual(before);
  });
  it("validates editable grain controls and signed temperature", () => {
    const effect = {
      id: "g",
      enabled: true,
      keys: [],
      type: "grain",
      value: 0.025,
      parameters: { size: 1.2, softness: 0.6 },
    };
    expect(effectSchema.parse(effect)).toEqual(effect);
    expect(() =>
      effectSchema.parse({ ...effect, parameters: { size: 0, softness: 0.5 } }),
    ).toThrow();
    expect(() =>
      effectSchema.parse({ ...effect, type: "temperature" }),
    ).toThrow();
    expect(
      effectSchema.parse({
        id: "warm",
        enabled: true,
        type: "temperature",
        value: -0.2,
      }),
    ).toMatchObject({ value: -0.2 });
  });
});
