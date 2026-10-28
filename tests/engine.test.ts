import { describe, it, expect } from "vitest";
import { LruCache } from "../packages/engine/lru";
import { ClipIndex, projectIndex } from "../packages/engine/project-index";
import { newProject, newClip } from "../packages/project-schema";
import { History, moveClip } from "../packages/commands";
import { useEditor } from "../packages/editor-state";
import { freeze } from "immer";
describe("bounded media storage", () => {
  it("evicts the least recently used surface and releases every allocation exactly once", () => {
    const released: string[] = [],
      cache = new LruCache<string, string>(10, 3, (v) => released.push(v));
    cache.set("a", "A", 4);
    cache.set("b", "B", 4);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 4);
    expect(cache.has("b")).toBe(false);
    expect(cache.bytes).toBe(8);
    expect(released).toEqual(["B"]);
    expect(cache.set("huge", "H", 11)).toBe(false);
    expect(cache.bytes).toBe(8);
    cache.clear();
    expect(released.sort()).toEqual(["A", "B", "C", "H"]);
    expect(cache.bytes).toBe(0);
  });
  it("enforces the entry cap independently from byte budget", () => {
    const c = new LruCache<number, number>(1024, 2);
    for (let i = 0; i < 20; i++) c.set(i, i, 1);
    expect(c.size).toBe(2);
    expect(c.evictions).toBe(18);
  });
});
describe("timeline index and history identity", () => {
  it("finds all overlapping clips across gaps and boundaries", () => {
    const p = newProject(),
      a = newClip(p.tracks[0].id, 0, 100, "shape"),
      b = newClip(p.tracks[0].id, 10, 5, "text"),
      c = newClip(p.tracks[0].id, 200, 10, "shape");
    p.clips = [a, b, c];
    const index = new ClipIndex(p.clips);
    expect(index.range(12, 13)).toEqual([a, b]);
    expect(index.range(15, 16)).toEqual([a]);
    expect(index.range(100, 200)).toEqual([]);
    expect(index.range(209, 210)).toEqual([c]);
    freeze(p,true);
    expect(projectIndex(p)).toBe(projectIndex(p));
  });
  it("does not retain stale indices for mutable project builders",()=>{
    const p=newProject(),a=newClip(p.tracks[0].id,0,30,"shape");p.clips=[a];
    expect(projectIndex(p).all.range(0,1)).toHaveLength(1);
    p.clips.push(newClip(p.tracks[0].id,0,30,"shape"));
    expect(projectIndex(p).all.range(0,1)).toHaveLength(2);
    a.start=50;expect(projectIndex(p).all.range(0,1)).toHaveLength(1);
  });
  it("handles 100,000 clips without a whole-array viewport scan", () => {
    const p = newProject();
    p.clips = Array.from({ length: 100000 }, (_, i) =>
      newClip(p.tracks[0].id, i * 10, 5, "shape"),
    );
    const index = new ClipIndex(p.clips);
    const started = performance.now();
    for (let i = 0; i < 1000; i++)
      expect(index.range(900000, 900005)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1500);
  });
  it("tracks saved identity through undo, redo, branching and an asynchronous save", () => {
    const p = newProject(),
      c = newClip(p.tracks[0].id, 0, 30, "shape");
    p.clips = [c];
    useEditor.getState().load(p);
    const s = () => useEditor.getState();
    s().execute("move", moveClip(c.id, 10));
    const saved = s().project;
    s().markSaved(saved);
    expect(s().dirty).toBe(false);
    s().execute("move", moveClip(c.id, 20));
    expect(s().dirty).toBe(true);
    s().undo();
    expect(s().dirty).toBe(false);
    s().redo();
    expect(s().dirty).toBe(true);
    s().markSaved(saved);
    expect(s().dirty).toBe(true);
    s().undo();
    s().execute("branch", moveClip(c.id, 15));
    expect(s().dirty).toBe(true);
    const h = new History(p);
    const a = h.execute(p, "a", moveClip(c.id, 4));
    const version = h.version(a);
    h.undo(a);
    const b = h.execute(p, "b", moveClip(c.id, 8));
    expect(h.version(b)).not.toBe(version);
  });
});
