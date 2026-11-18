import type { TextAppearance } from "./appearance";
import type { Transcript } from "../transcript";
import type { BeatMap } from "../media-analysis/model";
import { strongEvents } from "../rough-cut/beats";

const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** A soundtrack word alone says nothing about whether it was printed on screen. */
export function assessReferenceText(
  lines: TextAppearance[],
  transcript?: Transcript,
  music?: BeatMap,
) {
  const words = (transcript?.segments ?? []).flatMap((segment) =>
    (segment.words ?? [])
      .filter((w) => normalize(w.text))
      .map((word) => ({ ...word, sung: /[♪♫]/.test(segment.text) })),
  );
  const beats = music ? strongEvents(music) : [];
  const assessed = lines.map((line): TextAppearance => {
    const tokens = (line.content ?? "")
      .split(/\s+/)
      .map(normalize)
      .filter(Boolean);
    const nearby = words.filter(
      (w) => w.endMs >= line.startMs - 350 && w.startMs <= line.endMs + 350,
    );
    const index = tokens.length
      ? nearby.findIndex((_, i) =>
          tokens.every(
            (t, j) =>
              t === normalize(nearby[i + j]?.text ?? "") &&
              (nearby[i + j]?.confidence ?? 0) >= 0.55,
          ),
        )
      : -1;
    const aligned = index < 0 ? [] : nearby.slice(index, index + tokens.length);
    const letters = line.content?.replace(/[^\p{L}]/gu, "") ?? "";
    const dubious =
      !letters ||
      /[\p{Ll}][\p{Lu}]|[\p{L}]\d|\d[\p{L}]|[^\p{L}\p{N} '’.,!?-]/u.test(
        line.content ?? "",
      );
    // Agreement between preprocessing passes, or the same reading held over many sampled frames
    // (temporal consensus: one pass can fail on busy or coloured backgrounds while the other
    // reads the line identically frame after frame). Short words still need both passes.
    const consensus =
      !!line.observations &&
      !dubious &&
      ((line.observations >= 2 && (line.passAgreements ?? 0) >= 2 && (letters.length >= 3 || line.observations >= 4)) ||
        (line.observations >= 5 && letters.length >= 3));
    // Older profiles have no pass counts. Keep the established, multi-word title path.
    const legacy = line.observations == null && tokens.length >= 2 && !dubious;
    const label = line.role === "persistent-overlay";
    const status = label
      ? "uncertain"
      : aligned.length
        ? "audio-visual"
        : consensus || legacy
          ? "visual-consensus"
          : "uncertain";
    return {
      ...line,
      evidence: {
        status,
        kind: label
          ? "label"
          : aligned.length
            ? aligned.some((w) => w.sung)
              ? "captioned-lyrics"
              : "captioned-speech"
            : status === "visual-consensus"
              ? "title"
              : "unresolved",
        wordStartsMs: aligned.map((w) => w.startMs),
        beatDistanceMs: beats.length
          ? beats.reduce(
              (best, b) => Math.min(best, Math.abs(b.timeMs - line.startMs)),
              Infinity,
            )
          : null,
      },
    };
  });
  const lyrics = assessed.filter(
    (l) => l.evidence?.kind === "captioned-lyrics",
  ).length;
  const semantic = assessed.filter(
    (l) => l.role !== "persistent-overlay",
  ).length;
  // Repeated OCR can consistently misread a glyph. On a lyric-led reference, disagreement
  // with a nearby vocal is not sufficient evidence to promote that token to an unrelated title.
  if (lyrics >= 3 && lyrics / Math.max(1, semantic) >= 0.3)
    return assessed.map((line) =>
      line.evidence?.status === "visual-consensus" &&
      words.some(
        (w) =>
          w.sung &&
          w.startMs < line.endMs + 350 &&
          w.endMs > line.startMs - 350,
      )
        ? {
            ...line,
            evidence: {
              ...line.evidence,
              status: "uncertain" as const,
              kind: "unresolved" as const,
            },
          }
        : line,
    );
  return assessed;
}
