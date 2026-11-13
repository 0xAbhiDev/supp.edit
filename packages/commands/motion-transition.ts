import type { Clip, Project } from "../project-schema";
import { newClip } from "../project-schema";
import { inverse, layerTransforms, point } from "../animation/affine";
import { setParent } from "./parenting";

export interface ProtectedRegion {
  clipId: string;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface MotionTransition {
  id: string;
  kind: "zoom" | "whip" | "motion";
  direction?: "left" | "right" | "up" | "down";
  zoomDirection?: "in" | "out";
  before: number;
  after: number;
  strength: number;
  protection?: ProtectedRegion[];
}

/** Compose with existing camera keys and parenting. Unsafe moves leave the graph unchanged. */
export function tryMotionTransition(
  p: Project,
  left: Clip,
  right: Clip,
  call: MotionTransition,
) {
  if (left.duration < 2 || right.duration < 2) return false;
  const originals = [left, right].map((c) => ({
    clip: c,
    parent: c.parentId,
    offset: [...c.parentOffset] as Clip["parentOffset"],
  }));
  const controllers: Clip[] = [];
  for (const [clip, incoming] of [
    [left, false],
    [right, true],
  ] as const) {
    const id = call.id + (incoming ? "-right" : "-left");
    if (p.clips.some((c) => c.id === id))
      throw Error("Transition controller already exists");
    const controller = newClip(clip.trackId, clip.start, clip.duration, "null");
    controller.id = id;
    controller.name =
      (call.kind === "zoom"
        ? "Zoom"
        : call.kind === "whip"
          ? "Whip pan"
          : "Motion bridge") + (incoming ? " · arrival" : " · departure");
    if (clip.parentId) controller.parentId = clip.parentId;
    p.clips.push(controller);
    setParent(clip.id, controller.id, clip.start, true)(p);
    controllers.push(controller);
    const fraction = Math.min(
      call.kind === "motion" ? 0.04 : 0.1,
      0.025 + call.strength * 0.1,
    );
    const horizontal =
      !call.direction || ["left", "right"].includes(call.direction);
    const sign = ["left", "up"].includes(call.direction ?? "left") ? -1 : 1;
    const displacement =
      call.kind === "zoom"
        ? 0
        : fraction *
          (horizontal ? p.settings.width : p.settings.height) *
          sign *
          (incoming ? -1 : 1);
    const scale =
      call.kind === "zoom"
        ? 1 +
          (call.zoomDirection === "out" ? -1 : 1) *
            Math.min(0.24, 0.06 + call.strength * 0.24)
        : 1 + 2 * fraction + 0.01;
    const keys = (base: number, peak: number) =>
      incoming
        ? [
            { frame: 0, value: peak, easing: "linear" as const },
            { frame: call.after - 1, value: base, easing: "linear" as const },
          ]
        : [
            {
              frame: Math.max(0, clip.duration - call.before - 1),
              value: base,
              easing: "linear" as const,
            },
            {
              frame: clip.duration - 1,
              value: peak,
              easing: "linear" as const,
            },
          ];
    controller.keyframes.scale = keys(1, scale);
    if (displacement)
      controller.keyframes[horizontal ? "x" : "y"] = keys(0, displacement);
  }
  let safe = true;
  for (const [clip, incoming] of [
    [left, false],
    [right, true],
  ] as const) {
    const asset = p.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.kind !== "video") {
      safe = false;
      break;
    }
    const fit = Math.min(
      p.settings.width / asset.width,
      p.settings.height / asset.height,
    );
    const halfW = (asset.width * fit) / 2,
      halfH = (asset.height * fit) / 2;
    const first = incoming ? 0 : Math.max(0, clip.duration - call.before - 1);
    const last = incoming ? call.after - 1 : clip.duration - 1;
    for (let local = first; local <= last && safe; local++) {
      const matrix = layerTransforms(p, clip.start + local).world(clip.id),
        inv = inverse(matrix);
      // Source crop and rotation must also cover all four output corners.
      for (const x of [-p.settings.width / 2, p.settings.width / 2])
        for (const y of [-p.settings.height / 2, p.settings.height / 2]) {
          const src = point(inv, x, y);
          if (
            src.x < -halfW + clip.crop.cropLeft * 2 * halfW - 0.5 ||
            src.x > halfW - clip.crop.cropRight * 2 * halfW + 0.5 ||
            src.y < -halfH + clip.crop.cropTop * 2 * halfH - 0.5 ||
            src.y > halfH - clip.crop.cropBottom * 2 * halfH + 0.5
          )
            safe = false;
        }
      for (const region of (call.protection ?? []).filter(
        (r) => r.clipId === clip.id,
      )) {
        const b = region.bounds;
        for (const x of [b.x, b.x + b.width])
          for (const y of [b.y, b.y + b.height]) {
            const world = point(
              matrix,
              (x - 0.5) * 2 * halfW,
              (y - 0.5) * 2 * halfH,
            );
            if (
              Math.abs(world.x) > p.settings.width / 2 - 2 ||
              Math.abs(world.y) > p.settings.height / 2 - 2
            )
              safe = false;
          }
      }
    }
  }
  if (!safe) {
    p.clips = p.clips.filter((c) => !controllers.some((n) => n.id === c.id));
    for (const old of originals) {
      if (old.parent) old.clip.parentId = old.parent;
      else delete old.clip.parentId;
      old.clip.parentOffset = old.offset;
    }
  }
  return safe;
}
