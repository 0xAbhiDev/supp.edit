import { type Project, uid, fps, duration } from "../project-schema";
import { compositionView } from "../commands/compositions";
import { sourceFrameAt, timelineFrameAt } from "../time-remap/model";
import { layerTransforms, canvasMatrix, point } from "../animation/affine";
import { previewEditPlan } from "../ai/editor-agent/execution";
import type { MediaAnalysis } from "../ai/media-analysis/model";
import { timingMode, timelineCues } from "./timing";
import {
  typographyStyles,
  textTreatments,
  socialSafeArea,
  type TypographyStyle,
} from "./model";
import { profiles, typographyRhythm } from "./treatments";
import type { z } from "zod";
import type { typographyCommandSchema } from "./commands";
export const typographyRequest =
  /\b(?:kinetic typography|animated text|typography|impact words|karaoke highlight)\b/i;
type Event = {
  start: number;
  end: number;
  text: string;
  words?: number[];
  strength: number;
  cue?: number;
};
export function musicRequested(request: string) {
  return ["music-event", "energy-change"].includes(timingMode(request));
}
/** Choose an uncluttered top/bottom safe band using cached, transformed person boxes. */
function placement(
  p: Project,
  start: number,
  end: number,
  analyses: readonly MediaAnalysis[],
  preferred: number,
) {
  const { width: w, height: h } = p.settings,
    safe = socialSafeArea(w, h),
    band = h * 0.13;
  const candidates = [safe.top + band / 2, safe.bottom - band / 2];
  const scores = candidates.map(() => 0);
  let evidence = 0;
  for (const frame of [start, Math.round((start + end) / 2), end - 1])
    for (const c of p.clips.filter(
      (c) =>
        c.kind === "media" && c.start <= frame && c.start + c.duration > frame,
    )) {
      const a = p.assets.find((a) => a.id === c.assetId);
      if (!a || a.kind !== "video") continue;
      const at = (sourceFrameAt(c, frame - c.start) / fps(p)) * 1000;
      const samples =
        analyses.find(
          (x) =>
            x.assetId === a.id && x.fingerprint === a.fingerprint && x.vision,
        )?.vision?.frames ?? [];
      const sample = [...samples].sort(
        (a, b) => Math.abs(a.timeMs - at) - Math.abs(b.timeMs - at),
      )[0];
      if (!sample || Math.abs(sample.timeMs - at) > 2500) continue;
      const boxes = sample.detections.filter(
        (d) => d.label === "person" && d.confidence >= 0.5,
      );
      const matrix = canvasMatrix(p, layerTransforms(p, frame).world(c.id));
      const fit = Math.min(w / a.width, h / a.height),
        fw = a.width * fit,
        fh = a.height * fit;
      for (const d of boxes) {
        evidence++;
        const b = d.bounds,
          pts = [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x, b.y + b.height],
            [b.x + b.width, b.y + b.height],
          ].map(([x, y]) => point(matrix, (x - 0.5) * fw, (y - 0.5) * fh));
        const l = Math.min(...pts.map((p) => p.x)),
          r = Math.max(...pts.map((p) => p.x)),
          t = Math.min(...pts.map((p) => p.y)),
          bottom = Math.max(...pts.map((p) => p.y));
        const coveredWidth = Math.max(
          0,
          Math.min(r, safe.right) - Math.max(l, safe.left),
        );
        // Protect the upper body when both bands intersect a tall person.
        // This is a conservative head-region estimate from the detection box.
        const upperBody = t + (bottom - t) * 0.35;
        candidates.forEach((y, i) => {
          const overlapHeight = (lower: number) =>
            Math.max(
              0,
              Math.min(lower, y + band / 2) - Math.max(t, y - band / 2),
            );
          scores[i] +=
            coveredWidth *
            (overlapHeight(bottom) + 6 * overlapHeight(upperBody));
        });
      }
    }
  const chosen =
    scores[1] < scores[0] ||
    (scores[1] === scores[0] &&
      Math.abs(candidates[1] / h - preferred) <
        Math.abs(candidates[0] / h - preferred))
      ? 1
      : 0;
  return {
    y: candidates[chosen] - h / 2,
    evidence,
    overlap: scores[chosen] > 0,
  };
}
export function planTypography(
  request: string,
  project: Project,
  revision: number,
  scope: string | null,
  analyses: readonly MediaAnalysis[],
) {
  if (!typographyRequest.test(request))
    throw new Error("Request animated typography for the active sequence");
  const p = compositionView(project, scope),
    rate = fps(p),
    length = duration(p);
  if (length < rate * 2)
    throw new Error("Choose a sequence at least two seconds long");
  const style: TypographyStyle =
    typographyStyles.find((s) => new RegExp(`\\b${s}\\b`, "i").test(request)) ??
    "Minimal";
  // Aggressive explicitly wins when a request also says motivational.
  const profile = /aggressive/i.test(request) ? "Aggressive" : style;
  const explicit = textTreatments.find((s) =>
    new RegExp(`\\b${s}\\b`, "i").test(request),
  );
  const mode = timingMode(request),
    music = mode !== "transcript",
    rhythm = typographyRhythm[profile],
    events: Event[] = [];
  if (music) {
    for (const e of timelineCues(p, analyses, mode)) {
      const start = Math.max(0, e.frame - Math.round(rate * 0.22));
      events.push({
        start,
        end: Math.min(length, e.frame + Math.round(rate * rhythm.hold)),
        text: "",
        strength: e.strength,
        cue: e.frame - start,
      });
    }
    if (!events.length)
      throw new Error(
        `No ${mode === "music-event" ? "measured strong music events" : mode} events overlap this sequence; analyze music or choose existing timeline events`,
      );
  } else {
    for (const clip of p.clips.filter((c) => c.kind === "media")) {
      const asset = p.assets.find((a) => a.id === clip.assetId),
        t = project.transcripts.find(
          (t) =>
            t.assetId === asset?.id &&
            t.sourceFingerprint === asset?.fingerprint,
        );
      if (!t) continue;
      const from = (sourceFrameAt(clip, 0) * 1000) / rate,
        to = (sourceFrameAt(clip, clip.duration) * 1000) / rate;
      for (const segment of t.segments) {
        const words = (segment.words ?? []).filter(
          (w) => w.endMs > from && w.startMs < to,
        );
        const groups = words.length
          ? Array.from({ length: Math.ceil(words.length / 4) }, (_, i) =>
              words.slice(i * 4, i * 4 + 4),
            )
          : [[segment]];
        for (const group of groups) {
          const first = group[0],
            last = group.at(-1)!;
          if (first.endMs <= from || first.startMs >= to) continue;
          const start =
              clip.start +
              Math.max(
                0,
                Math.round(
                  timelineFrameAt(clip, (first.startMs * rate) / 1000),
                ),
              ),
            end =
              clip.start +
              Math.min(
                clip.duration,
                Math.round(timelineFrameAt(clip, (last.endMs * rate) / 1000)),
              );
          if (end - start < 4) continue;
          const starts = words.length
            ? group.map((w) =>
                Math.max(
                  0,
                  clip.start +
                    Math.round(
                      timelineFrameAt(clip, (w.startMs * rate) / 1000),
                    ) -
                    start,
                ),
              )
            : undefined;
          events.push({
            start,
            end,
            text: group.map((w) => w.text).join(" "),
            words: starts,
            strength: 1,
          });
        }
      }
    }
    if (!events.length)
      throw new Error(
        "Import or transcribe the sequence's source speech first; no word timing is invented",
      );
  }
  const selected: Event[] = [],
    max = Math.max(1, Math.min(5, Math.floor(length / rate / 3)));
  for (const e of [...events].sort(
    (a, b) => b.strength - a.strength || a.start - b.start,
  )) {
    if (
      e.end - e.start < rate * 0.35 ||
      e.end > length ||
      selected.some(
        (x) =>
          e.start < x.end + rate * rhythm.rest &&
          e.end + rate * rhythm.rest > x.start,
      )
    )
      continue;
    selected.push(e);
    if (selected.length === max) break;
  }
  selected.sort((a, b) => a.start - b.start);
  if (!selected.length)
    throw new Error(
      "No sufficiently separated typography events fit this edit",
    );
  const quoted = [...request.matchAll(/["“]([^"”]{1,80})["”]/g)].map(
      (m) => m[1],
    ),
    phrases = quoted.length
      ? quoted
      : [
          "STAY FOCUSED",
          "BUILD STRENGTH",
          "ONE MORE REP",
          "EARN IT",
          "KEEP GOING",
        ];
  const trackId = uid();
  let detected = 0,
    overlap = 0;
  const commands = selected.map(
    (e, i): z.infer<typeof typographyCommandSchema> => {
      const pos = placement(p, e.start, e.end, analyses, rhythm.y);
      detected += pos.evidence;
      overlap += Number(pos.overlap);
      const treatment =
        explicit ??
        (profile === "Aggressive"
          ? (["Punch", "Impact Word", "Slide"] as const)
          : [profiles[profile].treatment])[
          i % (profile === "Aggressive" ? 3 : 1)
        ];
      if (treatment === "Karaoke Highlight" && !e.words)
        throw new Error("Karaoke needs actual word timestamps");
      return {
        tool: "text.create",
        id: uid(),
        trackId,
        content: music ? phrases[i % phrases.length] : e.text,
        start: e.start,
        duration: e.end - e.start,
        style: profile,
        treatment,
        wordStarts: e.words,
        timing: mode,
        cueFrame: e.cue,
        y: pos.y,
      };
    },
  );
  return previewEditPlan(
    {
      id: uid(),
      projectId: project.id,
      revision,
      compositionId: scope,
      ...(scope ? { resultCompositionId: scope } : {}),
      processing: "LOCAL",
      summary: `${commands.length} editable ${profile} phrases · ${music ? `${mode === "music-event" ? "measured strong music events" : mode === "hook" ? "opening-shot hook (not rep recognition)" : mode} timing; suggested copy, not a transcript` : "source transcript timing (review approximate word boundaries)"} · ${rhythm.rest}s or longer rests · conservative top/bottom/right safe zones. ${detected ? `Cached person boxes guide placement${overlap ? "; some overlap remains, review before Apply" : ""}.` : "No reliable subject boxes: conservative safe-band placement; review athlete visibility."} No foreground masking.`,
      commands,
    },
    project,
    revision,
  );
}
