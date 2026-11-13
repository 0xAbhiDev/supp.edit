import { z } from "zod";
import { newClip, newTrack, type Clip } from "../project-schema";
import { editable, type Edit } from "./index";
import { tryMotionTransition } from "./motion-transition";

const id = z.string().min(1).max(128);
export const referenceTransitionSchema = z
  .object({
    tool: z.literal("sequence.transition"),
    sequenceId: id,
    id: id.max(118),
    trackId: id,
    leftId: id,
    rightId: id,
    kind: z.enum(["flash", "blur", "zoom", "whip", "motion"]),
    direction: z.enum(["left", "right", "up", "down"]).optional(),
    zoomDirection: z.enum(["in", "out"]).optional(),
    protection: z
      .array(
        z
          .object({
            clipId: id,
            bounds: z
              .object({
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                width: z.number().positive().max(1),
                height: z.number().positive().max(1),
              })
              .strict()
              .refine(
                (b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001,
              ),
          })
          .strict(),
      )
      .max(128)
      .optional(),
    before: z.number().int().min(1).max(120),
    after: z.number().int().min(2).max(120),
    strength: z.number().finite().min(0.05).max(1),
  })
  .strict();

/** Ordinary animated shapes/effect stacks, never baked frames or source replacements. */
function blurTransition(
  left: Clip,
  right: Clip,
  before: number,
  after: number,
  strength: number,
  id: string,
) {
  for (const [clip, incoming] of [
    [left, false],
    [right, true],
  ] as const) {
    const effectId = id + (incoming ? "-right" : "-left");
    if (clip.effectStack.some((e) => e.id === effectId))
      throw Error("Transition effect already exists");
    if (clip.duration < 2)
      throw Error("Blur transition needs at least two frames per shot");
    const peak = strength * 32;
    const keys = incoming
      ? [
          { frame: 0, value: peak, easing: "ease-out" as const },
          { frame: after - 1, value: 0, easing: "linear" as const },
        ]
      : [
          {
            frame: Math.max(0, clip.duration - before - 1),
            value: 0,
            easing: "ease-in" as const,
          },
          { frame: clip.duration - 1, value: peak, easing: "linear" as const },
        ];
    clip.effectStack.push({
      id: effectId,
      type: "blur",
      enabled: true,
      value: 0,
      keys,
    });
  }
}

export function addReferenceTransition(
  input: z.infer<typeof referenceTransitionSchema>,
): Edit {
  const call = referenceTransitionSchema.parse(input);
  return (p) => {
    const left = editable(p, call.leftId),
      right = editable(p, call.rightId);
    if (
      !left ||
      !right ||
      left.kind !== "media" ||
      right.kind !== "media" ||
      left.trackId !== right.trackId ||
      left.start + left.duration !== right.start ||
      p.tracks.find((t) => t.id === left.trackId)?.kind !== "video"
    )
      throw Error("A transition requires adjacent unlocked video clips");
    if (call.before > left.duration || call.after > right.duration)
      throw Error("Transition exceeds its adjacent clips");
    if (p.clips.some((c) => c.id === call.id))
      throw Error("Transition layer already exists");
    if (
      call.kind === "zoom" ||
      call.kind === "whip" ||
      call.kind === "motion"
    ) {
      const moved = tryMotionTransition(p, left, right, {
        ...call,
        kind: call.kind,
      });
      blurTransition(
        left,
        right,
        call.before,
        call.after,
        moved ? Math.max(0.05, call.strength * 0.18) : call.strength,
        call.id + (moved ? "-a" : "-f"),
      );
      return;
    }
    if (call.kind === "blur") {
      blurTransition(
        left,
        right,
        call.before,
        call.after,
        call.strength,
        call.id,
      );
      return;
    }
    let track = p.tracks.find((t) => t.id === call.trackId);
    if (track?.locked || track?.kind === "audio" || track?.id === left.trackId)
      throw Error("Choose a separate unlocked video track for transitions");
    const sourceOrder = p.tracks.findIndex((t) => t.id === left.trackId);
    if (track && p.tracks.indexOf(track) >= sourceOrder)
      throw Error("Transition track must be above its source clips");
    if (!track) {
      track = {
        ...newTrack("video", p.tracks.length + 1),
        id: call.trackId,
        name: "Reference transitions",
      };
      p.tracks.splice(sourceOrder, 0, track);
    }
    const c = newClip(
      track.id,
      right.start - call.before,
      call.before + call.after,
      "shape",
    );
    c.id = call.id;
    c.name = "Exposure flash";
    const keys = [
      { frame: 0, value: 0, easing: "ease-in" as const },
      { frame: call.before, value: call.strength, easing: "ease-out" as const },
      { frame: c.duration - 1, value: 0, easing: "linear" as const },
    ];
    c.shape = {
      type: "rectangle",
      color: "#ffffff",
      width: p.settings.width,
      height: p.settings.height,
    };
    c.keyframes.opacity = keys;
    p.clips.push(c);
  };
}
