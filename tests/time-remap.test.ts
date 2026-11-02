import { describe, it, expect } from "vitest";
import {
  assetSchema,
  newProject,
  newClip,
  parseProject,
} from "../packages/project-schema";
import { History, splitClip, trimClip } from "../packages/commands";
import {
  rippleTrim,
  rollEdit,
  slipEdit,
  sourceEdit,
} from "../packages/commands/nle";
import { setTimeRemap, setSpeedKey } from "../packages/commands/time-remap";
import {
  sourceFrameAt,
  speedAt,
  timelineFrameAt,
  type TimeRemap,
} from "../packages/time-remap/model";
const curve: TimeRemap = {
  sourceOffset: 0.25,
  keys: [
    { frame: 0, speed: 2, easing: "smooth" },
    { frame: 60, speed: 0.5, easing: "smooth" },
    { frame: 120, speed: 2, easing: "smooth" },
  ],
};
function setup() {
  const p = newProject("Speed", 320, 180),
    a = assetSchema.parse({
      id: "video",
      name: "Video",
      kind: "video",
      path: "x.mp4",
      size: 1,
      duration: 20,
      width: 320,
      height: 180,
      fps: 60,
      codec: "h264",
      hasAudio: true,
      fingerprint: "source",
    });
  p.assets = [a];
  const c = newClip(p.tracks[0].id, 0, 120, "media", a);
  c.sourceIn = 30;
  c.timeRemap = structuredClone(curve);
  p.clips = [c];
  return { p, c, h: new History(p) };
}
describe("Editable source-time curves", () => {
  it("integrates smooth speed exactly and inverts fractional source times (same native contract)", () => {
    const c = { sourceIn: 0, timeRemap: curve };
    for (const [time, expected] of [
      [0, 0.25],
      [30, 51.8125],
      [60, 75.25],
      [90, 98.6875],
      [120, 150.25],
      [150, 210.25],
    ]) {
      expect(sourceFrameAt(c, time)).toBeCloseTo(expected, 8);
      expect(timelineFrameAt(c, expected)).toBeCloseTo(time, 8);
    }
    for (let time = -60; time <= 180; time += 0.7) {
      expect(timelineFrameAt(c, sourceFrameAt(c, time))).toBeCloseTo(time, 7);
      expect(
        (sourceFrameAt(c, time + 0.001) - sourceFrameAt(c, time - 0.001)) /
          0.002,
      ).toBeCloseTo(speedAt(c, time), 6);
    }
  });
  it("preserves exact sampled positions across split, trim and ripple, including fractional source In", () => {
    const { p, c, h } = setup(),
      split = h.execute(p, "Split", splitClip(c.id, 37)),
      right = split.clips[1];
    for (let f = 0; f < right.duration; f += 0.25)
      expect(sourceFrameAt(right, f)).toBeCloseTo(sourceFrameAt(c, f + 37), 7);
    const trimmed = new History(p).execute(p, "Trim", trimClip(c.id, "in", 37));
    expect(trimmed.clips[0].timeRemap).toEqual(right.timeRemap);
    const rippled = new History(p).execute(
      p,
      "Ripple",
      rippleTrim(c.id, "in", 37),
    );
    expect(rippled.clips[0].start).toBe(0);
    expect(rippled.clips[0].timeRemap).toEqual(right.timeRemap);
    expect(h.undo(split)).toEqual(p);
    expect(h.redo(p)).toEqual(split);
    expect(parseProject(JSON.parse(JSON.stringify(split)))).toEqual(split);
  });
  it("preserves source mapping through overwrite fragments and slip, and respects source limits", () => {
    const { p, c, h } = setup();
    const n = h.execute(
      p,
      "Overwrite",
      sourceEdit("video", c.trackId, 20, "overwrite", 0, 20, "inserted"),
    );
    const right = n.clips.find((c) => c.start === 40)!;
    expect(sourceFrameAt(right, 10)).toBeCloseTo(sourceFrameAt(c, 50), 8);
    const slipped = new History(p).execute(p, "Slip", slipEdit(c.id, 100));
    expect(sourceFrameAt(slipped.clips[0], 50)).toBeCloseTo(
      sourceFrameAt(c, 50) + 100,
      8,
    );
    const extended = new History(p).execute(
      p,
      "Extend",
      trimClip(c.id, "out", 2000),
    );
    expect(
      sourceFrameAt(extended.clips[0], extended.clips[0].duration),
    ).toBeLessThanOrEqual(600);
    const rolled = new History(n).execute(
      n,
      "Roll",
      rollEdit(right.id, "in", 43),
    );
    expect(
      sourceFrameAt(
        rolled.clips.find((x) => x.id === right.id)!,
        0,
      ),
    ).toBeCloseTo(sourceFrameAt(c, 43), 7);
  });
  it("edits keys atomically and rejects nonmonotone, nonfinite, unsupported and out-of-source curves", () => {
    const { p, c, h } = setup();
    const changed = h.execute(p, "Manual speed", setSpeedKey(c.id, 60, 0.65));
    expect(changed.clips[0].timeRemap!.keys[1].speed).toBe(0.65);
    expect(h.undo(changed)).toEqual(p);
    for (const bad of [NaN, Infinity, 0, 5])
      expect(() =>
        new History(p).execute(p, "Invalid", setSpeedKey(c.id, 0, bad)),
      ).toThrow();
    expect(() =>
      setTimeRemap(c.id, {
        sourceOffset: 0,
        keys: [curve.keys[0], curve.keys[0]],
      }),
    ).toThrow();
    const short = structuredClone(p);
    short.assets[0].duration = 5;
    expect(() =>
      new History(short).execute(short, "Too fast", setSpeedKey(c.id, 0, 4)),
    ).toThrow(/exceeds source/);
    const shape = structuredClone(p);
    shape.clips[0].kind = "shape";
    delete shape.clips[0].assetId;
    expect(() => parseProject(shape)).toThrow(/video or audio/);
    const legacy = structuredClone(p) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 9;
    expect(parseProject(legacy).schemaVersion).toBe(10);
  });
});
