/** Per-channel tone distribution of decoded frames, and the editable cast that carries one
 * distribution toward another. A graded plate is rarely a flat wash: its shadows and midtones
 * take the cast while highlights stay near neutral. Five percentiles per channel describe that
 * shape well enough to rebuild it from one brightness gain and one luminance-matted multiply. */
import { z } from "zod";

export const TONE_QUANTILES = [0.03, 0.25, 0.5, 0.75, 0.97] as const;
const level = z.number().finite().min(0).max(255);
/** RGB at the 3rd, 25th, 50th, 75th and 97th percentile of each channel. */
export const toneSchema = z.array(z.array(level).length(3)).length(5);
export type Tone = z.infer<typeof toneSchema>;
export const STRIPES = 8,
  TONE_BINS = 32;
/** Per vertical stripe, per channel, a coarse histogram: lets the tone of any horizontal span
 * of the frame be recovered later, once framing has decided which part is shown. */
const stripesSchema = z
  .array(z.array(z.array(z.number().int().nonnegative()).length(TONE_BINS)).length(3))
  .length(STRIPES);
export const toneSampleSchema = z
  .object({ timeMs: z.number().int().nonnegative(), tone: toneSchema, stripes: stripesSchema.optional() })
  .strict();
export type ToneSample = z.infer<typeof toneSampleSchema>;

export function frameTone(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  channels: 3 | 4,
  skip?: { x: number; y: number; width: number; height: number },
): Tone {
  const counts = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let total = 0;
  for (let y = 0; y < h; y += 2) {
    const banded = skip && y >= skip.y && y < skip.y + skip.height;
    for (let x = y % 4 ? 1 : 0; x < w; x += 2) {
      if (banded && x >= skip.x && x < skip.x + skip.width) continue;
      const i = (y * w + x) * channels;
      counts[0][data[i]]++;
      counts[1][data[i + 1]]++;
      counts[2][data[i + 2]]++;
      total++;
    }
  }
  return TONE_QUANTILES.map((q) =>
    counts.map((c) => {
      let seen = 0;
      const want = q * Math.max(1, total - 1);
      for (let v = 0; v < 256; v++) {
        seen += c[v];
        if (seen > want) return v;
      }
      return 255;
    }),
  );
}

export function medianTone(tones: Tone[]): Tone | undefined {
  if (!tones.length) return;
  return TONE_QUANTILES.map((_, q) =>
    [0, 1, 2].map((c) => tones.map((t) => t[q][c]).sort((a, b) => a - b)[tones.length >> 1]),
  );
}

const luma = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const hex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

/** Solve a brightness gain, a highlight cast and a shadow cast that carry the source's
 * highlights and median onto the reference's.
 *
 * The highlight cast is a plain multiply: a white balance. The shadow cast multiplies through an
 * inverted-luminance matte, so a pixel of luminance L is scaled by 1 − (1 − L)(1 − m): fully in
 * shadows, hardly at all in highlights. Together they rebuild a grade whose cast deepens toward
 * the shadows. */
export function castTreatment(source: Tone, target: Tone, mix = 1) {
  const k = clamp(mix, 0, 1);
  const balance = target[4].map((v, c) => Math.max(1, v) / Math.max(1, source[4][c])),
    peak = Math.max(...balance);
  const highlight = balance.map((v) => clamp(v / peak, 0.25, 1));
  let gain = clamp(luma(target[4]) / Math.max(1, luma(source[4])), 0.3, 1.8);
  let shadow = [1, 1, 1];
  const through = (rgb: number[]) => {
    const lit = rgb.map((v) => Math.min(255, v * gain)),
      shade = 1 - luma(lit) / 255;
    return lit.map((v, c) => v * highlight[c] * (1 - shade * (1 - shadow[c])));
  };
  for (let pass = 0; pass < 4; pass++) {
    const mid = source[2].map((v) => Math.min(255, v * gain)),
      shade = Math.max(0.05, 1 - luma(mid) / 255);
    shadow = mid.map((v, c) =>
      clamp(1 - (1 - target[2][c] / Math.max(1, v * highlight[c])) / shade, 0.04, 1),
    );
    // Both casts dim the highlights a little; restore them with the gain.
    gain = clamp((gain * luma(target[4])) / Math.max(1, luma(through(source[4]))), 0.3, 1.8);
  }
  return {
    gain: Math.pow(gain, k),
    highlight: hex(highlight.map((m) => 255 * m)),
    shadow: hex(shadow.map((m) => 255 * m)),
    strength: k,
    predicted: [through(source[2]), through(source[4])],
  };
}

export function frameStripes(data: Uint8Array | Uint8ClampedArray, w: number, h: number, channels: 3 | 4) {
  const out = Array.from({ length: STRIPES }, () => [0, 1, 2].map(() => new Array<number>(TONE_BINS).fill(0)));
  for (let y = 0; y < h; y += 2)
    for (let x = y % 4 ? 1 : 0; x < w; x += 2) {
      const stripe = Math.min(STRIPES - 1, Math.floor((x * STRIPES) / w)),
        i = (y * w + x) * channels;
      for (let c = 0; c < 3; c++) out[stripe][c][data[i + c] >> 3]++;
    }
  return out;
}

/** Percentiles of the span [left, right) of the frame width (0–1), from stripe histograms.
 * Partly covered stripes count in proportion; levels interpolate within a bin. */
export function spanTone(samples: { stripes?: number[][][] }[], left: number, right: number): Tone | undefined {
  const hist = [0, 1, 2].map(() => new Array<number>(TONE_BINS).fill(0));
  let used = 0;
  for (const sample of samples) {
    if (!sample.stripes) continue;
    used++;
    sample.stripes.forEach((stripe, k) => {
      const a = k / STRIPES,
        b = (k + 1) / STRIPES,
        weight = Math.max(0, Math.min(b, right) - Math.max(a, left)) * STRIPES;
      if (weight > 0) for (let c = 0; c < 3; c++) for (let v = 0; v < TONE_BINS; v++) hist[c][v] += stripe[c][v] * weight;
    });
  }
  if (!used) return;
  return TONE_QUANTILES.map((q) =>
    hist.map((bins) => {
      const total = bins.reduce((t, v) => t + v, 0),
        want = q * total;
      let seen = 0;
      for (let v = 0; v < TONE_BINS; v++) {
        if (seen + bins[v] >= want && bins[v] > 0) return Math.min(255, (v + (want - seen) / bins[v]) * (256 / TONE_BINS));
        seen += bins[v];
      }
      return 255;
    }),
  );
}
