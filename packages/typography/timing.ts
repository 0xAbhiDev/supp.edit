import { type Project, fps } from "../project-schema";
import type { MediaAnalysis } from "../ai/media-analysis/model";
import { strongEvents } from "../ai/rough-cut/beats";
import { musicEvents } from "../ai/rough-cut/music";
import { timelineFrameAt } from "../time-remap/model";
export function timingMode(request: string) {
  if (/transcript|spoken|speech|karaoke/i.test(request)) return "transcript";
  if (/energy changes?|energy rises?|energy falls?|drop/i.test(request))
    return "energy-change";
  if (/shot boundaries|shot boundary|cuts|transitions/i.test(request))
    return "shot-boundary";
  if (/speed.?ramp/i.test(request)) return "speed-ramp";
  if (/hook/i.test(request)) return "hook";
  if (/music|beat|onset|motivational|impact words/i.test(request))
    return "music-event";
  return "transcript";
}
export function timelineCues(
  p: Project,
  analyses: readonly MediaAnalysis[],
  mode: ReturnType<typeof timingMode>,
) {
  const rate = fps(p),
    out: { frame: number; strength: number }[] = [];
  if (mode === "music-event" || mode === "energy-change") {
    for (const clip of p.clips) {
      const a = p.assets.find((a) => a.id === clip.assetId);
      if (a?.kind !== "audio") continue;
      const map = analyses.find(
        (x) => x.assetId === a.id && x.fingerprint === a.fingerprint && x.audio,
      )?.audio?.beatMap;
      if (!map) continue;
      const events =
        mode === "energy-change"
          ? musicEvents(map).filter((e) =>
              ["energy-rise", "energy-fall", "possible-drop"].includes(e.kind),
            )
          : strongEvents(map);
      for (const e of events) {
        const local = timelineFrameAt(clip, (e.timeMs * rate) / 1000);
        if (local >= 0 && local < clip.duration)
          out.push({
            frame: clip.start + Math.round(local),
            strength: e.strength,
          });
      }
    }
  } else {
    const shots = p.clips
      .filter(
        (c) =>
          c.kind === "media" &&
          p.assets.some((a) => a.id === c.assetId && a.kind === "video"),
      )
      .sort((a, b) => a.start - b.start);
    if (mode === "shot-boundary")
      for (const c of shots.slice(1)) out.push({ frame: c.start, strength: 1 });
    if (mode === "speed-ramp")
      for (const c of shots) {
        const keys = c.timeRemap?.keys ?? [];
        if (keys.some((k) => k.speed !== keys[0].speed))
          for (const k of keys)
            if (k.frame > 0 && k.frame < c.duration)
              out.push({
                frame: c.start + k.frame,
                strength: Math.min(1, Math.abs(k.speed - 1) + 0.3),
              });
      }
    // A hook is the actual opening shot, not a claim of repetition recognition.
    if (mode === "hook" && shots.length)
      out.push({
        frame:
          shots[0].start +
          Math.min(Math.round(rate * 0.22), shots[0].duration - 1),
        strength: 1,
      });
  }
  return out;
}
