import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  parseProject,
  type Asset,
} from "../packages/project-schema";
import { History } from "../packages/commands";
import { addReferenceTransition } from "../packages/commands/reference-transition";
import { layerTransforms, point } from "../packages/animation/affine";
function fixture() {
  const p = newProject("Motion", 640, 360);
  const a: Asset = {
    id: "raw",
    name: "raw.mp4",
    path: "raw.mp4",
    kind: "video",
    width: 640,
    height: 360,
    fps: 30,
    duration: 10,
    size: 1,
    hasAudio: false,
    fingerprint: "test",
    codec: "h264",
  };
  p.assets = [a];
  const left = newClip(p.tracks[0].id, 0, 60, "media", a),
    right = newClip(p.tracks[0].id, 60, 60, "media", a);
  p.clips = [left, right];
  return {
    p,
    left,
    right,
    call: {
      tool: "sequence.transition" as const,
      sequenceId: "main",
      id: "motion",
      trackId: "effects",
      leftId: left.id,
      rightId: right.id,
      before: 6,
      after: 6,
      strength: 0.8,
      direction: "left" as const,
    },
  };
}
describe("motion transition graph and safety", () => {
  for (const kind of ["zoom", "whip", "motion"] as const)
    it(
      kind + " creates editable controllers and preserves source/camera keys",
      () => {
        const { p, left, right, call } = fixture();
        left.keyframes.rotation = [{ frame: 0, value: 0, easing: "linear" }];
        const history = new History(p),
          next = history.execute(
            p,
            kind,
            addReferenceTransition({ ...call, kind }),
          );
        expect(next.clips.filter((c) => c.kind === "null")).toHaveLength(2);
        expect(next.clips[0].keyframes).toEqual(left.keyframes);
        expect(next.clips[0].assetId).toBe(left.assetId);
        expect(next.clips[0].sourceIn).toBe(0);
        const at = layerTransforms(next, 59).world(left.id);
        expect(at[0]).toBeGreaterThan(1);
        if (kind !== "zoom") expect(at[4]).toBeLessThan(0);
        const recovered = history.undo(next);
        expect(recovered).toEqual(p);
        expect(history.redo(recovered).clips).toEqual(next.clips);
        expect(
          JSON.parse(
            JSON.stringify(
              parseProject(JSON.parse(JSON.stringify(next))).clips,
            ),
          ),
        ).toEqual(JSON.parse(JSON.stringify(next.clips)));
        expect(point(layerTransforms(next, 70).world(right.id), 0, 0)).toEqual({
          x: 0,
          y: 0,
        });
      },
    );
  it("falls back to editable blur when a move would crop a protected subject or expose a source edge", () => {
    const { p, left, call } = fixture();
    const next = new History(p).execute(
      p,
      "protected",
      addReferenceTransition({
        ...call,
        kind: "whip",
        protection: [
          {
            clipId: left.id,
            bounds: { x: 0.01, y: 0.2, width: 0.2, height: 0.6 },
          },
        ],
      }),
    );
    expect(next.clips).toHaveLength(2);
    expect(next.clips[0].parentId).toBeUndefined();
    expect(next.clips[0].effectStack[0].id).toContain("-f-");
    const out = new History(p).execute(
      p,
      "zoom out",
      addReferenceTransition({ ...call, kind: "zoom", zoomDirection: "out" }),
    );
    expect(out.clips).toHaveLength(2);
    expect(out.clips[0].effectStack[0].type).toBe("blur");
  });
  it("composes consecutive transitions without replacing earlier controllers", () => {
    const { p, left, right, call } = fixture(),
      third = newClip(p.tracks[0].id, 120, 60, "media", p.assets[0]);
    p.clips.push(third);
    const h = new History(p),
      first = h.execute(
        p,
        "one",
        addReferenceTransition({ ...call, kind: "zoom" }),
      );
    const second = h.execute(
      first,
      "two",
      addReferenceTransition({
        ...call,
        id: "motion2",
        kind: "whip",
        leftId: right.id,
        rightId: third.id,
      }),
    );
    expect(second.clips.filter((c) => c.kind === "null")).toHaveLength(4);
    expect(second.clips.find((c) => c.id === right.id)?.parentId).toBe(
      "motion2-left",
    );
    expect(second.clips.find((c) => c.id === "motion2-left")?.parentId).toBe(
      "motion-right",
    );
    expect(layerTransforms(first, 59).world(left.id)).toEqual(
      layerTransforms(second, 59).world(left.id),
    );
    expect(h.undo(second)).toEqual(first);
  });
});
