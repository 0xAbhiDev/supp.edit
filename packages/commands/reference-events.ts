/** Editable reference audio events. An event is a sequence marker; the layers it drives are
 * recorded in the sequence's AI metadata. Moving an event can move its linked layers with it:
 * a linked cut is rolled (the edit point moves, the footage on either side stays in sync), a
 * linked title, pulse or flash is moved without changing its length or animation. */
import { z } from "zod";
import { assetSchema } from "../project-schema";
import { inComposition } from "./compositions";
import { rollEdit } from "./nle";
import type { Edit } from "./index";
import { newClip, newTrack } from "../project-schema";

export const assetAddSchema = z.object({ tool: z.literal("asset.add"), asset: assetSchema }).strict();
/** Add a media asset to the project library unless the same file is already there. */
export function addAsset(input: z.infer<typeof assetAddSchema>): Edit {
  const { asset } = assetAddSchema.parse(input);
  return (p) => {
    const existing = p.assets.find((a) => a.id === asset.id);
    if (existing) {
      if (existing.fingerprint !== asset.fingerprint) throw Error("A different file already uses this asset ID.");
      return;
    }
    p.assets.push(structuredClone(asset));
  };
}

export const moveEventSchema = z
  .object({
    tool: z.literal("sequence.moveEvent"),
    sequenceId: z.string().min(1).max(128),
    markerId: z.string().min(1).max(128),
    frames: z.number().int().min(-100000).max(100000),
    linked: z.boolean(),
  })
  .strict();
export function moveEvent(input: z.infer<typeof moveEventSchema>): Edit {
  const call = moveEventSchema.parse(input);
  return (p) => {
    const c = p.compositions.find((c) => c.id === call.sequenceId);
    if (!c) throw Error("Sequence no longer exists");
    const marker = c.markers?.find((m) => m.id === call.markerId);
    if (!marker) throw Error("The audio event marker no longer exists");
    const frame = marker.frame + call.frames;
    if (frame < 0 || frame >= c.duration) throw Error("The event would move outside the sequence");
    marker.frame = frame;
    if (!call.linked || !call.frames) return;
    const event = c.ai?.referenceEvents?.find((e) => e.markerId === call.markerId);
    for (const link of event?.links ?? []) {
      const layer = c.layers.find((l) => l.id === link.layerId);
      if (!layer) continue;
      if (link.visual === "cut" && layer.kind === "media") {
        inComposition(c.id, rollEdit(layer.id, "in", layer.start + call.frames))(p);
        continue;
      }
      // A generated layer and its companions (the ink of a pulse, the blur of a fill) move together.
      for (const part of c.layers.filter((l) => l.id === layer.id || l.id.startsWith(layer.id + "-"))) {
        const start = part.start + call.frames;
        if (start < 0 || start + part.duration > c.duration) throw Error(`"${part.name}" would move outside the sequence`);
        part.start = start;
      }
    }
  };
}

const side = z.number().min(0).max(0.45);
export const letterboxSchema = z
  .object({
    tool: z.literal("sequence.letterbox"),
    sequenceId: z.string().min(1).max(128),
    trackId: z.string().min(1).max(128),
    id: z.string().min(1).max(100),
    start: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
    top: side,
    bottom: side,
    left: side,
    right: side,
  })
  .strict();
/** Black bars where the reference shows no picture, as editable rectangles at the top of the
 * stack. Bars overlap in time, so each gets its own track (`trackId`, then `trackId-<side>`):
 * every editing tool can move, trim or hide one bar without touching the others. */
export function addLetterbox(input: z.infer<typeof letterboxSchema>): Edit {
  const call = letterboxSchema.parse(input);
  return (p) => {
    if (p.clips.some((c) => c.id.startsWith(call.id + "-"))) throw Error("Letterbox already exists.");
    let first = true;
    const trackFor = (side: string) => {
      const id = first ? call.trackId : call.trackId + "-" + side;
      first = false;
      let track = p.tracks.find((t) => t.id === id);
      if (track && (track.locked || track.kind !== "video" || p.clips.some((c) => c.trackId === id && c.start < call.start + call.duration && c.start + c.duration > call.start)))
        throw Error("Choose an empty unlocked video track for the letterbox.");
      if (!track) {
        track = { ...newTrack("video", p.tracks.length + 1), id, name: "Letterbox · " + side };
        p.tracks.unshift(track);
      }
      return track;
    };
    const { width: W, height: H } = p.settings;
    // Whole-pixel bars, offset so each meets its frame edge exactly.
    const t = Math.round(call.top * H),
      b = Math.round(call.bottom * H),
      l = Math.round(call.left * W),
      r = Math.round(call.right * W);
    const bars = [
      ["top", W, t, 0, (t - H) / 2],
      ["bottom", W, b, 0, (H - b) / 2],
      ["left", l, H, (l - W) / 2, 0],
      ["right", r, H, (W - r) / 2, 0],
    ] as const;
    for (const [name, w, h, x, y] of bars) {
      if (w < 1 || h < 1) continue;
      const bar = newClip(trackFor(name).id, call.start, call.duration, "shape");
      bar.id = call.id + "-" + name;
      bar.name = "Letterbox · " + name;
      bar.shape = { type: "rectangle", color: "#000000", width: w, height: h };
      bar.transform.x = x;
      bar.transform.y = y;
      p.clips.push(bar);
    }
  };
}
