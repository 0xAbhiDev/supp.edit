import { describe, expect, it } from "vitest";
import { newProject, newClip, parseProject } from "../packages/project-schema";
import { newMask, bezierMaskSchema } from "../packages/masks/model";
import { resolveMask, maskPath } from "../packages/masks/evaluate";
import { insertVertex } from "../packages/masks/geometry";
import { History, splitClip, trimClip } from "../packages/commands";
import {
  addMask,
  setMaskProperty,
  toggleMaskKey,
  setMaskVertices,
  clearMaskAnimation,
  deleteMask,
  reorderMask,
} from "../packages/commands/masks";
function fixture() {
  const p = newProject("Masks", 320, 180),
    c = newClip(p.tracks[0].id, 0, 100, "shape"),
    m = newMask();
  p.clips = [c];
  c.masks = [m];
  return { p, c, m, h: new History(p) };
}
describe("Bezier masks", () => {
  it("subdivides cubic geometry without changing the curve", () => {
    const m = newMask("ellipse"),
      points = insertVertex(m.vertices, 0);
    const sample = (
      a: (typeof points)[number],
      b: (typeof points)[number],
      t: number,
    ) => {
      const result = { x: 0, y: 0 };
      for (const axis of ["x", "y"] as const)
        result[axis] =
          (1 - t) ** 3 * a[axis] +
          3 * (1 - t) ** 2 * t * (a[axis] + a.out[axis]) +
          3 * (1 - t) * t * t * (b[axis] + b.in[axis]) +
          t ** 3 * b[axis];
      return result;
    };
    for (let step = 0; step <= 20; step++) {
      const t = step / 20,
        before = sample(m.vertices[0], m.vertices[1], t),
        after =
          t <= 0.5
            ? sample(points[0], points[1], t * 2)
            : sample(points[1], points[2], (t - 0.5) * 2);
      expect(after.x).toBeCloseTo(before.x, 12);
      expect(after.y).toBeCloseTo(before.y, 12);
    }
    expect(points).toHaveLength(5);
    expect(new Set(points.map((v) => v.id)).size).toBe(5);
  });
  it("migrates old files, preserves cubic handles and rejects invalid paths", () => {
    const { p, m } = fixture();
    m.vertices[0].out = { x: 0.1, y: -0.2 };
    const saved = JSON.stringify(p),
      parsed = parseProject(JSON.parse(saved));
    expect(parsed.clips[0].masks).toEqual([m]);
    const firstControl = maskPath(m.vertices, 320, 180)
      .match(/C([^ ]+)/)![1]
      .split(",")
      .map(Number);
    expect(firstControl[0]).toBe(112);
    expect(firstControl[1]).toBeCloseTo(9);
    const old = JSON.parse(saved);
    old.schemaVersion = 4;
    delete old.clips[0].masks;
    expect(parseProject(old).clips[0].masks).toEqual([]);
    expect(old.schemaVersion).toBe(4);
    const bad = structuredClone(m);
    bad.vertices[1].id = bad.vertices[0].id;
    expect(() => bezierMaskSchema.parse(bad)).toThrow(/Duplicate/);
    bad.vertices = structuredClone(m.vertices);
    bad.pathKeys = [
      { frame: 0, easing: "linear", vertices: [...m.vertices].reverse() },
    ];
    expect(() => bezierMaskSchema.parse(bad)).toThrow(/topology/);
    expect(() =>
      parseProject({ ...p, clips: [{ ...p.clips[0], kind: "null" }] }),
    ).toThrow(/visual/);
  });
  it("interpolates paths and relative tangents with linear/hold keys, clamps scalar overshoot", () => {
    const { m } = fixture(),
      a = structuredClone(m.vertices),
      b = structuredClone(a);
    b[0].x = 0.75;
    b[0].out.x = 0.2;
    m.pathKeys = [
      { frame: 20, easing: "hold", vertices: b },
      { frame: 0, easing: "linear", vertices: a },
    ];
    expect(resolveMask(m, 10).vertices[0].x).toBe(0.5);
    expect(resolveMask(m, 10).vertices[0].out.x).toBe(0.1);
    expect(resolveMask(m, -1).vertices).toEqual(a);
    expect(resolveMask(m, 30).vertices).toEqual(b);
    m.pathKeys[1].easing = "hold";
    expect(resolveMask(m, 10).vertices).toEqual(a);
    m.keyframes.opacity = [
      { frame: 0, value: 0, easing: "bezier", outHandle: { x: 0.2, y: 100 } },
      { frame: 20, value: 1, easing: "linear" },
    ];
    expect(resolveMask(m, 10).opacity).toBe(1);
  });
  it("edits through history, auto-keys an animated path, rejects topology change atomically", () => {
    let { p, c, m, h } = fixture();
    p = h.execute(p, "key", toggleMaskKey(c.id, m.id, "path", 0));
    const changed = structuredClone(m.vertices);
    changed[0].x = 0.6;
    p = h.execute(p, "path", setMaskVertices(c.id, m.id, changed, 30));
    expect(p.clips[0].masks[0].pathKeys).toHaveLength(2);
    expect(() =>
      h.execute(p, "bad", setMaskVertices(c.id, m.id, changed.slice(1), 30)),
    ).toThrow(/topology/);
    expect(h.past).toHaveLength(2);
    p = h.undo(p);
    expect(p.clips[0].masks[0].pathKeys).toHaveLength(1);
    p = h.redo(p);
    expect(p.clips[0].masks[0].pathKeys[1].vertices[0].x).toBe(0.6);
    p = h.execute(p, "clear", clearMaskAnimation(c.id, m.id, 15));
    expect(p.clips[0].masks[0].pathKeys).toHaveLength(0);
    expect(p.clips[0].masks[0].vertices[0].x).toBeCloseTo(0.425);
    p = h.execute(p, "feather key", toggleMaskKey(c.id, m.id, "feather", 0));
    p = h.execute(p, "feather", setMaskProperty(c.id, m.id, "feather", 20, 30));
    expect(resolveMask(p.clips[0].masks[0], 15).feather).toBe(10);
    expect(() =>
      h.execute(
        p,
        "bad range",
        setMaskProperty(c.id, m.id, "feather", 300, 30),
      ),
    ).toThrow();
  });
  it("split and trim preserve path/scalar samples at the original timeline time", () => {
    let { p, c, m, h } = fixture();
    m.pathKeys = [
      { frame: 0, easing: "linear", vertices: structuredClone(m.vertices) },
      {
        frame: 60,
        easing: "linear",
        vertices: m.vertices.map((v) => ({ ...v, x: v.x + 0.1 })),
      },
    ];
    m.keyframes.opacity = [
      { frame: 0, value: 0.2, easing: "ease-in-out" },
      { frame: 90, value: 1, easing: "linear" },
    ];
    const original = resolveMask(m, 45);
    p = h.execute(p, "split", splitClip(c.id, 30));
    expect(resolveMask(p.clips[1].masks[0], 15)).toMatchObject({
      vertices: original.vertices,
      opacity: original.opacity,
    });
    p = h.execute(p, "trim", trimClip(p.clips[1].id, "in", 40));
    expect(resolveMask(p.clips[1].masks[0], 5)).toMatchObject({
      vertices: original.vertices,
      opacity: original.opacity,
    });
    expect(parseProject(JSON.parse(JSON.stringify(p))).clips).toEqual(p.clips);
  });
  it("orders masks, deletes undoably, and refuses locked edits", () => {
    let { p, c, m, h } = fixture();
    const second = newMask("ellipse");
    p = h.execute(p, "add", addMask(c.id, second));
    p = h.execute(p, "order", reorderMask(c.id, second.id, -1));
    expect(p.clips[0].masks.map((m) => m.id)).toEqual([second.id, m.id]);
    p = h.execute(p, "delete", deleteMask(c.id, m.id));
    p = h.undo(p);
    expect(p.clips[0].masks).toHaveLength(2);
    p = h.execute(p, "lock", (p) => {
      p.tracks[0].locked = true;
    });
    expect(() => h.execute(p, "add locked", addMask(c.id, newMask()))).toThrow(
      /unlocked/,
    );
  });
});
