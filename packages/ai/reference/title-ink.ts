/** Full-resolution ink evidence for a stationary title in a short reference interval.
 *
 * A difference- or invert-composited title shows the photographic negative of the plate, so its
 * color changes with whatever is underneath. No single threshold isolates it. The plate outside
 * the title band supplies a color model for the same frame: a band pixel is ink when its
 * negative is an ordinary plate color and the pixel itself is not. Votes across the frames of one
 * stationary word then reject moving scenery. Only binary masks leave this module. */
export interface InkBand {
  x: number;
  y: number;
  width: number;
  height: number;
}
const BINS = 16,
  SHIFT = 4;
const bin = (r: number, g: number, b: number) =>
  ((r >> SHIFT) * BINS + (g >> SHIFT)) * BINS + (b >> SHIFT);

/** Smoothed color occupancy of everything outside the title band. */
export function plateColors(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  channels: 3 | 4,
  band: InkBand,
) {
  const raw = new Float32Array(BINS ** 3);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const inside = y >= band.y && y < band.y + band.height;
    for (let x = 0; x < w; x++) {
      if (inside && x >= band.x && x < band.x + band.width) continue;
      const i = (y * w + x) * channels;
      raw[bin(data[i], data[i + 1], data[i + 2])]++;
      total++;
    }
  }
  // Separable [1 2 1] smoothing tolerates codec noise and soft gradients.
  let source = raw;
  for (const stride of [1, BINS, BINS * BINS]) {
    const next = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const axis = Math.floor(i / stride) % BINS;
      next[i] =
        2 * source[i] +
        (axis > 0 ? source[i - stride] : source[i]) +
        (axis < BINS - 1 ? source[i + stride] : source[i]);
    }
    source = next;
  }
  const scale = 1 / (64 * Math.max(1, total));
  for (let i = 0; i < source.length; i++) source[i] *= scale;
  return source;
}

/** One byte per band pixel: 1 where the negative explains the pixel far better than the plate. */
export function negativeInk(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  channels: 3 | 4,
  band: InkBand,
  plate = plateColors(data, w, h, channels, band),
) {
  const out = new Uint8Array(band.width * band.height);
  for (let y = 0; y < band.height; y++)
    for (let x = 0; x < band.width; x++) {
      const i = ((band.y + y) * w + band.x + x) * channels,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      // Near mid-gray the negative equals the plate and carries no evidence.
      if (Math.abs(r - 128) + Math.abs(g - 128) + Math.abs(b - 128) < 60) continue;
      const natural = plate[bin(r, g, b)],
        negative = plate[bin(255 - r, 255 - g, 255 - b)];
      if (negative > 2e-4 && negative > 3 * natural) out[y * band.width + x] = 1;
    }
  return out;
}

/** Pixels marked in at least `share` of the masks. */
export function voteInk(masks: Uint8Array[], share = 0.5) {
  const out = new Uint8Array(masks[0]?.length ?? 0),
    need = Math.max(1, Math.ceil(masks.length * share));
  for (let i = 0; i < out.length; i++) {
    let votes = 0;
    for (const m of masks) votes += m[i];
    if (votes >= need) out[i] = 1;
  }
  return out;
}

/** Strokes of one title: connected groups that reach its central band, plus detached marks
 * (a crossbar swash, a dot, an accent) lying close to them. Distant scenery is discarded. */
