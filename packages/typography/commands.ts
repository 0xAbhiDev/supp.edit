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
    ink: z
      .object({
        foreground: z.string().regex(/^#[0-9a-f]{6}$/i),
        accent: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .nullable(),
        word: z.number().int().nonnegative().max(499),
      })
      .strict()
      .optional(),
    maxFontSize: z.number().finite().min(6).max(1000).optional(),
    // Captured ink centers in composition pixels. Materialize ordinary editable
    // transform keys once so rendering does not depend on the analysis cache.
    differenceInk: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    measuredInk: z
      .object({
        widthEm: z.number().positive().max(256),
        heightEm: z.number().positive().max(4),
        centerXEm: z.number().finite().min(-4).max(4),
        centerYEm: z.number().finite().min(-4).max(4),
        samples: z
          .array(
            z
              .object({
                frame,
                x: z.number().finite().min(-32768).max(32768),
                y: z.number().finite().min(-32768).max(32768),
                width: z.number().positive().max(32768),
                height: z.number().positive().max(32768),
              })
              .strict(),
          )
          .min(1)
          .max(129),
      })
      .strict()
      .optional(),
    face: z
      .object({
        family: z.string().regex(/^[a-zA-Z0-9 ,-]{1,128}$/),
        weight: z.enum(["400", "700", "900"]),
      })
      .strict()
      .optional(),
    y: z.number().finite().min(-32768).max(32768).optional(),
    layout: z
      .object({
        x: z.number().finite().min(-32768).max(32768),
        width: z.number().finite().min(6).max(32768),
      })
      .strict()
      .optional(),
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
    if (call.ink) {
      c.text.color = call.ink.foreground;
      c.text.emphasis = call.ink.accent
        ? [
            {
              word: Math.min(
                call.ink.word,
                c.text.content.split(/\s+/).length - 1,
              ),
              color: call.ink.accent,
              scale: 1.15,
              weight: "900",
            },
          ]
        : [];
      c.text.highlightColor = call.ink.accent ?? call.ink.foreground;
    }
    if (call.maxFontSize !== undefined)
      c.text.size = Math.min(c.text.size, call.maxFontSize);
    if (call.face) {
      c.text.font = call.face.family;
      c.text.weight = call.face.weight;
    }
    if (call.y !== undefined) c.transform.y = call.y;
    if (call.layout) {
      c.transform.x = call.layout.x;
      c.text.maxWidth = call.layout.width;
      const longest = Math.max(
        ...c.text.content.split("\n").map((s) => s.length),
      );
      c.text.size = Math.max(
        6,
        Math.min(
          c.text.size,
          (call.layout.width - 2 * c.text.padding) /
            (Math.max(1, longest) * 0.78 * 1.25),
        ),
      );
    }
    fitTextVertically(c, p.settings.width, p.settings.height);
    animateText(c, call.treatment, fps(p), call.wordStarts);
    if (call.measuredInk) {
      const { samples, widthEm, heightEm, centerXEm, centerYEm } =
        call.measuredInk;
      if (
        samples.some(
          (s, i) =>
            s.frame >= call.duration ||
            (i === 0 ? s.frame !== 0 : s.frame <= samples[i - 1].frame),
        )
      )
        throw Error("Invalid captured ink timing");
      c.text.size = Math.max(6, Math.min(1000, samples[0].height / heightEm));
      c.text.padding = 0;
      c.text.maxWidth = 0;
      c.text.tracking = 0;
      c.text.shadowY = 0;
      c.text.shadowBlur = 0;
      c.text.strokeWidth = 0;
      c.text.emphasis =
        call.ink?.accent && c.text.content.trim().split(/\s+/).length > 1
          ? [
              {
                word: Math.min(
                  call.ink.word,
                  c.text.content.trim().split(/\s+/).length - 1,
                ),
                color: call.ink.accent,
                scale: 1,
                weight: c.text.weight === "400" ? "normal" : "bold",
              },
            ]
          : [];
      if (call.ink?.accent && c.text.content.trim().split(/\s+/).length === 1)
        c.text.color = call.ink.accent;
      for (const prop of [
        "opacity",
        "scale",
        "x",
        "y",
        "scaleX",
        "scaleY",
      ] as const)
        c.keyframes[prop] = [];
      const poses = samples.map((s) => {
        const scaleX = Math.max(
          0.01,
          Math.min(10, s.width / (widthEm * c.text.size)),
        );
        const scaleY = Math.max(
          0.01,
          Math.min(10, s.height / (heightEm * c.text.size)),
        );
        return {
          frame: s.frame,
          x: s.x - centerXEm * c.text.size * scaleX,
          y: s.y - centerYEm * c.text.size * scaleY,
          scaleX,
          scaleY,
        };
      });
      for (const prop of ["x", "y", "scaleX", "scaleY"] as const) {
        c.transform[prop] = poses[0][prop];
        if (
          poses.some(
            (v) =>
              Math.abs(v[prop] - poses[0][prop]) >
              (prop === "x" || prop === "y" ? 1 : 0.015),
          )
        )
          c.keyframes[prop] = poses.map((v) => ({
            frame: v.frame,
            value: v[prop],
            easing: "linear",
          }));
      }
    }
    if (call.differenceInk) {
      c.blendMode = "difference";
      c.text.color = call.differenceInk;
      c.text.emphasis = [];
    }
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
