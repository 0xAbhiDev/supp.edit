import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  newTrack,
  parseProject,
} from "../packages/project-schema";
import { History, setProperty } from "../packages/commands";
import {
  createComposition,
  inComposition,
  precompose,
  addCompositionLayer,
  deleteComposition,
  compositionView,
} from "../packages/commands/compositions";
import { buildRenderGraph } from "../packages/engine/render-graph";
import { useEditor } from "../packages/editor-state";

describe("composition graph", () => {
  it("keeps video visible when an audio track is soloed", () => {
    const p = newProject();
    const video = p.tracks.find((t) => t.kind === "video")!;
    p.tracks.find((t) => t.kind === "audio")!.solo = true;
    const clip = newClip(video.id, 0, 30, "shape");
    p.clips.push(clip);
    expect(buildRenderGraph(p, 0).layers.map((l) => l.clip.id)).toContain(
      clip.id,
    );
  });
  it("returns to main when undo removes the active composition", () => {
    const editor = useEditor.getState();
    editor.load(newProject());
    editor.executeScoped("Create", createComposition("Child", 30, "child"));
    editor.setComposition("child");
    editor.undo();
    expect(useEditor.getState().activeComposition).toBeNull();
    editor.executeScoped("Title", (p) =>
      p.clips.push(newClip(p.tracks[0].id, 0, 30, "text")),
    );
    expect(useEditor.getState().project.clips).toHaveLength(1);
    expect(useEditor.getState().error).toBeNull();
  });
  it("migrates old files without modifying originals", () => {
    const old = JSON.parse(JSON.stringify(newProject()));
    old.schemaVersion = 1;
    delete old.compositions;
    delete old.transcripts;
    const copy = JSON.stringify(old),
      p = parseProject(old);
    expect(p.schemaVersion).toBe(6);
    expect(p.compositions).toEqual([]);
    expect(p.transcripts).toEqual([]);
    expect(JSON.stringify(old)).toBe(copy);
  });
  it("precomposes a stack, preserves order, animation and local timing, and undoes", () => {
    let p = newProject(),
      track = newTrack("video", 2);
    p.tracks.unshift(track);
    const a = newClip(track.id, 20, 60, "text"),
      b = newClip(p.tracks[1].id, 30, 40, "shape");
    a.keyframes.x = [
      { frame: 0, value: 10, easing: "bezier", outHandle: { x: 0.3, y: 25 } },
    ];
    p.clips = [a, b];
    const initial = p,
      h = new History(p);
    p = h.execute(
      p,
      "Precompose",
      inComposition(null, precompose([a.id, b.id], "Title", "comp")),
    );
    expect(p.clips).toHaveLength(1);
    expect(p.clips[0].start).toBe(20);
    expect(p.compositions[0].duration).toBe(60);
    expect(p.compositions[0].layers.map((c) => c.start)).toEqual([0, 10]);
    expect(p.compositions[0].layers[0].keyframes).toEqual(a.keyframes);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(h.undo(p)).toEqual(initial);
    expect(h.redo(initial)).toEqual(p);
  });
  it("scopes ordinary animated commands and rejects cycles atomically", () => {
    let p = newProject(),
      h = new History(p);
    p = h.execute(
      p,
      "new",
      inComposition(null, createComposition("A", 150, "a")),
    );
    p = h.execute(
      p,
      "new",
      inComposition(null, createComposition("B", 150, "b")),
    );
    p = h.execute(p, "instance", inComposition("a", addCompositionLayer("b")));
    const before = p;
    expect(() =>
      h.execute(p, "cycle", inComposition("b", addCompositionLayer("a"))),
    ).toThrow(/Cyclic|nesting/);
    expect(p).toBe(before);
    const child = p.compositions[0].layers[0];
    p = h.execute(
      p,
      "key",
      inComposition("a", (d) => {
        d.clips[0].keyframes.x = [{ frame: 0, value: 0, easing: "linear" }];
        setProperty(child.id, "x", 50, 20)(d);
      }),
    );
    expect(p.compositions[0].layers[0].keyframes.x).toHaveLength(2);
    expect(p.clips).toHaveLength(0);
    expect(() => h.execute(p, "delete", deleteComposition("b"))).toThrow(
      /instances/,
    );
    expect(compositionView(p, "a")).toBe(compositionView(p, "a"));
  });
  it("maps parent source-in to child seconds and separates repeated instances", () => {
    let p = newProject(),
      h = new History(p);
    p = h.execute(
      p,
      "new",
      inComposition(null, createComposition("Child", 120, "a")),
    );
    p = h.execute(
      p,
      "configure",
      inComposition("a", (d) => {
        d.settings = { ...d.settings, fps: { num: 60, den: 1 } };
        d.clips.push(newClip(d.tracks[0].id, 0, 120, "shape"));
      }),
    );
    p = h.execute(
      p,
      "instance",
      inComposition(null, addCompositionLayer("a", 10)),
    );
    p = h.execute(
      p,
      "trim",
      inComposition(null, (d) => {
        d.clips[0].sourceIn = 15;
        d.clips[0].duration = 45;
      }),
    );
    const graph = buildRenderGraph(p, 25);
    expect(graph.layers[0].child?.frame).toBe(60);
    expect(graph.layers[0].child?.layers).toHaveLength(1);
    expect(buildRenderGraph(p, 55).layers).toHaveLength(0);
  });
  it("rejects broken references, invalid durations, duplicated IDs, and locked precompose", () => {
    const p = newProject();
    p.clips = [newClip(p.tracks[0].id, 0, 30, "composition")];
    expect(() => parseProject(p)).toThrow(/composition/);
    p.clips = [newClip(p.tracks[0].id, 0, 30, "shape")];
    p.tracks[0].locked = true;
    expect(() =>
      new History(p).execute(p, "precomp", precompose([p.clips[0].id], "X")),
    ).toThrow(/Unlock/);
    p.clips[0].id = p.id;
    expect(() => parseProject(p)).toThrow(/Duplicate/);
  });
});
