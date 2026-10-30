import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  parseProject,
  type Asset,
  fps,
  timecode,
} from "../packages/project-schema";
import {
  History,
  splitClip,
  trimClip,
  moveClip,
  deleteClip,
  insertAsset,
  evaluate,
  animated,
  toggleKeyframe,
  setTransform,
} from "../packages/commands";
import fixture from "./fixtures/project.supp?raw";
function setup() {
  const p = newProject("Test"),
    asset: Asset = {
      id: "asset",
      name: "clip.mp4",
      kind: "video",
      path: "clip.mp4",
      size: 1000,
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      fingerprint: "media:1000",
    };
  p.assets.push(asset);
  p.clips.push(newClip(p.tracks[0].id, 0, 300, "media", asset));
  return p;
}
describe("versioned project graph", () => {
  it("round-trips with all edit data", () => {
    const p = setup();
    p.clips[0].effects.blur = 8;
    p.clips[0].mask = {
      type: "ellipse",
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    };
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it("shares a native-compatible contract fixture", () => {
    expect(fps(parseProject(JSON.parse(fixture)))).toBeCloseTo(29.97003);
  });
  it("rejects unknown versions without silent migration", () =>
    expect(() => parseProject({ ...setup(), schemaVersion: 99 })).toThrow(
      "Unsupported project version",
    ));
  it("rejects missing references", () => {
    const p = setup();
    p.assets = [];
    expect(() => parseProject(p)).toThrow("Broken reference");
  });
  it("rejects duplicate IDs and media overrun", () => {
    const p = setup();
    p.clips.push({ ...p.clips[0] });
    expect(() => parseProject(p)).toThrow("Duplicate");
    p.clips.pop();
    p.clips[0].duration = 1000;
    expect(() => parseProject(p)).toThrow("source duration");
  });
  it("uses non-drop timecode labels with rational media timestamps", () => {
    expect(timecode(1800, 30000 / 1001)).toBe("00:01:00:00");
    expect(1800 / (30000 / 1001)).toBeCloseTo(60.06);
  });
});
describe("reversible timeline commands", () => {
  it("splits source offsets with exact undo/redo", () => {
    const h = new History(),
      p = setup(),
      next = h.execute(p, "Split", splitClip(p.clips[0].id, 90));
    expect(next.clips).toHaveLength(2);
    expect(next.clips[1]).toMatchObject({
      start: 90,
      sourceIn: 90,
      duration: 210,
    });
    expect(p.clips[0].duration).toBe(300);
    expect(h.undo(next)).toEqual(p);
    expect(h.redo(p)).toEqual(next);
  });
  it("does not split at an edge", () => {
    const p = setup();
    expect(
      new History().execute(p, "Split", splitClip(p.clips[0].id, 300)),
    ).toBe(p);
  });
  it("clamps trims to source media and a minimum of one frame", () => {
    const h = new History(),
      p = setup();
    let n = h.execute(p, "Trim", trimClip(p.clips[0].id, "out", 900));
    expect(n.clips[0].duration).toBe(300);
    n = h.execute(n, "Trim", trimClip(p.clips[0].id, "in", 70));
    expect(n.clips[0]).toMatchObject({
      start: 70,
      sourceIn: 70,
      duration: 230,
    });
    n = h.execute(n, "Trim", trimClip(p.clips[0].id, "in", 900));
    expect(n.clips[0].duration).toBe(1);
    parseProject(n);
  });
  it("honors track locks for every destructive edit", () => {
    const p = setup(),
      id = p.clips[0].id;
    p.tracks[0].locked = true;
    for (const cmd of [
      splitClip(id, 50),
      trimClip(id, "out", 70),
      moveClip(id, 20),
      deleteClip(id),
      setTransform(id, "x", 50, 0),
    ])
      expect(new History().execute(p, "Locked", cmd)).toBe(p);
  });
  it("ripple delete closes the gap on its own track", () => {
    const p = setup(),
      first = p.clips[0];
    first.duration = 90;
    p.clips.push({
      ...first,
      id: "second",
      start: 90,
      sourceIn: 90,
      duration: 60,
    });
    const n = new History().execute(p, "Ripple", deleteClip(first.id, true));
    expect(n.clips[0]).toMatchObject({ start: 0, sourceIn: 90, duration: 60 });
  });
  it("rejects insertion on incompatible audio tracks", () => {
    const p = setup();
    expect(
      new History().execute(
        p,
        "Insert",
        insertAsset("asset", p.tracks[1].id, 0),
      ),
    ).toBe(p);
  });
  it("invalidates redo after a new edit", () => {
    const h = new History(),
      p = setup(),
      id = p.clips[0].id;
    const n = h.execute(p, "Move", moveClip(id, 30));
    h.undo(n);
    h.execute(p, "Move", moveClip(id, 60));
    expect(h.future).toHaveLength(0);
  });
});
describe("animation continuity", () => {
  it("evaluates linear, hold, and ease", () => {
    expect(
      evaluate(
        [
          { frame: 0, value: 0, easing: "linear" },
          { frame: 100, value: 100, easing: "linear" },
        ],
        25,
        0,
      ),
    ).toBe(25);
    expect(
      evaluate(
        [
          { frame: 0, value: 0, easing: "hold" },
          { frame: 100, value: 100, easing: "linear" },
        ],
        99,
        0,
      ),
    ).toBe(0);
    expect(
      evaluate(
        [
          { frame: 0, value: 0, easing: "ease-in-out" },
          { frame: 100, value: 100, easing: "linear" },
        ],
        25,
        0,
      ),
    ).toBeCloseTo(15.625);
  });
  it("preserves eased motion across splits and trims", () => {
    const p = setup(),
      id = p.clips[0].id;
    p.clips[0].keyframes.x = [
      { frame: 0, value: -100, easing: "ease-in-out" },
      { frame: 200, value: 100, easing: "linear" },
    ];
    const h = new History(),
      n = h.execute(p, "Split", splitClip(id, 80));
    for (let f = 80; f < 200; f++)
      expect(animated(n.clips[1], f).x).toBeCloseTo(
        animated(p.clips[0], f).x,
        10,
      );
    parseProject(n);
    const trimmed = h.execute(p, "Trim", trimClip(id, "in", 50));
    expect(animated(trimmed.clips[0], 100).x).toBeCloseTo(
      animated(p.clips[0], 100).x,
      10,
    );
  });
  it("writes animated values at the playhead and undoes", () => {
    const p = setup(),
      h = new History(),
      id = p.clips[0].id;
    let n = h.execute(p, "Key", toggleKeyframe(id, "x", 0));
    n = h.execute(n, "Move", setTransform(id, "x", 100, 100));
    expect(animated(n.clips[0], 50).x).toBe(50);
    expect(h.undo(n).clips[0].keyframes.x).toHaveLength(1);
  });
});
