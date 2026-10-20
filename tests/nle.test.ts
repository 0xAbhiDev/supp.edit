import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  newTrack,
  parseProject,
  type Asset,
  type Project,
} from "../packages/project-schema";
import {
  History,
  rippleTrim,
  rollEdit,
  slipEdit,
  slideEdit,
  sourceEdit,
  animated,
  type Edit,
} from "../packages/commands";
function fixture() {
  const p = newProject("NLE", 320, 180),
    a: Asset = {
      id: "source",
      name: "source",
      kind: "video",
      path: "source.mp4",
      size: 100,
      duration: 20,
      width: 320,
      height: 180,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      fingerprint: "source-1",
    };
  p.assets = [a];
  p.clips = [0, 1, 2].map((i) => {
    const c = newClip(p.tracks[0].id, i * 60, 60, "media", a);
    c.id = `c${i}`;
    c.sourceIn = 60 + i * 60;
    c.keyframes.x = [
      { frame: 0, value: 0, easing: "linear" },
      { frame: 60, value: 120, easing: "linear" },
    ];
    return c;
  });
  return p;
}
function edit(p: Project, op: Edit) {
  const h = new History(p),
    n = h.execute(p, "edit", op);
  expect(parseProject(JSON.parse(JSON.stringify(n)))).toEqual(n);
  expect(h.undo(n)).toEqual(p);
  expect(h.redo(p)).toEqual(n);
  return n;
}
describe("source-aware timeline edits", () => {
  it("ripple trim preserves the track start, moves later clips, and rebases animation", () => {
    const p = fixture(),
      n = edit(p, rippleTrim("c0", "in", 15));
    expect(n.clips.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([
      [0, 45, 75],
      [45, 60, 120],
      [105, 60, 180],
    ]);
    expect(animated(n.clips[0], 0).x).toBe(animated(p.clips[0], 15).x);
  });
  it("ripple end trim leaves other tracks unchanged and clamps to source handles", () => {
    const p = fixture();
    p.tracks.push(newTrack("video", 2));
    p.clips.push({
      ...p.clips[2],
      id: "other",
      trackId: p.tracks[2].id,
      kind: "shape",
      assetId: undefined,
    });
    const n = edit(p, rippleTrim("c0", "out", 10000));
    expect(n.clips[0].duration).toBe(540);
    expect(n.clips[1].start).toBe(540);
    expect(n.clips[3].start).toBe(120);
  });
  it("roll moves one boundary while retaining duration and right-side content", () => {
    const p = fixture(),
      n = edit(p, rollEdit("c0", "out", 80));
    expect(n.clips.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([
      [0, 80, 60],
      [80, 40, 140],
      [120, 60, 180],
    ]);
    expect(animated(n.clips[1], 90).x).toBe(animated(p.clips[1], 90).x);
  });
  it("slip changes only source time, bounded by available footage", () => {
    const p = fixture(),
      n = edit(p, slipEdit("c1", 10000));
    expect(n.clips[1]).toEqual({ ...p.clips[1], sourceIn: 540 });
  });
  it("slide preserves the middle source and outer edit points", () => {
    const p = fixture(),
      n = edit(p, slideEdit("c1", 20));
    expect(n.clips.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([
      [0, 80, 60],
      [80, 60, 120],
      [140, 40, 200],
    ]);
  });
  it("insert splits at the target and preserves the displaced content and animation", () => {
    const p = fixture(),
      n = edit(p, sourceEdit("source", p.tracks[0].id, 20, "insert", 300, 15));
    const right = n.clips.find((c) => c.start === 35)!;
    expect(right.sourceIn).toBe(80);
    expect(right.duration).toBe(40);
    expect(animated(right, 45).x).toBe(animated(p.clips[0], 30).x);
    expect(n.clips.find((c) => c.id === "c1")!.start).toBe(75);
    expect(n.clips.at(-1)!.sourceIn).toBe(300);
  });
  it("overwrite splits both sides of an interior range without shifting later clips", () => {
    const p = fixture(),
      n = edit(
        p,
        sourceEdit("source", p.tracks[0].id, 20, "overwrite", 300, 15),
      );
    expect(n.clips.filter((c) => c.id === "c1")[0]).toEqual(p.clips[1]);
    expect(n.clips.find((c) => c.start === 35)!.sourceIn).toBe(95);
    expect(n.clips.filter((c) => c.start === 0)[0].duration).toBe(20);
    expect(new Set(n.clips.map((c) => c.id)).size).toBe(n.clips.length);
  });
  it("rejects ambiguous overlapping rolls and missing slide neighbors without history mutation", () => {
    const p = fixture(),
      h = new History(p);
    expect(() => h.execute(p, "slide", slideEdit("c0", 5))).toThrow(
      "neighbors",
    );
    p.clips.push({ ...p.clips[0], id: "overlap" });
    expect(() => h.execute(p, "roll", rollEdit("c0", "out", 80))).toThrow(
      "non-overlapping",
    );
    expect(h.past).toHaveLength(0);
  });
  it("respects locks and rejects incompatible source targeting", () => {
    const p = fixture();
    p.tracks[0].locked = true;
    const h = new History(p);
    expect(h.execute(p, "slip", slipEdit("c0", 10))).toBe(p);
    expect(
      h.execute(p, "insert", sourceEdit("source", p.tracks[0].id, 0, "insert")),
    ).toBe(p);
    const audio = p.tracks.find((t) => t.kind === "audio")!;
    expect(() =>
      h.execute(p, "insert", sourceEdit("source", audio.id, 0, "insert")),
    ).toThrow("compatible");
  });
});
