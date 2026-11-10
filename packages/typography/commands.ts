import { z } from "zod";
import { type Edit, editable } from "../commands";
import { newClip, newTrack, fps } from "../project-schema";
import { typographyStyles, textTreatments } from "./model";
import {
  animateText,
  styleText,
  profiles,
  fitTextVertically,
} from "./treatments";
const frame = z.number().int().nonnegative().max(2e9);
export const typographyCommandSchema = z
  .object({
    tool: z.literal("text.create"),
    id: z.string().min(1).max(128),
    trackId: z.string().min(1).max(128),
    content: z.string().trim().min(1).max(500),
    start: frame,
    duration: frame.min(4),
    style: z.enum(typographyStyles),
    treatment: z.enum(textTreatments),
    wordStarts: z.array(frame).max(256).optional(),
    timing: z.enum([
      "transcript",
      "music-event",
      "energy-change",
      "shot-boundary",
      "speed-ramp",
      "hook",
      "manual",
    ]),
    cueFrame: frame.optional(),
    maxFontSize: z.number().finite().min(6).max(1000).optional(),
    y: z.number().finite().min(-32768).max(32768).optional(),
  })
  .strict();
export function createTypography(
  input: z.infer<typeof typographyCommandSchema>,
): Edit {
  const call = typographyCommandSchema.parse(input);
  return (p) => {
    if (p.clips.some((c) => c.id === call.id))
      throw new Error("Text layer already exists");
    if (
      call.wordStarts?.some(
        (f, i, a) => f >= call.duration || (i > 0 && f <= a[i - 1]),
      )
    )
      throw new Error("Invalid word timing");
    let track = p.tracks.find((t) => t.id === call.trackId);
    if (track?.locked || track?.kind === "audio")
      throw new Error("Choose an unlocked video track");
    if (!track) {
      track = newTrack("video", p.tracks.length + 1);
      track.id = call.trackId;
      track.name = `${call.style} typography`;
      p.tracks.unshift(track);
    }
    const c = newClip(track.id, call.start, call.duration, "text");
    c.id = call.id;
    c.name = call.content;
    c.text.content = call.content;
    if (call.wordStarts) c.text.wordStarts = [...call.wordStarts];
    styleText(
      c,
      call.style,
      p.settings.width,
      p.settings.height,
      call.treatment,
    );
    if (call.maxFontSize !== undefined) c.text.size=Math.min(c.text.size,call.maxFontSize);
    if (call.y !== undefined) c.transform.y = call.y;
    fitTextVertically(c, p.settings.width, p.settings.height);
    animateText(c, call.treatment, fps(p), call.wordStarts);
    if (call.cueFrame !== undefined) {
      if (call.cueFrame >= c.duration)
        throw new Error("Text cue is outside the layer");
      const last = Math.max(0, c.text.content.trim().split(/\s+/).length - 1);
      const cue = call.cueFrame;
      const accent = (before: number, after: number) => [
        ...(cue > 0
          ? [{ frame: 0, value: before, easing: "hold" as const }]
          : []),
        { frame: cue, value: after, easing: "hold" as const },
      ];
      c.keyframes.highlight = accent(-1, last);
      if (["Punch", "Impact Word"].includes(call.treatment)) {
        c.text.revealUnit = "words";
        c.keyframes.reveal = accent(last / (last + 1), 1);
      }
    }
    p.clips.push(c);
  };
}
export function applyTextPreset(
  id: string,
  style: (typeof typographyStyles)[number],
  treatment: (typeof textTreatments)[number],
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c || c.kind !== "text") throw new Error("Select a text layer");
    styleText(c, style, p.settings.width, p.settings.height, treatment);
    const starts =
      c.text.wordStarts?.length &&
      c.keyframes.highlight.length === c.text.wordStarts.length &&
      c.keyframes.highlight.every((k, i) => k.value === i)
        ? c.keyframes.highlight.map((k) => k.frame)
        : c.text.wordStarts;
    if (
      starts?.some((f) => f >= c.duration) ||
      (starts && starts.length !== c.text.content.trim().split(/\s+/).length)
    )
      throw new Error(
        "The edited words or duration no longer match the timed transcript",
      );
    animateText(c, treatment, fps(p), starts);
  };
}
export { profiles };
