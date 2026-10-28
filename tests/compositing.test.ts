import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  newTrack,
  parseProject,
} from "../packages/project-schema";
import { History, deleteClip } from "../packages/commands";
import {
  setMatte,
  setBlendMode,
  matteCandidates,
} from "../packages/commands/compositing";
import {
  precompose,
  inComposition,
  compositionView,
} from "../packages/commands/compositions";
import { buildRenderGraph } from "../packages/engine/render-graph";
import { snapshotContext } from "../packages/ai/context";
import { newMask } from "../packages/masks/model";
function fixture() {
  const p = newProject("Mattes", 320, 180),
    track = newTrack("video", 2),
    a = newClip(p.tracks[0].id, 0, 60, "shape"),
    b = newClip(track.id, 0, 30, "shape");
  a.id = "consumer";
  b.id = "source";
  p.tracks.push(track);
  p.clips = [a, b];
  return { p, a, b, h: new History(p) };
}
describe("Track mattes and blends", () => {
  it("projects new compositing metadata into an immutable AI context without copying editable geometry", () => {
    const { p, a, b } = fixture();
    a.matte = { layerId: b.id, mode: "alpha" };
    a.blendMode = "screen";
    a.masks = [newMask()];
    const context = snapshotContext(p, 0, { selectedLayerId: a.id });
    expect(context.bezierMasks[0]).toMatchObject({
      layerId: a.id,
      vertexCount: 4,
      pathKeyCount: 0,
    });
    expect(context.compositing[0]).toEqual({
      layerId: a.id,
      blendMode: "screen",
      matte: { layerId: b.id, mode: "alpha" },
    });
    expect(Object.isFrozen(context.compositing[0].matte)).toBe(true);
    expect(Object.isFrozen(a.matte)).toBe(false);
    expect(JSON.stringify(context.bezierMasks)).not.toContain("vertices");
  });
  it("migrates v5 defaults without mutation and roundtrips actual matte references", () => {
    const { p, a } = fixture();
    const old = JSON.parse(JSON.stringify(p));
    old.schemaVersion = 5;
    delete old.clips[0].blendMode;
    expect(parseProject(old).clips[0].blendMode).toBe("normal");
    expect(old.schemaVersion).toBe(5);
    a.matte = { layerId: "source", mode: "luma-inverted" };
    a.blendMode = "overlay";
    expect(parseProject(JSON.parse(JSON.stringify(p))).clips).toEqual(p.clips);
  });
  it("edits and undoes atomically, rejecting dangling/cyclic/locked references", () => {
    let { p, a, b, h } = fixture();
    p = h.execute(p, "Matte", setMatte(a.id, { layerId: b.id, mode: "alpha" }));
    expect(() =>
      h.execute(p, "cycle", setMatte(b.id, { layerId: a.id, mode: "alpha" })),
    ).toThrow(/Cyclic/);
    expect(() => h.execute(p, "delete", deleteClip(b.id))).toThrow(
      /matte references/,
    );
    expect(matteCandidates(p, b.id)).toEqual([]);
    p = h.execute(p, "blend", setBlendMode(a.id, "multiply"));
    p = h.undo(p);
    expect(p.clips[0].blendMode).toBe("normal");
    p = h.undo(p);
    expect(p.clips[0].matte).toBeUndefined();
    p = h.redo(p);
    p = h.execute(p, "lock", (p) => {
      p.tracks[0].locked = true;
    });
    expect(() => h.execute(p, "locked", setMatte(a.id, undefined))).toThrow(
      /Unlock/,
    );
  });
  it("requires closed precompose dependencies and supports scoped matte editing", () => {
    let { p, a, b, h } = fixture();
    p = h.execute(p, "Matte", setMatte(a.id, { layerId: b.id, mode: "alpha" }));
    expect(() => h.execute(p, "partial", precompose([a.id], "Bad"))).toThrow(
      /matte source/,
    );
    // Keep the visual stack contiguous.
    p = h.execute(p, "tracks", (p) => {
      p.tracks = p.tracks.filter((t) => t.kind === "video");
    });
    p = h.execute(p, "all", precompose([a.id, b.id], "Nested", "nested"));
    p = h.execute(
      p,
      "nested",
      inComposition("nested", setMatte(a.id, { layerId: b.id, mode: "luma" })),
    );
    expect(compositionView(p, "nested").clips[0].matte?.mode).toBe("luma");
    expect(parseProject(p).compositions).toHaveLength(1);
  });
  it("includes hidden active matte dependencies and suppresses direct output", () => {
    const { p, a, b } = fixture();
    a.matte = { layerId: b.id, mode: "alpha" };
    p.tracks.find((t) => t.id === b.trackId)!.hidden = true;
    const graph = buildRenderGraph(p, 10);
    expect(graph.layers.map((l) => [l.clip.id, l.output])).toEqual([
      ["consumer", true],
      ["source", false],
    ]);
    expect(buildRenderGraph(p, 40).layers.map((l) => l.clip.id)).toEqual([
      "consumer",
    ]);
  });
  it("rejects missing, audio, Null, excessive depth and invalid blend modes", () => {
    const { p, a, b } = fixture();
    a.matte = { layerId: "missing", mode: "alpha" };
    expect(() => parseProject(p)).toThrow(/Matte/);
    a.matte.layerId = b.id;
    b.kind = "null";
    expect(() => parseProject(p)).toThrow(/Matte/);
    b.kind = "shape";
    a.blendMode = "unknown" as never;
    expect(() => parseProject(p)).toThrow();
    a.blendMode = "normal";
    const chain = Array.from({ length: 34 }, (_, i) => ({
      ...newClip(a.trackId, 0, 60, "shape"),
      id: "c" + i,
      ...(i < 33
        ? { matte: { layerId: "c" + (i + 1), mode: "alpha" as const } }
        : {}),
    }));
    p.clips = chain;
    expect(() => parseProject(p)).toThrow(/32/);
    p.clips = chain.slice(1);
    expect(() => parseProject(p)).not.toThrow();
  });
});