export function titleStrokes(
  mask: Uint8Array,
  width: number,
  height: number,
  centerY: number,
  reach: number,
  minimum = 6,
) {
  const label = new Int32Array(mask.length),
    queue = new Int32Array(mask.length);
  const groups: { n: number; x: number; y: number; right: number; bottom: number; keep: boolean }[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    const id = groups.length + 1;
    let n = 1,
      x = width,
      right = 0,
      y = height,
      bottom = 0;
    queue[0] = start;
    label[start] = id;
    for (let j = 0; j < n; j++) {
      const at = queue[j],
        px = at % width,
        py = (at - px) / width;
      x = Math.min(x, px);
      right = Math.max(right, px);
      y = Math.min(y, py);
      bottom = Math.max(bottom, py);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx,
            qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
          const k = qy * width + qx;
          if (mask[k] && !label[k]) {
            label[k] = id;
            queue[n++] = k;
          }
        }
    }
    groups.push({
      n,
      x,
      y,
      right,
      bottom,
      keep: n >= minimum && y <= centerY + reach && bottom >= centerY - reach,
    });
  }
  // A title is one horizontal cluster of strokes. Scenery at the same height elsewhere in the
  // frame is separated from it by more than a line height; keep the cluster with the most ink.
  const lineGap = 2.5 * reach;
  const ordered = groups.filter((g) => g.keep).sort((a, b) => a.x - b.x),
    clusters: (typeof groups)[] = [];
  for (const g of ordered) {
    const last = clusters.at(-1);
    if (last && g.x - Math.max(...last.map((q) => q.right)) <= lineGap) last.push(g);
    else clusters.push([g]);
  }
  const chosen = clusters.sort(
    (a, b) => b.reduce((t, g) => t + g.n, 0) - a.reduce((t, g) => t + g.n, 0),
  )[0];
  for (const g of groups) if (g.keep && !chosen?.includes(g)) g.keep = false;
  const anchors = groups.filter((g) => g.keep);
  if (anchors.length) {
    const box = {
      x: Math.min(...anchors.map((g) => g.x)),
      y: Math.min(...anchors.map((g) => g.y)),
      right: Math.max(...anchors.map((g) => g.right)),
      bottom: Math.max(...anchors.map((g) => g.bottom)),
    };
    const gap = Math.max(2, 0.2 * (box.bottom - box.y + 1));
    for (let grew = true; grew; ) {
      grew = false;
      for (const g of groups) {
        if (g.keep || g.n < minimum) continue;
        if (
          g.x > box.right + gap ||
          g.right < box.x - gap ||
          g.y > box.bottom + gap ||
          g.bottom < box.y - gap
        )
          continue;
        g.keep = grew = true;
        box.x = Math.min(box.x, g.x);
        box.y = Math.min(box.y, g.y);
        box.right = Math.max(box.right, g.right);
        box.bottom = Math.max(box.bottom, g.bottom);
      }
    }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++)
    if (label[i] && groups[label[i] - 1].keep) out[i] = 1;
  return out;
}

export interface InkSample {
  timeMs: number;
  mask: Uint8Array;
  /** Band pixels hidden this frame by a measured person contour. */
  person?: Uint8Array;
  /** Band pixels hidden every frame by a recurring label. */
  label?: Uint8Array;
  /** The whole frame is briefly recolored (a negative pulse); its mask is not comparable. */
  pulsed?: boolean;
}
export interface InkRun {
  startMs: number;
  endMs: number;
  frames: InkSample[];
}
const count = (m: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
};
const agreement = (a: Uint8Array, b: Uint8Array) => {
  let both = 0,
    any = 0;
  for (let i = 0; i < a.length; i++) {
    both += a[i] & b[i];
    any += a[i] | b[i];
  }
  return both / Math.max(1, any);
};
/** Split frames into intervals showing the same stationary lettering. A new word, an empty
 * frame, or lettering that moved begins another run. A cut underneath does not. */
