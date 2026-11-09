import type { AnimatedProperty, Clip, Keyframe } from "../project-schema";

export const properties: Record<
  AnimatedProperty,
  {
    label: string;
    group: "transform" | "effects" | "crop" | "text" | "audio";
    min: number;
    max: number;
    step: number;
  }
> = {
  tracking: {label:"Tracking",group:"text",min:-10,max:100,step:0.5},
  reveal: {label:"Text reveal",group:"text",min:0,max:1,step:0.01},
  highlight: {label:"Highlighted word",group:"text",min:-1,max:10000,step:1},
  gain: { label: "Gain (dB)", group: "audio", min: -60, max: 12, step: 0.5 },
  x: {
    label: "Position X",
    group: "transform",
    min: -32768,
    max: 32768,
    step: 1,
  },
  y: {
    label: "Position Y",
    group: "transform",
    min: -32768,
    max: 32768,
    step: 1,
  },
  scale: { label: "Scale", group: "transform", min: 0.01, max: 10, step: 0.01 },
  scaleX: {
    label: "Scale X",
    group: "transform",
    min: 0.01,
    max: 10,
    step: 0.01,
  },
  scaleY: {
    label: "Scale Y",
    group: "transform",
    min: 0.01,
    max: 10,
    step: 0.01,
  },
  rotation: {
    label: "Rotation",
    group: "transform",
    min: -36000,
    max: 36000,
    step: 1,
  },
  anchorX: {
    label: "Anchor X",
    group: "transform",
    min: -32768,
    max: 32768,
    step: 1,
  },
  anchorY: {
    label: "Anchor Y",
    group: "transform",
    min: -32768,
    max: 32768,
    step: 1,
  },
  opacity: { label: "Opacity", group: "transform", min: 0, max: 1, step: 0.01 },
  blur: {
    label: "Gaussian blur",
    group: "effects",
    min: 0,
    max: 100,
    step: 0.5,
  },
  brightness: {
    label: "Brightness",
    group: "effects",
    min: 0,
    max: 3,
    step: 0.05,
  },
  contrast: { label: "Contrast", group: "effects", min: 0, max: 3, step: 0.05 },
  saturation: {
    label: "Saturation",
    group: "effects",
    min: 0,
    max: 3,
    step: 0.05,
  },
  cropLeft: { label: "Crop left", group: "crop", min: 0, max: 1, step: 0.01 },
  cropTop: { label: "Crop top", group: "crop", min: 0, max: 1, step: 0.01 },
  cropRight: { label: "Crop right", group: "crop", min: 0, max: 1, step: 0.01 },
  cropBottom: {
    label: "Crop bottom",
    group: "crop",
    min: 0,
    max: 1,
    step: 0.01,
  },
};
export const propertyNames = Object.keys(properties) as AnimatedProperty[];
export function clampValue(key: AnimatedProperty, value: number) {
  const { min, max } = properties[key];
  return Math.max(min, Math.min(max, value));
}
export function baseValue(clip: Clip, key: AnimatedProperty): number {
  if (key === "gain") return clip.gain;
  const group = clip[
    properties[key].group as "transform" | "effects" | "crop" | "text"
  ] as Record<string, number>;
  return group?.[key] ?? (key.startsWith("scale") ? 1 : 0);
}
export function writeBase(clip: Clip, key: AnimatedProperty, value: number) {
  if (key === "gain") {
    clip.gain = clampValue(key, value);
    return;
  }
  (
    clip[properties[key].group as "transform" | "effects" | "crop" | "text"] as Record<
      string,
      number
    >
  )[key] = clampValue(key, value);
}

