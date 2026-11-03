import { describe, it, expect } from "vitest";
import {
  newProject,
  newClip,
  assetSchema,
  parseProject,
} from "../packages/project-schema";
import { History } from "../packages/commands";
import { addPunchIn } from "../packages/commands/punch-in";
import { setProperty } from "../packages/commands/animation";
import { layerTransforms } from "../packages/animation/affine";
import { frameAestheticCut } from "../packages/ai/rough-cut/framing";
import { buildRoughCut, rankMoments } from "../packages/ai/rough-cut/planner";
import { parseEditBrief } from "../packages/ai/rough-cut/model";
import {
  analysisResultSchema,
  VISION_MODEL_VERSION,
} from "../packages/ai/media-analysis/model";
import {
  previewEditPlan,
  applyEditPreview,
} from "../packages/ai/editor-agent/execution";
import capture from "./fixtures/gym-analysis.json";
describe("Independent aesthetic camera controllers", () => {
  it("keeps camera keys byte-for-byte while zoom keys remain separately editable and undoable", () => {
    const p = newProject("Controllers", 320, 180);
    p.assets = [
      assetSchema.parse(capture.assets.find((a) => a.kind === "video")),
    ];
    const c = newClip(p.tracks[0].id, 0, 60, "media", p.assets[0]);
    c.keyframes.x = [
      { frame: 0, value: -12, easing: "linear" },
      { frame: 59, value: 15, easing: "linear" },
    ];
    c.keyframes.scale = [{ frame: 0, value: 1.7, easing: "linear" }];
    p.clips = [c];
    const h = new History(p),
      zoom = h.execute(p, "Punch", addPunchIn(c.id, "zoom", 0.04, 30));
    expect(zoom.clips[0].keyframes).toEqual(c.keyframes);
    expect(zoom.clips[0].parentId).toBe("zoom");
    expect(layerTransforms(zoom, 0).world(c.id)).toEqual(
      layerTransforms(p, 0).world(c.id),
    );
    expect(layerTransforms(zoom, 30).world(c.id)[0]).toBeCloseTo(1.7 * 1.04);
    const edited = h.execute(
      zoom,
      "Manual zoom",
      setProperty("zoom", "scale", 1.035, 30),
    );
    expect(edited.clips[0].keyframes).toEqual(c.keyframes);
    expect(edited.clips[1].keyframes.scale[1].value).toBe(1.035);
    expect(parseProject(JSON.parse(JSON.stringify(edited)))).toEqual(edited);
    expect(h.undo(edited)).toEqual(zoom);
    expect(h.undo(zoom)).toEqual(p);
  });
  it("builds one atomic framed aesthetic preview with source-mapped sampling (synthetic detector geometry)", async () => {
    const p = newProject("Gym framing integration", 320, 180);
    p.assets = capture.assets.map((a) => assetSchema.parse(a));
    const analyses = capture.analyses.map((a) => analysisResultSchema.parse(a));
    const brief = parseEditBrief(
        "Create a 25-second dark aesthetic gym Reel with music and speed ramps.",
      ),
      evidence = rankMoments(p, analyses, brief);
    const initial = buildRoughCut(
      p,
      0,
      brief,
      evidence,
      p.assets.find((a) => a.kind === "audio")!,
      analyses.find((a) => a.audio)!.audio!.beatMap,
    );
    let samples = 0;
    const cut = await frameAestheticCut(
      p,
      0,
      initial,
      async (asset, sampling) => {
        samples++;
        return {
          assetId: asset.id,
          fingerprint: asset.fingerprint,
          cacheKey: "a".repeat(64),
          algorithm: "subject-samples-1",
          modelVersion: VISION_MODEL_VERSION,
          processing: "LOCAL",
          device: "test geometry",
          width: 640,
          height: 360,
          sampling,
          samples: Array.from(
            { length: Math.ceil((sampling.endMs - sampling.startMs) / 250) },
            (_, i) => ({
              timeMs: sampling.startMs + i * 250,
              people: [
                {
                  confidence: 0.9,
                  bounds: {
                    x: 0.35 + i * 0.001,
                    y: 0.12,
                    width: 0.2,
                    height: 0.76,
                  },
                  whiteTorsoFraction: 0,
                },
              ],
            }),
          ),
        };
      },
      {
        signal: new AbortController().signal,
        checkpoint: async () => {},
        report: () => {},
      },
    );
    expect(samples).toBe(initial.shots.length);
    expect(cut.framedShots).toBe(samples);
    const preview = previewEditPlan(cut.plan, p, 0),
      h = new History(p),
      applied = h.execute(
        p,
        "Apply aesthetic",
        applyEditPreview(preview, p, 0),
      );
    const video = applied.compositions[0].layers.filter(
      (c) => p.assets.find((a) => a.id === c.assetId)?.kind === "video",
    );
    expect(
      video.every((c) => c.keyframes.x.length && c.keyframes.scale.length),
    ).toBe(true);
    expect(video.some((c) => c.timeRemap)).toBe(true);
    expect(h.past).toHaveLength(1);
    expect(h.undo(applied)).toEqual(p);
  });
});
