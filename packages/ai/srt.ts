import { transcriptSchema, type Transcript } from "./transcript";

export const MAX_SRT_BYTES = 2 * 1024 * 1024;
function timestamp(value: string): number {
  const match = /^(\d{2,3}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value);
  if (!match) throw new Error("SRT timestamps must use HH:MM:SS,mmm");
  return (
    ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) *
      1000 +
    Number(match[4])
  );
}
export function parseSrt(input: string, name = "Imported SRT"): Transcript {
  if (
    input.length > MAX_SRT_BYTES ||
    new TextEncoder().encode(input).byteLength > MAX_SRT_BYTES
  )
    throw new Error("SRT input exceeds the 2 MiB limit");
  const normalized = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) throw new Error("Paste or import an SRT transcript first");
  const blocks = normalized.split(/\n[\t ]*\n+/);
  if (blocks.length > 10000)
    throw new Error("SRT supports at most 10,000 cues");
  const segments = blocks.map((block, i) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const timing =
      /^\s*(\d{2,3}:[0-5]\d:[0-5]\d[,.]\d{3})\s+-->\s+(\d{2,3}:[0-5]\d:[0-5]\d[,.]\d{3})\s*$/.exec(
        lines.shift() ?? "",
      );
    if (!timing) throw new Error(`Invalid SRT timestamp in cue ${i + 1}`);
    const text = lines.join("\n").trim();
    if (!text) throw new Error(`SRT cue ${i + 1} has no text`);
    return {
      id: crypto.randomUUID(),
      startMs: timestamp(timing[1]),
      endMs: timestamp(timing[2]),
      text,
    };
  });
  const parsed = transcriptSchema.safeParse({
    id: crypto.randomUUID(),
    name,
    source: "srt",
    segments,
  });
  if (!parsed.success)
    throw new Error(
      "Invalid SRT: cues must be ordered, contain text, and have positive durations within seven days",
    );
  for (let i = 1; i < segments.length; i++)
    if (segments[i].startMs < segments[i - 1].endMs)
      throw new Error(
        "Overlapping SRT cues are not supported by the single-track caption workflow",
      );
  return parsed.data;
}
