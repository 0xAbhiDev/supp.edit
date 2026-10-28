import { describe, it, expect } from "vitest";
import { newProject, newClip, parseProject } from "../packages/project-schema";
import { History, splitClip, trimClip } from "../packages/commands";
import {
  addEffect,
  editEffect,
  deleteEffect,
  reorderEffect,
  setEffectValue,
  toggleEffectKey,
} from "../packages/commands/effects";
import { effectStackSchema } from "../packages/effects/model";
import { resolvedEffects, effectValue } from "../packages/effects/evaluate";
import { snapshotContext } from "../packages/ai/context";
function fixture() {
  const p = newProject(),
    c = newClip(p.tracks[0].id, 10, 90, "shape");
  p.clips = [c];
  return { p, c, h: new History() };
}
describe("ordered effects", () => {
  it("migrates old projects and retains repeated ordered effects through roundtrip", () => {
    let { p, c, h } = fixture();
    p = h.execute(p, "add", addEffect(c.id, "brightness"));
    p = h.execute(p, "add", addEffect(c.id, "brightness"));
    expect(parseProject(JSON.parse(JSON.stringify(p))).clips).toEqual(p.clips);
    const old: any = JSON.parse(JSON.stringify(p));
    old.schemaVersion = 6;
    delete old.clips[0].effectStack;
    expect(parseProject(old).clips[0].effectStack).toEqual([]);
  });
  it("orders, bypasses and removes through undo and rejects locked edits", () => {
    let { p, c, h } = fixture();
    p = h.execute(p, "add", addEffect(c.id, "brightness"));
    p = h.execute(p, "add", addEffect(c.id, "contrast"));
    const id = p.clips[0].effectStack[1].id;
    p = h.execute(p, "order", reorderEffect(c.id, id, -1));
    expect(resolvedEffects(p.clips[0], 10).map((e) => e.type)).toEqual([
      "contrast",
      "brightness",
    ]);
    p = h.execute(
      p,
      "bypass",
      editEffect(c.id, id, (e) => {
        e.enabled = false;
      }),
    );
    expect(resolvedEffects(p.clips[0], 10)).toHaveLength(1);
    p = h.execute(p, "delete", deleteEffect(c.id, id));
    p = h.undo(p);
    expect(p.clips[0].effectStack).toHaveLength(2);
    p = h.execute(p, "lock", (p) => {
      p.tracks[0].locked = true;
    });
    expect(() => h.execute(p, "bad", addEffect(c.id, "blur"))).toThrow(
      /unlocked/,
    );
  });
  it("animates, clamps overshoot and preserves samples across split and trim", () => {
    let { p, c, h } = fixture();
    p = h.execute(p, "add", addEffect(c.id, "brightness"));
    const id = p.clips[0].effectStack[0].id;
    p = h.execute(p, "key", toggleEffectKey(c.id, id, 10));
    p = h.execute(p, "value", setEffectValue(c.id, id, 2, 70));
    const before = resolvedEffects(p.clips[0], 55);
    expect(before[0].value).toBeCloseTo(1.75);
    p = h.execute(p, "split", splitClip(c.id, 40));
    expect(resolvedEffects(p.clips[1], 55)).toEqual(before);
    p = h.execute(p, "trim", trimClip(p.clips[1].id, "in", 50));
    expect(resolvedEffects(p.clips[1], 55)).toEqual(before);
    const e = structuredClone(p.clips[0].effectStack[0]);
    e.keys[0].easing = "bezier";
    e.keys[0].outHandle = { x: 0.3, y: 100 };
    expect(effectValue(e, 20)).toBeLessThanOrEqual(3);
  });
  it("rejects duplicate keys/IDs, invalid targets and bounds atomically", () => {
    let { p, c, h } = fixture();
    p = h.execute(p, "add", addEffect(c.id, "blur"));
    const e = p.clips[0].effectStack[0];
    expect(() => effectStackSchema.parse([e, e])).toThrow();
    expect(() =>
      h.execute(
        p,
        "bad",
        editEffect(c.id, e.id, (e) => {
          e.value = 101;
        }),
      ),
    ).toThrow();
    expect(() =>
      h.execute(p, "bad", (p) => {
        p.clips[0].kind = "null";
      }),
    ).toThrow();
    expect(() =>
      effectStackSchema.parse([
        {
          ...e,
          keys: [
            { frame: 0, value: 1, easing: "linear" },
            { frame: 0, value: 2, easing: "linear" },
          ],
        },
      ]),
    ).toThrow();
    expect(h.past).toHaveLength(1);
  });
  it("projects immutable effect context without freezing project data", () => {
    const { p, c } = fixture();
    c.effectStack = [
      { id: "f", type: "contrast", enabled: true, value: 2, keys: [] },
    ];
    const context = snapshotContext(p, 0, { selectedLayerId: c.id });
    expect(context.effectStacks[0].entries[0]).toEqual({
      id: "f",
      type: "contrast",
      enabled: true,
      value: 2,
      keyCount: 0,
    });
    expect(Object.isFrozen(context.effectStacks[0].entries)).toBe(true);
    expect(Object.isFrozen(c.effectStack)).toBe(false);
  });
});
