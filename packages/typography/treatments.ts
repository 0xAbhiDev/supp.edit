import type { Clip, Keyframe } from "../project-schema";
import {
  type TextTreatment,
  type TypographyStyle,
  socialSafeArea,
} from "./model";
export const profiles: Record<
  TypographyStyle,
  {
    font: string;
    weight: Clip["text"]["weight"];
    color: string;
    accent: string;
    size: number;
    tracking: number;
    treatment: TextTreatment;
    lineSpacing: number;
  }
> = {
  Minimal: {
    font: "sans-serif",
    weight: "normal",
    color: "#FFFFFF",
    accent: "#FFFFFF",
    size: 0.075,
    tracking: 0,
    treatment: "Fade",
    lineSpacing: 1.2,
  },
  Creator: {
    font: "sans-serif",
    weight: "700",
    color: "#FFFFFF",
    accent: "#91DFFF",
    size: 0.105,
    tracking: 0,
    treatment: "Pop",
    lineSpacing: 1.1,
  },
  Bold: {
    font: "sans-serif",
    weight: "900",
    color: "#FFFFFF",
    accent: "#FFE985",
    size: 0.14,
    tracking: 0,
    treatment: "Scale In",
    lineSpacing: 1,
  },
  Motivational: {
    font: "sans-serif",
    weight: "bold",
    color: "#FFFFFF",
    accent: "#F6D267",
    size: 0.12,
    tracking: 1,
    treatment: "Word Build",
    lineSpacing: 1.05,
  },
  Aggressive: {
    font: "sans-serif",
    weight: "900",
    color: "#FFFFFF",
    accent: "#C9FF69",
    size: 0.15,
    tracking: -0.5,
    treatment: "Punch",
    lineSpacing: 0.95,
  },
  Cinematic: {
    font: "serif",
    weight: "normal",
    color: "#F2E8D8",
    accent: "#FFFFFF",
    size: 0.09,
    tracking: 2,
    treatment: "Blur Reveal",
    lineSpacing: 1.3,
  },
  Luxury: {
    font: "serif",
    weight: "300",
    color: "#EFDDAA",
    accent: "#FFF8E7",
    size: 0.085,
    tracking: 3,
    treatment: "Tracking Reveal",
    lineSpacing: 1.4,
  },
  Fitness: {
    font: "sans-serif",
    weight: "800",
    color: "#FFFFFF",
    accent: "#FFCC5C",
    size: 0.13,
    tracking: 0.4,
    treatment: "Slide",
    lineSpacing: 1,
  },
  Karaoke: {
    font: "sans-serif",
    weight: "bold",
    color: "#FFFFFF",
    accent: "#C9FF69",
    size: 0.1,
    tracking: 0,
    treatment: "Karaoke Highlight",
    lineSpacing: 1.1,
  },
  Documentary: {
    font: "serif",
    weight: "normal",
    color: "#FFFFFF",
    accent: "#FFE3B5",
    size: 0.075,
    tracking: 0,
    treatment: "Typewriter",
    lineSpacing: 1.25,
  },
};
export const typographyRhythm: Record<
  TypographyStyle,
  { hold: number; rest: number; y: number }
