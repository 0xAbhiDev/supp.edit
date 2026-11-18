/** Frame features of decoded audio on a fixed 10 ms hop: the shared clock for every audio event.
 * A frame index i starts at i × hop and is centered on its analysis window, so event times are
 * reported on the same millisecond timeline as the decoded video frames. */
export interface PCM {
  rate: number;
  /** One or two channels of equal length, −1…1. */
  channels: Float32Array[];
}
export const HOP_MS = 10;
export const BANDS = [
  { name: "sub", low: 20, high: 120 },
  { name: "low", low: 120, high: 400 },
  { name: "mid", low: 400, high: 2000 },
  { name: "high", low: 2000, high: 6000 },
  { name: "air", low: 6000, high: 20000 },
] as const;
export type BandName = (typeof BANDS)[number]["name"];
export interface Features {
  hopMs: number;
  frames: number;
  durationMs: number;
  /** Mono RMS, 0–1. */
  rms: Float32Array;
  rmsLeft: Float32Array;
  rmsRight: Float32Array;
  /** RMS of the side signal (L−R)/2; relative to rms it measures stereo width. */
  side: Float32Array;
  /** Log energy per band, per frame. */
  bands: Record<BandName, Float32Array>;
  /** Half-wave rectified log-magnitude spectral flux, whole spectrum and per band. */
  flux: Float32Array;
  bandFlux: Record<BandName, Float32Array>;
  /** Spectral centroid in Hz. */
  centroid: Float32Array;
  /** Spectral flatness between 300 Hz and 8 kHz, 0 (tonal) to 1 (noise). */
  flatness: Float32Array;
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2,
          tr = re[b] * cr - im[b] * ci,
          ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export function audioFeatures(pcm: PCM): Features {
  const left = pcm.channels[0],
    right = pcm.channels[1] ?? pcm.channels[0],
    rate = pcm.rate,
    hop = Math.round((rate * HOP_MS) / 1000),
    size = rate > 32000 ? 2048 : 1024,
    frames = Math.max(1, Math.ceil(left.length / hop)),
    bins = size / 2 + 1;
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const bandOf = new Int8Array(bins).fill(-1),
    bandBins = new Int32Array(BANDS.length);
  for (let k = 0; k < bins; k++) {
    const hz = (k * rate) / size;
    const b = BANDS.findIndex((band) => hz >= band.low && hz < band.high);
    bandOf[k] = b;
    if (b >= 0) bandBins[b]++;
  }
  const make = () => new Float32Array(frames);
  const features: Features = {
    hopMs: HOP_MS,
    frames,
    durationMs: Math.round((left.length * 1000) / rate),
    rms: make(),
    rmsLeft: make(),
    rmsRight: make(),
    side: make(),
    bands: Object.fromEntries(BANDS.map((b) => [b.name, make()])) as Features["bands"],
    flux: make(),
    bandFlux: Object.fromEntries(BANDS.map((b) => [b.name, make()])) as Features["bandFlux"],
    centroid: make(),
    flatness: make(),
  };
  const flatFrom = Math.ceil((300 * size) / rate),
    flatTo = Math.min(bins - 1, Math.floor((8000 * size) / rate));
  const re = new Float64Array(size),
    im = new Float64Array(size);
  let previous = new Float64Array(bins);
  const current = new Float64Array(bins);
  const bandEnergy = new Float64Array(BANDS.length),
    bandRise = new Float64Array(BANDS.length);
  for (let f = 0; f < frames; f++) {
    // The window is centered on the frame's hop so a frame time is where its energy is.
    const center = f * hop + (hop >> 1),
      start = center - size / 2;
    let sum = 0,
      sumL = 0,
      sumR = 0,
      sumS = 0;
    for (let i = f * hop; i < Math.min(left.length, (f + 1) * hop); i++) {
      const l = left[i],
        r = right[i];
      sum += ((l + r) / 2) ** 2;
      sumS += ((l - r) / 2) ** 2;
      sumL += l * l;
      sumR += r * r;
    }
    const count = Math.max(1, Math.min(left.length, (f + 1) * hop) - f * hop);
    features.rms[f] = Math.sqrt(sum / count);
    features.side[f] = Math.sqrt(sumS / count);
    features.rmsLeft[f] = Math.sqrt(sumL / count);
    features.rmsRight[f] = Math.sqrt(sumR / count);
    for (let i = 0; i < size; i++) {
      const at = start + i,
        v = at >= 0 && at < left.length ? (left[at] + right[at]) / 2 : 0;
      re[i] = v * window[i];
      im[i] = 0;
    }
    fft(re, im);
    bandEnergy.fill(0);
    bandRise.fill(0);
    let flux = 0,
      weighted = 0,
      total = 0,
      logSum = 0,
      linSum = 0;
    for (let k = 0; k < bins; k++) {
      const power = re[k] * re[k] + im[k] * im[k],
        magnitude = Math.log1p(100 * Math.sqrt(power));
      current[k] = magnitude;
      const rise = Math.max(0, magnitude - previous[k]);
      flux += rise;
      const b = bandOf[k];
      if (b >= 0) {
        bandEnergy[b] += power;
        bandRise[b] += rise;
      }
      weighted += ((k * rate) / size) * power;
      total += power;
      if (k >= flatFrom && k <= flatTo) {
        logSum += Math.log(power + 1e-12);
        linSum += power + 1e-12;
      }
    }
    const flatBins = flatTo - flatFrom + 1;
    features.flatness[f] = linSum > 1e-9 * flatBins ? Math.exp(logSum / flatBins) / (linSum / flatBins) : 0;
    // Each band counts equally: a kick's few low bins weigh as much as a hat's many high ones.
    let bandMean = 0;
    BANDS.forEach((_, b) => (bandMean += bandRise[b] / Math.max(1, bandBins[b])));
    features.flux[f] = bandMean / BANDS.length;
    void flux;
    features.centroid[f] = total > 0 ? weighted / total : 0;
    BANDS.forEach((band, b) => {
      features.bands[band.name][f] = Math.log10(1e-10 + bandEnergy[b]);
      features.bandFlux[band.name][f] = bandRise[b] / Math.max(1, bandBins[b]);
    });
    [previous] = [Float64Array.from(current)];
  }
  return features;
}