export function inkRuns(samples: InkSample[], endMs: number, minimumInk: number) {
  const runs: InkRun[] = [];
  let reference: Uint8Array | undefined;
  // Pulsed frames since the last comparable one. They neither extend nor end a run by
  // themselves; the comparable frames on either side decide.
  let pending: InkSample[] = [];
  const contains = (frame: Uint8Array, ink: Uint8Array) => {
    let held = 0,
      total = 0;
    for (let i = 0; i < ink.length; i++) {
      total += ink[i];
      held += ink[i] & frame[i];
    }
    return held / Math.max(1, total);
  };
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i],
      next = samples[i + 1]?.timeMs ?? endMs,
      last = runs.at(-1);
    if (sample.pulsed) {
      pending.push(sample);
      continue;
    }
    const bridged = pending;
    pending = [];
    if (count(sample.mask) < minimumInk) {
      // The title may have ended inside the pulse: keep the pulsed frames that still show it.
      if (last && reference && bridged.length && last.endMs === bridged[0].timeMs)
        for (const b of bridged) {
          if (contains(b.mask, reference) < 0.5) break;
          last.endMs = samples[samples.indexOf(b) + 1]?.timeMs ?? endMs;
        }
      reference = undefined;
      continue;
    }
    const prior = samples[i - 1 - bridged.length];
    // Lettering that vanished leaves sparse static scenery, which agrees with itself frame to
    // frame. Much less ink than the run's consensus ends the run.
    const same =
      !!last &&
      !!reference &&
      !!prior &&
      count(sample.mask) >= count(reference) * 0.4 &&
      last.endMs === (bridged[0]?.timeMs ?? sample.timeMs) &&
      (agreement(sample.mask, prior.mask) > 0.5 || agreement(sample.mask, reference) > 0.5);
    if (same) {
      last!.frames.push(sample);
      last!.endMs = next;
      // The running consensus damps a single compression-damaged frame.
      if (last!.frames.length <= 8 || last!.frames.length % 4 === 0)
        reference = voteInk(
          last!.frames.map((f) => f.mask),
          0.5,
        );
    } else {
      // A title that appeared during the pulse starts with the pulsed frames that show it.
      let startMs = sample.timeMs;
      for (let b = bridged.length - 1; b >= 0; b--) {
        if (contains(bridged[b].mask, sample.mask) < 0.5) break;
        startMs = bridged[b].timeMs;
      }
      if (last && reference && bridged.length && last.endMs === bridged[0].timeMs)
        for (const b of bridged) {
          if (b.timeMs >= startMs || contains(b.mask, reference) < 0.5) break;
          last.endMs = samples[samples.indexOf(b) + 1]?.timeMs ?? endMs;
        }
      runs.push({ startMs, endMs: next, frames: [sample] });
      reference = sample.mask;
    }
  }
  return runs;
}

export function inkBounds(mask: Uint8Array, width: number, height: number) {
  let left = width,
    right = -1,
    top = height,
    bottom = -1,
    count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width,
      y = (i - x) / width;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    count++;
  }
  return count
    ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1, count }
    : undefined;
}

/** 32×16 occupancy rows, the shape shared with local font comparison. */
export function glyphRows(
  mask: Uint8Array,
  width: number,
  box: { x: number; y: number; width: number; height: number },
) {
  return Array.from({ length: 16 }, (_, row) => {
    let bits = 0;
    for (let col = 0; col < 32; col++) {
      const x0 = box.x + Math.floor((col * box.width) / 32),
        x1 = Math.max(x0 + 1, box.x + Math.floor(((col + 1) * box.width) / 32)),
        y0 = box.y + Math.floor((row * box.height) / 16),
        y1 = Math.max(y0 + 1, box.y + Math.floor(((row + 1) * box.height) / 16));
      let hits = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) hits += mask[y * width + x];
      if (hits * 2.5 >= (x1 - x0) * (y1 - y0)) bits |= 1 << col;
    }
    return bits >>> 0;
  });
}

/** One byte per band pixel: 1 where a saturated color is far more common inside the band than in
 * the rest of the frame. A flat colored title (red serif, yellow caption) is concentrated in the
 * band; the scenery it covers continues outside it. Neutral pixels carry no evidence: white and
 * black lettering is left to the negative and luminance models. */
export function distinctInk(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  channels: 3 | 4,
  band: InkBand,
  plate = plateColors(data, w, h, channels, band),
) {
  const inside = new Float32Array(BINS ** 3);
  let total = 0;
  for (let y = 0; y < band.height; y++)
    for (let x = 0; x < band.width; x++) {
      const i = ((band.y + y) * w + band.x + x) * channels;
      inside[bin(data[i], data[i + 1], data[i + 2])]++;
      total++;
    }
  const out = new Uint8Array(band.width * band.height);
  for (let y = 0; y < band.height; y++)
    for (let x = 0; x < band.width; x++) {
      const i = ((band.y + y) * w + band.x + x) * channels,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 60) continue;
      const k = bin(r, g, b),
        density = inside[k] / Math.max(1, total);
      if (density > 3e-4 && density > 12 * plate[k]) out[y * band.width + x] = 1;
    }
  return out;
}