> = {
  Minimal: { hold: 1.5, rest: 1.5, y: 0.65 },
  Creator: { hold: 1.2, rest: 1, y: 0.64 },
  Bold: { hold: 1.3, rest: 1.1, y: 0.22 },
  Motivational: { hold: 1.6, rest: 1.2, y: 0.26 },
  Aggressive: { hold: 1.2, rest: 0.9, y: 0.22 },
  Cinematic: { hold: 2, rest: 1.8, y: 0.68 },
  Luxury: { hold: 2.2, rest: 2, y: 0.3 },
  Fitness: { hold: 1.1, rest: 1.2, y: 0.67 },
  Karaoke: { hold: 1.8, rest: 0.9, y: 0.68 },
  Documentary: { hold: 2.1, rest: 1.5, y: 0.65 },
};
const key = (
  frame: number,
  value: number,
  easing: Keyframe["easing"] = "ease-out",
): Keyframe => ({ frame: Math.round(frame), value, easing });
/** Presets author ordinary curves. No hidden per-frame animation runtime. */
export function animateText(
  c: Clip,
  treatment: TextTreatment,
  rate: number,
  wordStarts?: number[],
) {
  const end = c.duration - 1,
    attack = Math.max(
      1,
      Math.min(Math.round(rate * 0.22), Math.floor(end / 3)),
    ),
    release = Math.max(attack + 1, end - attack);
  if (end < 3) throw new Error("Text treatments need at least four frames");
  for (const k of [
    "opacity",
    "scale",
    "x",
    "y",
    "blur",
    "tracking",
    "reveal",
    "highlight",
    "cropRight",
  ] as const)
    c.keyframes[k] = [];
  c.text.reveal = 1;
  c.text.highlight = -1;
  c.text.role = "overlay";
  c.keyframes.opacity = [
    key(0, 0),
    key(attack, 1),
    key(release, 1, "linear"),
    key(end, 0, "ease-in"),
  ];
  if (
    ["Scale In", "Pop", "Punch", "Impact Word", "Background Word"].includes(
      treatment,
    )
  ) {
    const pop =
      treatment === "Pop" ||
      treatment === "Punch" ||
      treatment === "Impact Word";
    c.keyframes.scale = [
      key(0, c.transform.scale * (treatment === "Punch" ? 1.16 : 0.72)),
      key(attack, c.transform.scale * (pop ? 1.06 : 1)),
      ...(pop ? [key(attack * 2, c.transform.scale)] : []),
    ];
  }
  if (treatment === "Slide")
    c.keyframes.x = [key(0, c.transform.x - 32), key(attack, c.transform.x)];
  if (
    treatment === "Directional Entrance" ||
    treatment === "Directional Exit"
  ) {
    const axis =
        c.text.direction === "up" || c.text.direction === "down" ? "y" : "x",
      sign = c.text.direction === "up" || c.text.direction === "left" ? -1 : 1,
      base = c.transform[axis];
    c.keyframes[axis] =
      treatment === "Directional Entrance"
        ? [key(0, base + sign * 40), key(attack * 2, base)]
        : [key(release, base, "ease-in"), key(end, base + sign * 40)];
  }
  if (treatment === "Overshoot")
    c.keyframes.x = [
      key(0, c.transform.x - 40),
      key(attack, c.transform.x + 8),
      key(attack * 2, c.transform.x),
    ];
  if (treatment === "Scale Bounce" || treatment === "Spring Motion") {
    const values =
      treatment === "Spring Motion"
        ? [0.65, 1.12, 0.96, 1.025, 1]
        : [0.6, 1.1, 0.94, 1];
    c.keyframes.scale = values
      .map((v, i) =>
        key(
          (i / (values.length - 1)) * Math.min(end - 1, attack * 3),
          v * c.transform.scale,
        ),
      )
      .filter((k, i, a) => !a.slice(i + 1).some((x) => x.frame === k.frame));
  }
  if (treatment === "Masked Reveal")
    c.keyframes.cropRight = [key(0, 1), key(attack * 2, 0)];
  if (treatment === "Blur Reveal")
    c.keyframes.blur = [
      key(0, Math.min(18, c.text.size * 0.3)),
      key(attack * 2, 0),
    ];
  if (treatment === "Tracking Reveal")
    c.keyframes.tracking = [
      key(0, Math.min(100, c.text.tracking + 8)),
      key(attack * 2, c.text.tracking),
    ];
  if (["Typewriter", "Word Build", "Stacked Words"].includes(treatment)) {
    c.text.revealUnit = treatment === "Typewriter" ? "characters" : "words";
    if (wordStarts?.length && treatment !== "Typewriter")
      c.keyframes.reveal = [
        key(0, 0, "hold"),
        ...wordStarts.map((f, i) =>
          key(f, (i + 1) / wordStarts.length, "hold"),
        ),
      ].filter((k, i, a) => !a.slice(i + 1).some((x) => x.frame === k.frame));
    else
      c.keyframes.reveal = [
        key(0, 0, "linear"),
        key(Math.max(attack, Math.round(end * 0.48)), 1, "linear"),
      ];
  }
  if (treatment === "Karaoke Highlight") {
    if (!wordStarts?.length)
      throw new Error(
        "Karaoke requires word timestamps; set individual highlight keys for manual timing",
      );
    c.keyframes.highlight = wordStarts.map((f, i) => key(f, i, "hold"));
    c.text.highlightScale = 1.12;
  }
  if (treatment === "Phrase Build") {
    c.text.revealUnit = "phrases";
    const count = c.text.content.split("\n").length;
    c.keyframes.reveal = wordStarts?.length
      ? wordStarts
          .filter((_, i) => i % 2 === 0)
          .map((f, i) => key(f, Math.min(1, (i + 1) / count), "hold"))
      : [
          key(0, 0, "linear"),
          key(Math.max(attack, Math.round(end * 0.5)), 1, "linear"),
        ];
  }
  if (treatment === "Background Word") {
    c.text.role = "background";
    c.keyframes.opacity.forEach((k) => (k.value *= 0.24));
  }
}
export function styleText(
  c: Clip,
  style: TypographyStyle,
  width: number,
  height: number,
  treatment?: TextTreatment,
) {
  const p = profiles[style],
    safe = socialSafeArea(width, height);
  Object.assign(c.text, {
    font: p.font,
    weight: p.weight,
    color: p.color,
    highlightColor: p.accent,
    highlightScale: treatment === "Karaoke Highlight" ? 1.12 : 1,
    tracking: p.tracking,
    lineSpacing: p.lineSpacing,
    maxWidth: safe.right - safe.left,
    padding: Math.max(3, width * 0.015),
    shadowBlur: width * 0.008,
    shadowY: width * 0.004,
    strokeWidth: style === "Aggressive" ? width * 0.002 : 0,
  });
  c.text.size = Math.max(6, Math.min(180, width * p.size));
  c.text.emphasis = [
    {
      word: Math.max(0, c.text.content.trim().split(/\s+/).length - 1),
      scale: 1.25,
      color: p.accent,
      weight: "900",
    },
  ];
  c.transform.x = (safe.left + safe.right - width) / 2;
  c.transform.y = height * (typographyRhythm[style].y - 0.5);
  if (treatment === "Stacked Words")
    c.text.content = c.text.content.trim().split(/\s+/).join("\n");
  if (treatment === "Phrase Build") {
    const words = c.text.content.trim().split(/\s+/);
    c.text.content = Array.from(
      { length: Math.ceil(words.length / 2) },
      (_, i) => words.slice(i * 2, i * 2 + 2).join(" "),
    ).join("\n");
  }
  // Keep the complete emphasized block inside conservative safe authoring bounds.
  const longest = Math.max(...c.text.content.split("\n").map((s) => s.length));
  c.text.size = Math.max(
    6,
    Math.min(
      c.text.size,
      (safe.right - safe.left - width * 0.06) /
        (Math.max(1, longest) * 0.78 * 1.25 * c.text.highlightScale),
    ),
  );
  fitTextVertically(c, width, height);
}
export function fitTextVertically(c: Clip, width: number, height: number) {
  const safe = socialSafeArea(width, height),
    lines = c.text.content.split("\n").length;
  const pad =
    c.text.padding +
    c.text.shadowBlur * 2 +
    c.text.strokeWidth +
    Math.abs(c.text.shadowY) +
    4;
  const available = safe.bottom - safe.top;
  c.text.size = Math.max(
    6,
    Math.min(
      c.text.size,
      (available / 1.16 - pad * 2) /
        (Math.max(1, lines) *
          c.text.lineSpacing *
          1.25 *
          c.text.highlightScale),
    ),
  );
  const half =
    ((lines * c.text.size * c.text.lineSpacing * 1.25 * c.text.highlightScale +
      pad * 2) *
      1.16) /
    2;
  c.transform.y =
    Math.max(
      safe.top + half,
      Math.min(safe.bottom - half, c.transform.y + height / 2),
    ) -
    height / 2;
}
