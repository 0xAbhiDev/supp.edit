import { z } from "zod";
import { newClip, newTrack } from "../project-schema";
import { editable, type Edit } from "./index";

const id = z.string().min(1).max(118);
const ink = z.string().regex(/^#[0-9a-f]{6}$/i);
export const colorPulseSchema = z
  .object({
    tool: z.literal("sequence.colorPulse"),
    sequenceId: id,
    id,
    sourceId: id,
    trackId: id,
    start: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
    shadows: ink,
    highlights: ink,
  })
  .strict();

/** Map source shadows to the bright reference ink and highlights to the dark ink. */
export function addColorPulse(input: z.infer<typeof colorPulseSchema>): Edit {
  const call = colorPulseSchema.parse(input);
  return (p) => {
    const source = editable(p, call.sourceId);
    if (
      !source ||
      source.kind !== "media" ||
      !p.assets.some((a) => a.id === source.assetId && a.kind === "video") ||
      call.start < source.start ||
      call.start + call.duration > source.start + source.duration
    )
      throw Error(
        "Color pulse needs an unlocked video covering the entire interval",
      );
    const sourceOrder = p.tracks.findIndex((t) => t.id === source.trackId);
    let track = p.tracks.find((t) => t.id === call.trackId);
    if (
      track &&
      (track.locked ||
        track.kind !== "video" ||
        p.tracks.indexOf(track) >= sourceOrder)
    )
      throw Error(
        "Place the color pulse on an unlocked video track above its source",
      );
    if (!track) {
      track = {
        ...newTrack("video", p.tracks.length + 1),
        id: call.trackId,
        name: "Color pulses",
      };
      p.tracks.splice(sourceOrder, 0, track);
    }
    // Each ink has its own track to preserve explicit draw order after manual edits.
    const topId = call.trackId + "-ink";
    let top = p.tracks.find((t) => t.id === topId);
    if (
      top &&
      (top.kind !== "video" ||
        top.locked ||
        p.tracks.indexOf(top) >= p.tracks.indexOf(track))
    )
      throw Error("Color pulse ink track is locked or below its base");
    if (!top) {
      top = {
        ...newTrack("video", p.tracks.length + 1),
        id: topId,
        name: "Color pulse highlights",
      };
      p.tracks.splice(p.tracks.indexOf(track), 0, top);
    }
    if (p.clips.some((c) => c.id === call.id || c.id === call.id + "-ink"))
      throw Error("Color pulse already exists");
    const shape = (
      trackId: string,
      layerId: string,
      name: string,
      color: string,
    ) => {
      const clip = newClip(trackId, call.start, call.duration, "shape");
      clip.id = layerId;
      clip.name = name;
      clip.shape = {
        type: "rectangle",
        color,
        width: p.settings.width,
        height: p.settings.height,
      };
      return clip;
    };
    const base = shape(
      track.id,
      call.id,
      "Negative pulse · bright ink",
      call.highlights,
    );
    const ink = shape(
      top.id,
      call.id + "-ink",
      "Negative pulse · dark ink",
      call.shadows,
    );
    ink.matte = { layerId: source.id, mode: "luma", keepSourceVisible: true };
    p.clips.push(base, ink);
  };
}