/** Vote that ignores a pixel in frames where something covers it. A title partly behind a moving
 * athlete is assembled from the frames in which each part is exposed. `known` marks pixels
 * observed in enough frames to decide either way. */
export function exposedVote(frames: InkSample[], share = 0.4) {
  const n = frames[0]?.mask.length ?? 0,
    seen = new Uint16Array(n),
    hits = new Uint16Array(n),
    ink = new Uint8Array(n),
    known = new Uint8Array(n);
  for (const f of frames)
    for (let i = 0; i < n; i++) {
      if (f.person?.[i] || f.label?.[i]) continue;
      seen[i]++;
      hits[i] += f.mask[i];
    }
  const need = Math.max(2, Math.ceil(frames.length * 0.15));
  let hidden = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i] < Math.min(need, frames.length)) {
      hidden++;
      continue;
    }
    known[i] = 1;
    if (hits[i] >= seen[i] * share) ink[i] = 1;
  }
  return { ink, known: hidden ? known : undefined };
}

/** Whether lettering passes in front of or behind a person. For each frame where the person
 * covers part of the expected lettering, compare how much of that part is still visible with
 * how much of the rest is. Lettering in front survives inside the contour; lettering behind
 * disappears there while remaining outside it. */
export function lettingDepth(frames: InkSample[], expected: Uint8Array) {
  let total = 0;
  for (let i = 0; i < expected.length; i++) total += expected[i];
  const observations: { timeMs: number; insideRetention: number; outsideRetention: number }[] = [];
  for (const f of frames) {
    if (!f.person) continue;
    let inside = 0,
      insideKept = 0,
      outside = 0,
      outsideKept = 0;
    for (let i = 0; i < expected.length; i++) {
      if (!expected[i] || f.label?.[i]) continue;
      if (f.person[i]) {
        inside++;
        insideKept += f.mask[i];
      } else {
        outside++;
        outsideKept += f.mask[i];
      }
    }
    if (inside < Math.max(20, total * 0.03) || outside < 20) continue;
    observations.push({
      timeMs: f.timeMs,
      insideRetention: insideKept / inside,
      outsideRetention: outsideKept / outside,
    });
  }
  const mid = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
  const inside = mid(observations.map((o) => o.insideRetention)),
    outside = mid(observations.map((o) => o.outsideRetention));
  const relation: "front" | "behind" | "unknown" =
    observations.length < 3 || outside < 0.5
      ? "unknown"
      : inside < 0.25 && inside < outside * 0.4
        ? "behind"
        : inside > outside * 0.6
          ? "front"
          : "unknown";
  return { relation, observations: observations.slice(0, 128) };
}

/** Band pixels inside a person contour (normalized frame coordinates), widened by `pad` pixels
 * on each side: the measured outline is low resolution. */
