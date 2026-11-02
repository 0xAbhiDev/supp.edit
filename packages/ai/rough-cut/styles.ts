import { z } from "zod";

export const gymStyleSchema = z.enum([
  "dark-aesthetic",
  "clean-aesthetic",
  "cinematic",
  "hardcore",
  "physique",
  "powerlifting",
  "minimal",
]);
export type GymStyle = z.infer<typeof gymStyleSchema>;
export interface GymStyleProfile {
  name: string;
  shotSeconds: number;
  hookSeconds: number;
  pacing: "cinematic" | "balanced" | "energetic" | "aggressive";
  beatSync: "loose" | "balanced" | "tight";
  musicInfluence: number;
  hook: {
    quality: number;
    visibility: number;
    motion: number;
    relevance: number;
    novelty: number;
    music: number;
  };
  preferredLabels: readonly string[];
  motionTarget: number;
  speedRamps: "off" | "subtle" | "dynamic";
  rampFraction: number;
  zoomIntensity: number;
  transitionIntensity: number;
  contrastTarget: number;
  saturationTarget: number;
  grain: { amount: number; size: number; softness: number };
  vignette: number;
  sharpening: number;
  captionStyle: "Minimal" | "Bold" | "Creator" | "Fitness" | "Karaoke";
  audio: {
    musicDb: number;
    dialogueTargetDb: number;
    duckDb: number;
    fadeSeconds: number;
  };
}
const base: GymStyleProfile = {
  name: "Clean Aesthetic",
  shotSeconds: 3.6,
  hookSeconds: 1.8,
  pacing: "balanced",
  beatSync: "balanced",
  musicInfluence: 0.45,
  hook: {
    quality: 0.25,
    visibility: 0.25,
    motion: 0.14,
    relevance: 0.18,
    novelty: 0.1,
    music: 0.08,
  },
  preferredLabels: [],
  motionTarget: 0.45,
  speedRamps: "subtle",
  rampFraction: 0.2,
  zoomIntensity: 0.03,
  transitionIntensity: 0,
  contrastTarget: 1.04,
  saturationTarget: 1.01,
  grain: { amount: 0, size: 1, softness: 0.5 },
  vignette: 0,
  sharpening: 0.08,
  captionStyle: "Minimal",
  audio: { musicDb: -14, dialogueTargetDb: -18, duckDb: 8, fadeSeconds: 0.25 },
};
/** Style intent. A parameter is exposed as a control only when its execution backend exists. */
export const gymStyles: Readonly<Record<GymStyle, GymStyleProfile>> = {
  "clean-aesthetic": base,
  "dark-aesthetic": {
    ...base,
    name: "Dark Aesthetic",
    shotSeconds: 3.5,
    motionTarget: 0.6,
    zoomIntensity: 0.04,
    contrastTarget: 1.09,
    saturationTarget: 0.92,
    grain: { amount: 0.025, size: 1.2, softness: 0.6 },
    vignette: 0.12,
  },
  cinematic: {
    ...base,
    name: "Cinematic",
    shotSeconds: 4.4,
    hookSeconds: 2,
    pacing: "cinematic",
    musicInfluence: 0.65,
    hook: {
      quality: 0.3,
      visibility: 0.22,
      motion: 0.08,
      relevance: 0.15,
      novelty: 0.17,
      music: 0.08,
    },
    motionTarget: 0.3,
    contrastTarget: 1.06,
    saturationTarget: 0.94,
    grain: { amount: 0.018, size: 1.1, softness: 0.65 },
    vignette: 0.08,
    transitionIntensity: 0.08,
  },
  hardcore: {
    ...base,
    name: "Hardcore",
    shotSeconds: 2.1,
    hookSeconds: 1.3,
    pacing: "aggressive",
    beatSync: "tight",
    musicInfluence: 0.85,
    hook: {
      quality: 0.16,
      visibility: 0.17,
      motion: 0.26,
      relevance: 0.17,
      novelty: 0.08,
      music: 0.16,
    },
    motionTarget: 0.85,
    preferredLabels: ["deadlift", "squat", "barbell exercise"],
    speedRamps: "dynamic",
    rampFraction: 0.4,
    zoomIntensity: 0.06,
    contrastTarget: 1.12,
    saturationTarget: 0.94,
    grain: { amount: 0.035, size: 1.3, softness: 0.45 },
    vignette: 0.12,
    captionStyle: "Fitness",
    audio: { ...base.audio, musicDb: -11, duckDb: 10 },
  },
  physique: {
    ...base,
    name: "Physique",
    shotSeconds: 4.8,
    hookSeconds: 2,
    pacing: "cinematic",
    beatSync: "loose",
    musicInfluence: 0.25,
    hook: {
      quality: 0.28,
      visibility: 0.32,
      motion: 0.04,
      relevance: 0.22,
      novelty: 0.1,
      music: 0.04,
    },
    preferredLabels: ["posing", "mirror pose"],
    motionTarget: 0.12,
    speedRamps: "off",
    rampFraction: 0,
    zoomIntensity: 0.035,
    contrastTarget: 1.035,
    saturationTarget: 0.99,
  },
  powerlifting: {
    ...base,
    name: "Powerlifting",
    shotSeconds: 4.6,
    hookSeconds: 2,
    musicInfluence: 0.65,
    hook: {
      quality: 0.17,
      visibility: 0.24,
      motion: 0.21,
      relevance: 0.22,
      novelty: 0.06,
      music: 0.1,
    },
    preferredLabels: ["deadlift", "squat", "bench press", "training setup"],
    motionTarget: 0.7,
    rampFraction: 0.15,
    zoomIntensity: 0.025,
    contrastTarget: 1.06,
    saturationTarget: 0.98,
    captionStyle: "Bold",
  },
  minimal: {
    ...base,
    name: "Minimal",
    shotSeconds: 4.1,
    hookSeconds: 2,
    beatSync: "loose",
    musicInfluence: 0.15,
    speedRamps: "off",
    rampFraction: 0,
    zoomIntensity: 0,
    contrastTarget: 1.015,
    saturationTarget: 1,
    sharpening: 0,
  },
};
export function requestedGymStyle(prompt: string): GymStyle | undefined {
  if (/dark\s+(?:aesthetic|gym)|dark aesthetic/i.test(prompt))
    return "dark-aesthetic";
  if (/clean\s+(?:aesthetic|gym)/i.test(prompt)) return "clean-aesthetic";
  if (/hardcore/i.test(prompt)) return "hardcore";
  if (/physique/i.test(prompt)) return "physique";
  if (/powerlifting/i.test(prompt)) return "powerlifting";
  if (/cinematic/i.test(prompt)) return "cinematic";
  // "Keep transitions minimal" must not override a requested aesthetic.
  if (
    /minimal(?:ist)?\s+(?:style|gym|edit|reel)|(?:style|look)\s*:?\s*minimal/i.test(
      prompt,
    )
  )
    return "minimal";
  return undefined;
}
