import { type Edit } from "./index";
import { newClip, newTrack, fps } from "../project-schema";
import { transcriptSchema, type Transcript } from "../ai/transcript";
export function speechCaptionCues(
  transcript: Transcript,
  startMs: number,
  endMs: number,
) {
  const cues: { startMs: number; endMs: number; text: string }[] = [];
  for (const segment of transcript.segments) {
    if (!segment.words?.length) {
      if (segment.endMs > startMs && segment.startMs < endMs)
        cues.push(segment);
      continue;
    }
    let group: NonNullable<typeof segment.words> = [];
    const flush = () => {
      if (group.length)
        cues.push({
          startMs: group[0].startMs,
          endMs: group.at(-1)!.endMs,
          text: group.map((w) => w.text).join(" "),
        });
      group = [];
    };
    for (const word of segment.words) {
      if (word.endMs <= startMs || word.startMs >= endMs) continue;
      if (
        group.length &&
        (group.length >= 7 ||
          group.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length >
            38 ||
          word.endMs - group[0].startMs > 2600)
      )
        flush();
      group.push(word);
      if (/[.!?]$/.test(word.text)) flush();
    }
    flush();
  }
  return cues;
}
export function importTranscript(input: Transcript): Edit {
  const transcript = transcriptSchema.parse(input);
  return (p) => {
    const asset = p.assets.find((a) => a.id === transcript.assetId);
    if (
      transcript.assetId &&
      (!asset ||
        (transcript.sourceFingerprint &&
          transcript.sourceFingerprint !== asset.fingerprint))
    )
      throw new Error("Transcript source has changed or is missing");
    if (p.transcripts.some((t) => t.id === transcript.id))
      throw new Error("This transcript is already in the project");
    p.transcripts.push(structuredClone(transcript));
  };
}
import { sourceFrameAt, timelineFrameAt } from "../time-remap/model";
/** Map source timestamps through the actual instance's source In/trim/speed curve. */
export function captionsForClip(
  transcriptId: string,
  clipId: string,
  trackId: string,
  prefix: string,
): Edit {
  return (p) => {
    const transcript = p.transcripts.find((t) => t.id === transcriptId),
      source = p.clips.find((c) => c.id === clipId);
    if (
      !transcript ||
      !source ||
      source.kind !== "media" ||
      transcript.assetId !== source.assetId
    )
      throw new Error(
        "Choose a timeline instance of the transcript's source media",
      );
    const asset = p.assets.find((a) => a.id === source.assetId);
    if (
      transcript.sourceFingerprint &&
      transcript.sourceFingerprint !== asset?.fingerprint
    )
      throw new Error("Transcript source has changed");
    if (p.tracks.some((t) => t.id === trackId))
      throw new Error("Caption track ID already exists");
    const rate = fps(p),
      track = newTrack("video", p.tracks.length + 1);
    track.id = trackId;
    track.name = "Speech captions";
    let count = 0,
      lastEnd = source.start;
    for (const segment of speechCaptionCues(
      transcript,
      (sourceFrameAt(source, 0) * 1000) / rate,
      (sourceFrameAt(source, source.duration) * 1000) / rate,
    )) {
      const start = Math.max(
        source.start,
        source.start +
          Math.round(timelineFrameAt(source, (segment.startMs * rate) / 1000)),
      );
      const end = Math.min(
        source.start + source.duration,
        source.start +
          Math.round(timelineFrameAt(source, (segment.endMs * rate) / 1000)),
      );
      if (end <= start) continue;
      if (start < lastEnd)
        throw new Error(
          "Overlapping speech segments require correction before caption creation",
        );
      const caption = newClip(trackId, start, end - start, "text");
      caption.id = `${prefix}-${count++}`;
      caption.name = `Caption ${count}`;
      caption.text.content = segment.text;
      caption.text.size = Math.max(
        6,
        Math.min(72, Math.round(p.settings.height * 0.05)),
      );
      caption.transform.y = Math.round(p.settings.height * 0.37);
      p.clips.push(caption);
      lastEnd = end;
    }
    if (!count) throw new Error("No speech overlaps this timeline clip");
    p.tracks.unshift(track);
  };
}