const sortedCache = new WeakMap<Keyframe[], Keyframe[]>();
export const animationMetrics = { evaluations: 0, sortedCacheHits: 0 };
export function sortedKeys(keys: Keyframe[]) {
  const cached = sortedCache.get(keys);
  if (cached) {
    animationMetrics.sortedCacheHits++;
    return cached;
  }
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  // Drafts and mutable caller arrays must never reuse stale key ordering.
  if (Object.isFrozen(keys)) sortedCache.set(keys, sorted);
  return sorted;
}
function slope(keys: Keyframe[], i: number) {
  if (!i || i === keys.length - 1) return 0;
  const a = keys[i - 1],
    b = keys[i],
    c = keys[i + 1];
  const left = (b.value - a.value) / (b.frame - a.frame),
    right = (c.value - b.value) / (c.frame - b.frame);
  if (left * right <= 0) return 0;
  const h0 = b.frame - a.frame,
    h1 = c.frame - b.frame,
    w0 = 2 * h1 + h0,
    w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / left + w1 / right);
}
/** Handle x is a fraction of its adjacent segment; y is a signed value offset. */
export function segmentHandles(keys: Keyframe[], left: number) {
  const a = keys[left],
    b = keys[left + 1],
    dt = b.frame - a.frame,
    delta = b.value - a.value;
  if (a.easing === "auto-bezier")
    return {
      out: { x: 1 / 3, y: (slope(keys, left) * dt) / 3 },
      in: { x: 1 / 3, y: (-slope(keys, left + 1) * dt) / 3 },
    };
  const out = a.outHandle ?? { x: 1 / 3, y: delta / 3 },
    incoming = b.inHandle ?? { x: 1 / 3, y: -delta / 3 };
  // Ordered x control points guarantee a single-valued time curve.
  const sum = out.x + incoming.x,
    factor = sum > 1 ? 1 / sum : 1;
  return {
    out: { ...out, x: out.x * factor },
    in: { ...incoming, x: incoming.x * factor },
  };
}
const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a +
  3 * (1 - t) ** 2 * t * b +
  3 * (1 - t) * t * t * c +
  t ** 3 * d;
export function evaluate(
  keys: Keyframe[],
  frame: number,
  base: number,
): number {
  animationMetrics.evaluations++;
  if (!keys.length) return base;
  const sorted = sortedKeys(keys);
  if (frame <= sorted[0].frame) return sorted[0].value;
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].frame <= frame) lo = mid + 1;
    else hi = mid;
  }
  if (lo === sorted.length) return sorted[lo - 1].value;
  const a = sorted[lo - 1],
    b = sorted[lo];
  let t = (frame - a.frame) / (b.frame - a.frame);
  if (a.easing === "hold") return a.value;
  if (a.easing === "ease-in") t = t ** 3;
  else if (a.easing === "ease-out") t = 1 - (1 - t) ** 3;
  else if (a.easing === "ease-in-out") t = t * t * (3 - 2 * t);
  else if (a.easing.includes("bezier")) {
    const h = segmentHandles(sorted, lo - 1);
    let low = 0,
      high = 1;
    for (let i = 0; i < 32; i++) {
      const m = (low + high) / 2;
      if (cubic(0, h.out.x, 1 - h.in.x, 1, m) < t) low = m;
      else high = m;
    }
    return cubic(
      a.value,
      a.value + h.out.y,
      b.value + h.in.y,
      b.value,
      (low + high) / 2,
    );
  }
  return a.value + (b.value - a.value) * t;
}
/** Signed value units per second. Hold discontinuities have no finite velocity. */
export function speed(
  keys: Keyframe[],
  frame: number,
  base: number,
  fps: number,
) {
  const sorted = sortedKeys(keys);
  if (
    !sorted.length ||
    frame <= sorted[0].frame ||
    frame >= sorted.at(-1)!.frame
  )
    return 0;
  let i = 0;
  while (i + 1 < sorted.length && sorted[i + 1].frame <= frame) i++;
  if (sorted[i].easing === "hold") return 0;
  const epsilon = Math.min(
    0.001,
    (frame - sorted[i].frame) / 2 || 0.001,
    (sorted[i + 1].frame - frame) / 2,
  );
  return (
    ((evaluate(keys, frame + epsilon, base) -
      evaluate(keys, frame - epsilon, base)) /
      (2 * epsilon)) *
    fps
  );
}
export function propertyValue(
  clip: Clip,
  key: AnimatedProperty,
  frame: number,
) {
  return clampValue(
    key,
    evaluate(
      clip.keyframes[key] ?? [],
      frame - clip.start,
      baseValue(clip, key),
    ),
  );
}
/** Shared by the GPU, CPU fallback, monitor transforms, and frame exporter. */
export function resolveClip(clip: Clip, frame: number): Clip {
  const resolved = {
    ...clip,
    transform: { ...clip.transform },
    effects: { ...clip.effects },
    crop: { ...clip.crop },
    text: { ...clip.text },
  };
  for (const key of propertyNames)
    writeBase(resolved, key, propertyValue(clip, key, frame));
  return resolved;
}
export function animated(clip: Clip, frame: number) {
  return resolveClip(clip, frame).transform;
}
