import {
  type Bounds,
  type SubjectSamples,
  type ReframeMode,
  type SubjectChoice,
  subjectSamplesSchema,
} from "./model";
import type { Keyframe } from "../../project-schema";
type Person = SubjectSamples["samples"][number]["people"][number];
const cx = (b: Bounds) => b.x + b.width / 2,
  cy = (b: Bounds) => b.y + b.height / 2;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v)) || 0;
function overlap(a: Bounds, b: Bounds) {
  const intersection =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (
    intersection / (a.width * a.height + b.width * b.height - intersection)
  );
}
const salience = (p: Person) =>
  (p.confidence * Math.sqrt(p.bounds.width * p.bounds.height)) /
  (1 + Math.hypot(cx(p.bounds) - 0.5, cy(p.bounds) - 0.5));
function union(boxes: Bounds[]): Bounds {
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
/** Associates geometry with prior subjects. Missing detections hold position, never select a bystander. */
export function associate(input: SubjectSamples, choice: SubjectChoice) {
  const data = subjectSamplesSchema.parse(input);
  let tracks: Person[] = [],
    lastSeen = 0,
    missed = 0;
  const out: { timeMs: number; box: Bounds }[] = [];
  for (const sample of data.samples) {
    const people = sample.people.filter(
      (p) => p.confidence >= 0.45 && p.bounds.width * p.bounds.height >= 0.008,
    );
    if (!tracks.length) {
      const ranked = [...people].sort((a, b) =>
        choice === "white-shirt"
          ? b.whiteTorsoFraction - a.whiteTorsoFraction
          : salience(b) - salience(a),
      );
      if (
        choice === "white-shirt" &&
        (!ranked.length ||
          ranked[0].whiteTorsoFraction < 0.35 ||
          (ranked[1] &&
            ranked[0].whiteTorsoFraction - ranked[1].whiteTorsoFraction < 0.12))
      )
        continue;
      if (ranked.length < (choice === "both" ? 2 : 1)) continue;
      tracks = ranked.slice(0, choice === "both" ? 2 : 1);
      lastSeen = sample.timeMs;
    } else {
      const used = new Set<Person>();
      let matched = 0;
      tracks = tracks.map((previous) => {
        const ranked = people
          .filter((p) => !used.has(p))
          .map((p) => ({
            p,
            iou: overlap(previous.bounds, p.bounds),
            distance: Math.hypot(
              cx(previous.bounds) - cx(p.bounds),
              cy(previous.bounds) - cy(p.bounds),
            ),
            size: Math.abs(
              Math.log(
                (p.bounds.width * p.bounds.height) /
                  (previous.bounds.width * previous.bounds.height),
              ),
            ),
          }))
          .filter(
            (x) =>
              (x.iou > 0.1 || x.distance < 0.16) &&
              x.size < 1.1 &&
              (choice !== "white-shirt" ||
                Math.abs(x.p.whiteTorsoFraction - previous.whiteTorsoFraction) <
                  0.45),
          )
          .sort(
            (a, b) =>
              b.iou -
              b.distance * 0.8 -
              b.size * 0.15 -
              (a.iou - a.distance * 0.8 - a.size * 0.15),
          );
        if (!ranked.length) return previous;
        used.add(ranked[0].p);
        matched++;
        return ranked[0].p;
      });
      if (matched === tracks.length) lastSeen = sample.timeMs;
      else missed++;
    }
    out.push({
      timeMs: sample.timeMs,
      box: union(tracks.map((t) => t.bounds)),
    });
    if (sample.timeMs - lastSeen > 1000) missed++;
  }
  if (!out.length)
    throw Error(
      choice === "white-shirt"
        ? "No unambiguous bright neutral torso was measured. Choose the main subject or adjust framing manually."
        : choice === "both"
          ? "Two people were not detected together in this range."
          : "No confident person detections in this range; set framing manually.",
    );
  return { samples: out, uncertain: missed > 0 };
}
/** Reduce linear keys against the actual per-frame path, bounded by an explicit pixel tolerance. */
export function reduceKeys(values: number[], tolerance: number): Keyframe[] {
  const keep = new Set([0, values.length - 1]),
    stack = [[0, values.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let error = tolerance,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(
        values[i] - (values[a] + ((values[b] - values[a]) * (i - a)) / (b - a)),
      );
      if (d > error) {
        error = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep.add(index);
      stack.push([a, index], [index, b]);
    }
  }
  return [...keep]
    .sort((a, b) => a - b)
    .map((frame) => ({ frame, value: values[frame], easing: "linear" }));
}
export function cameraPath(
  input: SubjectSamples,
  rate: number,
  duration: number,
  width: number,
  height: number,
  mode: ReframeMode = "smooth",
  choice: SubjectChoice = "main",
) {
  if (
    !Number.isFinite(rate) ||
    rate < 1 ||
    rate > 120 ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 36000
  )
    throw Error("Invalid reframe duration or frame rate");
  const track = associate(input, choice),
    samples = track.samples;
  const contain = Math.min(width / input.width, height / input.height),
    cover = Math.max(width / input.width, height / input.height);
  // One conservative scale per shot prevents breathing. Wide subjects/groups may require letterboxing.
  const locked = union(samples.map((s) => s.box));
  const maxWidth =
      mode === "locked"
        ? locked.width
        : Math.max(...samples.map((s) => s.box.width)),
    maxHeight =
      mode === "locked"
        ? locked.height
        : Math.max(...samples.map((s) => s.box.height));
  const scale = clamp(
    Math.min(
      cover,
      (width * 0.86) / (maxWidth * input.width),
      (height * 0.8) / (maxHeight * input.height),
    ) / contain,
    1,
    10,
  );
  const sw = input.width * contain * scale,
    sh = input.height * contain * scale;
  const edgeX = Math.max(0, (sw - width) / 2),
    edgeY = Math.max(0, (sh - height) / 2);
  const x: number[] = [],
    y: number[] = [];
  let index = 0,
    lastX = 0,
    lastY = 0;
  for (let frame = 0; frame < duration; frame++) {
    const time = input.sampling.startMs + (frame * 1000) / rate;
    while (index + 1 < samples.length && samples[index + 1].timeMs <= time)
      index++;
    const a = samples[index],
      b = samples[Math.min(index + 1, samples.length - 1)],
      t = a === b ? 0 : clamp((time - a.timeMs) / (b.timeMs - a.timeMs), 0, 1);
    const box =
      mode === "locked"
        ? locked
        : {
            x: a.box.x + (b.box.x - a.box.x) * t,
            y: a.box.y + (b.box.y - a.box.y) * t,
            width: a.box.width + (b.box.width - a.box.width) * t,
            height: a.box.height + (b.box.height - a.box.height) * t,
          };
    let tx = clamp((0.5 - cx(box)) * sw, -edgeX, edgeX),
      ty = clamp((0.5 - cy(box)) * sh, -edgeY, edgeY);
    if (frame && mode !== "locked") {
      const alpha =
          1 - Math.exp(-1 / (rate * (mode === "responsive" ? 0.12 : 0.4))),
        dead = mode === "responsive" ? 0.008 : 0.025;
      tx =
        Math.abs(tx - lastX) < width * dead
          ? lastX
          : lastX + (tx - lastX) * alpha;
      ty =
        Math.abs(ty - lastY) < height * dead
          ? lastY
          : lastY + (ty - lastY) * alpha;
      // Keep the measured bounding box inside a small safe margin when geometry permits it.
      const lx = width * 0.04 - width / 2 + sw * (0.5 - box.x),
        hx = width * 0.96 - width / 2 + sw * (0.5 - box.x - box.width);
      const ly = height * 0.08 - height / 2 + sh * (0.5 - box.y),
        hy = height * 0.92 - height / 2 + sh * (0.5 - box.y - box.height);
      if (lx <= hx) tx = clamp(tx, Math.max(-edgeX, lx), Math.min(edgeX, hx));
      if (ly <= hy) ty = clamp(ty, Math.max(-edgeY, ly), Math.min(edgeY, hy));
    }
    x.push((lastX = clamp(tx, -edgeX, edgeX)));
    y.push((lastY = clamp(ty, -edgeY, edgeY)));
  }
  return {
    x: reduceKeys(x, Math.max(0.15, width * 0.002)),
    y: reduceKeys(y, Math.max(0.15, height * 0.002)),
    scale: [{ frame: 0, value: scale, easing: "linear" as const }],
    uncertain: track.uncertain,
    letterbox: sw < width - 0.1 || sh < height - 0.1,
  };
}
