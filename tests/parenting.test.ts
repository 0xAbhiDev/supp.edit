import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  newTrack,
  parseProject,
} from "../packages/project-schema";
import { History, deleteClip } from "../packages/commands";
import { inComposition, precompose } from "../packages/commands/compositions";
import { setParent } from "../packages/commands/parenting";
import {
  identity,
  inverse,
  multiply,
  point,
  localMatrix,
  layerTransforms,
} from "../packages/animation/affine";

function fixture() {
  const p = newProject("Parent study", 320, 180),
    parent = newClip(p.tracks[0].id, 0, 60, "null"),
    track = newTrack("video", 2),
    child = newClip(track.id, 0, 60, "shape");
  parent.id = "controller";
  parent.name = "Controller";
  parent.transform = {
    ...parent.transform,
    x: 30,
    y: -20,
    scaleX: 2,
    scaleY: 0.6,
    rotation: 35,
    anchorX: 8,
  };
  child.id = "child";
  child.transform = {
    ...child.transform,
    x: -15,
    y: 40,
    rotation: -25,
    anchorY: 4,
  };
  p.tracks.unshift(track);
  p.clips = [parent, child];
  return { p, parent, child };
}
function same(a: number[], b: number[]) {
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 7));
}
describe("affine parenting", () => {
  it("composes affine matrices, inverse and anchors without decomposing shear", () => {
    const { parent, child } = fixture(),
      a = localMatrix(parent, 0),
      b = localMatrix(child, 0),
      m = multiply(a, b);
    same(multiply(inverse(m), m), identity());
    const q = point(b, 13, 21),
      world = point(m, 13, 21);
    expect(point(a, q.x, q.y).x).toBeCloseTo(world.x);
    expect(Math.abs(m[0] * m[2] + m[1] * m[3])).toBeGreaterThan(0.1);
  });
  it("reparents/unparents without moving pixels at the edit frame, preserving keys and undo", () => {
    let { p } = fixture();
    const h = new History(p),
      before = p,
      matrix = layerTransforms(p, 20).world("child");
    p = h.execute(
      p,
      "Parent",
      inComposition(null, setParent("child", "controller", 20)),
    );
    same(layerTransforms(p, 20).world("child"), matrix);
    expect(p.clips[1].parentId).toBe("controller");
    expect(h.undo(p)).toEqual(before);
    expect(h.redo(before)).toEqual(p);
    p = h.execute(
      p,
      "Unparent",
      inComposition(null, setParent("child", null, 20)),
    );
    same(layerTransforms(p, 20).world("child"), matrix);
    expect(p.clips[1].parentId).toBeUndefined();
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it("inherits animated controller transforms outside its visibility interval but not opacity", () => {
    let { p } = fixture();
    p.clips[0].duration = 1;
    p.clips[0].transform.opacity = 0;
    p.clips[0].keyframes.x = [
      { frame: 0, value: 0, easing: "linear" },
      { frame: 60, value: 120, easing: "linear" },
    ];
    p = new History(p).execute(
      p,
      "Parent",
      inComposition(null, setParent("child", "controller", 0, false)),
    );
    const initial = layerTransforms(p, 0).world("child"),
      moved = layerTransforms(p, 30).world("child");
    expect(moved[4] - initial[4]).toBeCloseTo(60);
    expect(p.clips[1].transform.opacity).toBe(1);
  });
  it("rejects cycles, broken links, locked parenting and graph-breaking deletion atomically", () => {
    let { p } = fixture();
    const h = new History(p);
    p = h.execute(
      p,
      "Parent",
      inComposition(null, setParent("child", "controller", 0, false)),
    );
    const before = p,
      count = h.past.length;
    expect(() =>
      h.execute(p, "cycle", setParent("controller", "child", 0)),
    ).toThrow(/cycle/);
    expect(() => h.execute(p, "delete", deleteClip("controller"))).toThrow(
      /Unparent/,
    );
    expect(() =>
      h.execute(p, "arbitrary removal", (d) => {
        d.clips = d.clips.filter((c) => c.id !== "controller");
      }),
    ).toThrow(/Parent/);
    expect(() =>
      h.execute(p, "partial precomp", precompose(["child"], "Bad")),
    ).toThrow(/hierarchy/);
    expect(p).toBe(before);
    expect(h.past).toHaveLength(count);
    const bad = structuredClone(p);
    bad.clips[0].parentId = "child";
    expect(() => parseProject(bad)).toThrow(/Cyclic/);
    bad.clips[0].parentId = "missing";
    expect(() => parseProject(bad)).toThrow(/Parent/);
    const locked = structuredClone(p);
    locked.tracks[0].locked = true;
    expect(() =>
      new History(locked).execute(
        locked,
        "parent",
        setParent("child", null, 0),
      ),
    ).toThrow(/Unlock/);
  });
  it("works inside a scoped composition and migrates v3 without mutating input", () => {
    let { p } = fixture();
    const h = new History(p);
    p = h.execute(
      p,
      "Precompose",
      inComposition(
        null,
        precompose(["child", "controller"], "Nested", "comp"),
      ),
    );
    p = h.execute(
      p,
      "Parent inside",
      inComposition("comp", setParent("child", "controller", 0, false)),
    );
    expect(
      p.compositions[0].layers.find((c) => c.id === "child")?.parentId,
    ).toBe("controller");
    const old = JSON.parse(JSON.stringify(p));
    old.schemaVersion = 3;
    for (const c of old.clips) delete c.parentOffset;
    const saved = JSON.stringify(old),
      next = parseProject(old);
    expect(next.schemaVersion).toBe(7);
    expect(JSON.stringify(old)).toBe(saved);
  });
});
