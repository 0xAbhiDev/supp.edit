import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  newTrack,
  parseProject,
} from "../packages/project-schema";
import { History } from "../packages/commands";
import { rippleDeleteRanges } from "../packages/commands/nle";
import { transcriptSchema } from "../packages/ai/transcript";
import {
  fillerCandidates,
  nearestBeat,
  previewAnalysisCommands,
  sourceToTimelineRanges,
  transcriptCommands,
} from "../packages/ai/media-analysis/planning";
import { applyEditPreview } from "../packages/ai/editor-agent/execution";
function fixture() {
  const p = newProject("Speech editing", 320, 180);
  const asset = {
    id: "speech-source",
    name: "Speech",
    kind: "video" as const,
    path: "speech.mp4",
    size: 100,
    duration: 10,
    width: 320,
    height: 180,
    fps: 30,
    codec: "h264",
    hasAudio: true,
    fingerprint: "source-v1",
  };
  p.assets = [asset];
  const c = newClip(p.tracks[0].id, 60, 180, "media", asset);
  c.sourceIn = 30;
  p.clips = [c];
  const transcript = transcriptSchema.parse({
    id: "speech-result",
    name: "Speech",
    source: "transcription",
    assetId: asset.id,
    sourceFingerprint: asset.fingerprint,
    language: "en",
    timingQuality: "approximate",
    modelId: "test",
    modelVersion: "1",
    segments: [
      {
        id: "s1",
        startMs: 500,
        endMs: 2500,
        text: "Hello um world",
        words: [
          { text: "Hello", startMs: 500, endMs: 900, confidence: 0.9 },
          { text: "um", startMs: 1100, endMs: 1300, confidence: 0.8 },
          { text: "world", startMs: 1800, endMs: 2400, confidence: 0.95 },
        ],
      },
    ],
  });
  return { p, c, transcript };
}
describe("Source analysis to real edits", () => {
  it("saves word timing and creates trimmed source captions through one preview/apply/undo transaction", () => {
    const { p, c, transcript } = fixture(),
      preview = previewAnalysisCommands(
        p,
        4,
        "Captions",
        transcriptCommands(p, transcript, c.id),
      );
    expect(p.transcripts).toHaveLength(0);
    expect(p.clips).toHaveLength(1);
    const caption = preview.project.clips.find((c) => c.kind === "text")!;
    expect(caption.start).toBe(63);
    expect(caption.duration).toBe(39);
    expect(caption.text.content).toBe("um world");
    const h = new History(p),
      result = h.execute(p, "speech", applyEditPreview(preview, p, 4));
    expect(result.clips).toEqual(preview.project.clips);
    expect(h.past).toHaveLength(1);
    expect(
      parseProject(JSON.parse(JSON.stringify(result))).transcripts,
    ).toEqual([transcript]);
    expect(h.undo(result).clips).toEqual(p.clips);
  });
  it("rejects words outside segments, stale fingerprints and stale previews", () => {
    const { p, c, transcript } = fixture();
    const invalid = structuredClone(transcript);
    invalid.segments[0].words![0].endMs = 9000;
    expect(() => transcriptSchema.parse(invalid)).toThrow();
    const stale = { ...transcript, sourceFingerprint: "replacement" };
    expect(() =>
      previewAnalysisCommands(
        p,
        0,
        "stale",
        transcriptCommands(p, stale, c.id),
      ),
    ).toThrow(/changed/);
    const preview = previewAnalysisCommands(
      p,
      0,
      "speech",
      transcriptCommands(p, transcript),
    );
    expect(() => applyEditPreview(preview, p, 1)).toThrow(/changed/);
  });
  it("maps source selection to trimmed instance and ripples all tracks without changing source timing", () => {
    const { p, c } = fixture();
    const track = newTrack("video", 2),
      title = newClip(track.id, 180, 60, "text");
    p.tracks.push(track);
    p.clips.push(title);
    c.keyframes.x = [
      { frame: 0, value: 0, easing: "linear" },
      { frame: 120, value: 120, easing: "linear" },
    ];
    const ranges = sourceToTimelineRanges(p, c.id, [
      { startMs: 2000, endMs: 3000 },
    ]);
    expect(ranges).toEqual([{ startFrame: 90, endFrame: 120 }]);
    const preview = previewAnalysisCommands(p, 0, "Remove pause", [
      { tool: "timeline.rippleDelete", ranges, prefix: "split" },
    ]);
    const h = new History(p),
      result = h.execute(p, "cut", applyEditPreview(preview, p, 0));
    expect(result.clips).toEqual(preview.project.clips);
    const fragments = result.clips
      .filter((x) => x.assetId === c.assetId)
      .sort((a, b) => a.start - b.start);
    expect(fragments.map((x) => [x.start, x.duration, x.sourceIn])).toEqual([
      [60, 30, 30],
      [90, 120, 90],
    ]);
    expect(fragments[1].keyframes.x[0].frame).toBe(-60);
    expect(result.clips.find((x) => x.id === title.id)?.start).toBe(150);
    expect(h.undo(result).clips).toEqual(p.clips);
  });
  it("rejects ripple changes to locked or dependent tracks atomically", () => {
    const { p } = fixture();
    p.tracks[0].locked = true;
    const h = new History(p);
    expect(() =>
      h.execute(
        p,
        "cut",
        rippleDeleteRanges([{ startFrame: 90, endFrame: 120 }]),
      ),
    ).toThrow(/Unlock/);
    expect(h.past).toHaveLength(0);
    expect(p.clips[0].duration).toBe(180);
  });
  it("offers evidence-based filler candidates and only snaps to actual nearby beats", () => {
    const { transcript } = fixture();
    expect(fillerCandidates(transcript).map((x) => x.text)).toEqual(["um"]);
    expect(fillerCandidates({ ...transcript, language: "hi" })).toEqual([]);
    const beats = [
      { timeMs: 500, strength: 0.8 },
      { timeMs: 1000, strength: 0.3 },
    ];
    expect(nearestBeat(beats, 540)?.timeMs).toBe(500);
    expect(nearestBeat(beats, 2000)).toBeNull();
    expect(nearestBeat(beats, 990, 100, 0.7)).toBeNull();
  });
});