export function personCover(points: readonly (readonly number[])[], band: InkBand, w: number, h: number, pad: number) {
  const out = new Uint8Array(band.width * band.height);
  for (let y = 0; y < band.height; y++) {
    const py = (band.y + y) / h,
      xs: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (a[1] > py !== b[1] > py) xs.push(((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.floor(xs[k] * w) - band.x - pad),
        x1 = Math.min(band.width, Math.ceil(xs[k + 1] * w) - band.x + pad);
      if (x1 > x0) out.fill(1, y * band.width + x0, y * band.width + x1);
    }
  }
  return out;
}

type Box = { x: number; y: number; width: number; height: number };

/** Baseline angle of lettering in degrees clockwise, from straight lines fitted to the lowest
 * and highest ink of each column. Outlying columns (descenders, accents, swashes) are dropped
 * before the final fit. Returns 0 unless both edges agree on the angle. */
export function baselineAngle(mask: Uint8Array, width: number, box: Box) {
  const lower: [number, number][] = [],
    upper: [number, number][] = [];
  for (let x = box.x; x < box.x + box.width; x++) {
    let top = -1,
      bottom = -1;
    for (let y = box.y; y < box.y + box.height; y++)
      if (mask[y * width + x]) {
        if (top < 0) top = y;
        bottom = y;
      }
    if (top >= 0) {
      upper.push([x, top]);
      lower.push([x, bottom]);
    }
  }
  const fit = (points: [number, number][]) => {
    let kept = points;
    let slope = 0;
    for (let pass = 0; pass < 3 && kept.length >= 8; pass++) {
      const mx = kept.reduce((t, p) => t + p[0], 0) / kept.length,
        my = kept.reduce((t, p) => t + p[1], 0) / kept.length;
      let sxy = 0,
        sxx = 0;
      for (const [x, y] of kept) {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) ** 2;
      }
      slope = sxy / Math.max(1, sxx);
      const residual = kept.map(([x, y]) => Math.abs(y - (my + slope * (x - mx))));
      const limit = [...residual].sort((a, b) => a - b)[Math.floor(residual.length * 0.7)];
      kept = kept.filter((_, i) => residual[i] <= limit);
    }
    return (Math.atan(slope) * 180) / Math.PI;
  };
  if (lower.length < 12) return 0;
  const a = fit(lower),
    b = fit(upper);
  return Math.abs(a - b) <= 2.5 ? (a + b) / 2 : 0;
}

/** Turn a band-sized mask by -degrees about a point, so lettering set at an angle reads level. */
export function levelMask(mask: Uint8Array, width: number, height: number, degrees: number, cx: number, cy: number) {
  const out = new Uint8Array(mask.length),
    r = (degrees * Math.PI) / 180,
    cos = Math.cos(r),
    sin = Math.sin(r);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Sample the source where this level pixel came from.
      const dx = x - cx,
        dy = y - cy,
        sx = Math.round(cx + dx * cos - dy * sin),
        sy = Math.round(cy + dx * sin + dy * cos);
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) out[y * width + x] = mask[sy * width + sx];
    }
  return out;
}

/** Drop top and bottom rows that hold only specks; the letters' own rows remain. */
export function trimRows(mask: Uint8Array, width: number, box: Box): Box {
  const rows: number[] = [];
  for (let y = box.y; y < box.y + box.height; y++) {
    let n = 0;
    for (let x = box.x; x < box.x + box.width; x++) n += mask[y * width + x];
    rows.push(n);
  }
  const floor = Math.max(1, Math.max(...rows) * 0.04);
  let top = 0,
    bottom = rows.length - 1;
  while (top < bottom && rows[top] < floor) top++;
  while (bottom > top && rows[bottom] < floor) bottom--;
  return { x: box.x, y: box.y + top, width: box.width, height: bottom - top + 1 };
}

/** Widen a box through columns that were never observed (a recurring label, a person who never
 * moved away): the lettering may continue under them. Stops at observed columns without ink. */
export function extendIntoHidden(mask: Uint8Array, known: Uint8Array, width: number, box: Box): Box {
  const hidden = (x: number) => {
    let unseen = 0,
      ink = 0;
    for (let y = box.y; y < box.y + box.height; y++) {
      unseen += 1 - known[y * width + x];
      ink += mask[y * width + x];
    }
    return { unseen: unseen >= box.height * 0.3, ink: ink > 0 };
  };
  let left = box.x,
    right = box.x + box.width - 1;
  if (right + 1 < width && hidden(right + 1).unseen)
    while (right + 1 < width) {
      const h = hidden(right + 1);
      if (!h.unseen && !h.ink) break;
      right++;
    }
  if (left > 0 && hidden(left - 1).unseen)
    while (left > 0) {
      const h = hidden(left - 1);
      if (!h.unseen && !h.ink) break;
      left--;
    }
  return { x: left, y: box.y, width: right - left + 1, height: box.height };
}
