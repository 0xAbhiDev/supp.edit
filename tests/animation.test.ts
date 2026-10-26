import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  parseProject,
  type Keyframe,
} from "../packages/project-schema";
import {
  evaluate,
  speed,
  resolveClip,
  segmentHandles,
  sortedKeys,
  animationMetrics,
  propertyNames,
} from "../packages/animation";
import {
  History,
  addKey,
  enableAnimation,
  setProperty,
  moveKeys,
  copyKeys,
  pasteKeys,
  removeKeys,
  setInterpolation,
  setHandle,
  splitClip,
} from "../packages/commands";
import fixture from "./fixtures/project.supp?raw";
const keys = (easing: Keyframe["easing"]): Keyframe[] => [
  { frame: 0, value: 0, easing },
  { frame: 100, value: 100, easing: "linear" },
];
function setup() {
  const p = newProject("Animation", 320, 180);
  p.clips.push(newClip(p.tracks[0].id, 0, 120, "shape"));
  return p;
}
describe("shared animation engine", () => {
  it("evaluates all easing modes, boundaries, hold and signed speed", () => {
    expect(evaluate(keys("linear"), 25, 9)).toBe(25);
    expect(evaluate(keys("hold"), 99, 9)).toBe(0);
    expect(evaluate(keys("hold"), 100, 9)).toBe(100);
    expect(evaluate(keys("ease-in"), 25, 9)).toBe(1.5625);
    expect(evaluate(keys("ease-out"), 25, 9)).toBe(57.8125);
    expect(evaluate(keys("ease-in-out"), 50, 9)).toBe(50);
    for (const mode of ["bezier", "continuous-bezier"] as const)
      expect(evaluate(keys(mode), 25, 9)).toBeCloseTo(25, 6);
    expect(evaluate(keys("auto-bezier"), 25, 9)).toBeCloseTo(15.625, 6);
    expect(evaluate(keys("bezier"), -10, 9)).toBe(0);
    expect(evaluate(keys("bezier"), 110, 9)).toBe(100);
    expect(speed(keys("linear"), 25, 0, 30)).toBeCloseTo(30, 6);
    expect(speed(keys("hold"), 25, 0, 30)).toBe(0);
    const reverse = keys("linear").map((k) => ({ ...k, value: 100 - k.value }));
    expect(speed(reverse, 25, 0, 30)).toBeCloseTo(-30, 6);
  });
  it("inverts Bezier time rather than treating time as curve parameter", () => {
    const k = keys("bezier");
    k[0].outHandle = { x: 0.8, y: 0 };
    k[1].inHandle = { x: 0.1, y: 0 };
    expect(evaluate(k, 50, 0)).toBeLessThan(30);
    k[0].outHandle = { x: 0.2, y: 180 };
    k[1].inHandle = { x: 0.2, y: 80 };
    expect(evaluate(k, 50, 0)).toBeGreaterThan(100);
    k[0].outHandle.x = 1;
    k[1].inHandle.x = 1;
    const h = segmentHandles(k, 0);
    expect(h.out.x + h.in.x).toBeLessThanOrEqual(1);
    for (let f = 0; f <= 100; f++)
      expect(Number.isFinite(evaluate(k, f, 0))).toBe(true);
  });
  it("auto tangents do not overshoot peaks or unequal intervals", () => {
    const k: Keyframe[] = [
      { frame: 0, value: 0, easing: "auto-bezier" },
      { frame: 3, value: 100, easing: "auto-bezier" },
      { frame: 100, value: 30, easing: "auto-bezier" },
    ];
    for (let f = 0; f <= 100; f += 0.1) {
      const v = evaluate(k, f, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
  it("only caches immutable arrays and clamps resolved property domains", () => {
    const k = keys("linear");
    evaluate(k, 25, 0);
    k[1].frame = 50;
    expect(evaluate(k, 25, 0)).toBe(50);
    Object.freeze(k);
    sortedKeys(k);
    const hits = animationMetrics.sortedCacheHits;
    sortedKeys(k);
    expect(animationMetrics.sortedCacheHits).toBe(hits + 1);
    const c = setup().clips[0];
    for (const key of propertyNames)
      c.keyframes[key] = [{ frame: 0, value: -99999, easing: "linear" }];
    const r = resolveClip(c, 0);
    expect(r.transform.scaleX).toBe(0.01);
    expect(r.transform.opacity).toBe(0);
    expect(r.effects.blur).toBe(0);
    expect(r.crop.cropLeft).toBe(0);
  });
  it("migrates v1 without mutating input and rejects invalid tangents", () => {
    const old = JSON.parse(fixture);
    old.clips = [
      JSON.parse(JSON.stringify(newClip(old.tracks[0].id, 0, 120, "shape"))),
    ];
    delete old.clips[0].transform.scaleX;
    delete old.clips[0].transform.scaleY;
    delete old.clips[0].transform.anchorX;
    delete old.clips[0].transform.anchorY;
    delete old.clips[0].crop;
    for (const key of propertyNames)
      if (!["x", "y", "scale", "opacity"].includes(key))
        delete old.clips[0].keyframes[key];
    const copy = JSON.stringify(old),
      p = parseProject(old);
    expect(JSON.stringify(old)).toBe(copy);
    expect(p.schemaVersion).toBe(5);
    expect(p.clips[0].transform.scaleX).toBe(1);
    expect(p.clips[0].crop.cropLeft).toBe(0);
    p.clips[0].keyframes.rotation = [
      { frame: 0, value: 20, easing: "bezier", outHandle: { x: 1.1, y: 0 } },
    ];
    expect(() => parseProject(p)).toThrow();
  });
  it("opens native generated layers with legacy null asset IDs", () => {
    const p = JSON.parse(JSON.stringify(setup()));
    p.clips[0].assetId = null;
    expect(parseProject(p).clips[0].assetId).toBeUndefined();
    p.schemaVersion = 1;
    expect(parseProject(p).schemaVersion).toBe(5);
  });
  it("commands animate all channels, retain values when disabled, undo and reload", () => {
    let p = setup();
    const h = new History(p),
      id = p.clips[0].id;
    for (const key of propertyNames) {
      p = h.execute(p, "enable", enableAnimation(id, key, true, 0));
      p = h.execute(p, "set", setProperty(id, key, 0.5, 50));
      expect(p.clips[0].keyframes[key]).toHaveLength(2);
    }
    const saved = parseProject(JSON.parse(JSON.stringify(p)));
    expect(saved).toEqual(p);
    const value = resolveClip(p.clips[0], 25).effects.blur;
    p = h.execute(p, "disable", enableAnimation(id, "blur", false, 25));
    expect(p.clips[0].effects.blur).toBe(value);
    expect(p.clips[0].keyframes.blur).toHaveLength(0);
    p = h.undo(p);
    expect(p.clips[0].keyframes.blur).toHaveLength(2);
    p = h.redo(p);
    expect(p.clips[0].keyframes.blur).toHaveLength(0);
  });
  it("moves selections atomically, rejects collisions, copies tangents and respects locks", () => {
    let p = setup();
    const h = new History(p),
      id = p.clips[0].id;
    p.clips[0].keyframes.x = keys("bezier");
    p.clips[0].keyframes.x[0].outHandle = { x: 0.2, y: 30 };
    const refs = [{ property: "x" as const, frame: 0 }];
    expect(() => h.execute(p, "bad move", moveKeys(id, refs, 100))).toThrow(
      /already/,
    );
    expect(p.clips[0].keyframes.x[0].frame).toBe(0);
    expect(h.past).toHaveLength(0);
    p = h.execute(p, "existing key", addKey(id, "x", 0));
    expect(p.clips[0].keyframes.x[0].easing).toBe("bezier");
    const copied = copyKeys(p.clips[0], refs);
    p = h.execute(p, "paste", pasteKeys(id, copied, 30));
    expect(p.clips[0].keyframes.x[1].outHandle).toEqual({ x: 0.2, y: 30 });
    p = h.execute(
      p,
      "move",
      moveKeys(id, [{ property: "x", frame: 30 }], 10, 5),
    );
    expect(p.clips[0].keyframes.x[1].value).toBe(5);
    p = h.execute(p, "delete", removeKeys(id, [{ property: "x", frame: 40 }]));
    expect(p.clips[0].keyframes.x).toHaveLength(2);
    p = h.execute(p, "lock", (p) => {
      p.tracks[0].locked = true;
    });
    const before = p;
    p = h.execute(p, "blocked", moveKeys(id, refs, 5));
    expect(p).toBe(before);
  });
  it("links continuous tangents in value/frame space and preserves split curves", () => {
    let p = setup();
    const h = new History(p),
      id = p.clips[0].id;
    p.clips[0].keyframes.x = [
      { frame: 0, value: 0, easing: "continuous-bezier" },
      { frame: 30, value: 40, easing: "continuous-bezier" },
      { frame: 100, value: 100, easing: "linear" },
    ];
    p = h.execute(
      p,
      "tangent",
      setHandle(id, { property: "x", frame: 30 }, "outHandle", {
        x: 0.3,
        y: 20,
      }),
    );
    const k = p.clips[0].keyframes.x[1];
    expect(-k.inHandle!.y / (k.inHandle!.x * 30)).toBeCloseTo(
      k.outHandle!.y / (k.outHandle!.x * 70),
      6,
    );
    const before = resolveClip(p.clips[0], 70).transform.x;
    p = h.execute(p, "split", splitClip(id, 50));
    expect(resolveClip(p.clips[1], 70).transform.x).toBeCloseTo(before, 6);
    p = h.execute(
      p,
      "ease",
      setInterpolation(p.clips[1].id, [{ property: "x", frame: -20 }], "hold"),
    );
    expect(p.clips[1].keyframes.x[1].easing).toBe("hold");
  });
});
