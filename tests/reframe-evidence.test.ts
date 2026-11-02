import { it, expect } from "vitest";
import capture from "./fixtures/gym-subjects.json";
import scenarios from "./fixtures/gym-subject-scenarios.json";
import { associate, cameraPath } from "../packages/ai/reframe/tracking";
import { subjectSamplesSchema } from "../packages/ai/reframe/model";
import { parseProject, type Keyframe } from "../packages/project-schema";
import { planReframe } from "../packages/ai/reframe/planner";
import { History } from "../packages/commands";
import { inComposition } from "../packages/commands/compositions";
import { setProperty } from "../packages/commands/animation";
function value(keys: Keyframe[], frame: number) {
  const a = keys.filter((k) => k.frame <= frame).at(-1) ?? keys[0],
    b = keys.find((k) => k.frame >= frame) ?? keys.at(-1)!;
  return a.frame === b.frame
    ? a.value
    : a.value + ((b.value - a.value) * (frame - a.frame)) / (b.frame - a.frame);
}
it("real gym inference produces finite serialization-stable editable paths for every shot", () => {
  const p = parseProject(capture.project),
    map = new Map(
      capture.results.map((r) => [
        r.clipId,
        subjectSamplesSchema.parse(r.data),
      ]),
    );
  const preview = planReframe(
      "Keep me centered",
      p,
      0,
      capture.sequenceId,
      map,
    ),
    out = preview.project;
  expect(parseProject(JSON.parse(JSON.stringify(out)))).toEqual(out);
  const c = out.compositions.find((c) => c.id === capture.sequenceId)!;
  for (const l of c.layers.filter((l) => map.has(l.id))) {
    expect(l.keyframes.scale[0].value).toBeGreaterThan(1);
    expect(l.keyframes.scale[0].value).toBeLessThanOrEqual(4);
    expect(l.keyframes.x.length + l.keyframes.y.length).toBeLessThan(60);
  }
  const clip = c.layers[0],
    h = new History(out),
    manual = h.execute(
      out,
      "Manual camera key",
      inComposition(
        c.id,
        setProperty(clip.id, "x", clip.keyframes.x[0].value + 25, clip.start),
      ),
    );
  expect(
    manual.compositions.find((c) => c.id === capture.sequenceId)!.layers[0]
      .keyframes.x[0].value,
  ).toBe(clip.keyframes.x[0].value + 25);
  expect(h.undo(manual)).toEqual(out);
});
for (const scenario of scenarios.results)
  it(`real pixel stress case: ${scenario.name}`, () => {
    const data = subjectSamplesSchema.parse(scenario.data),
      choice = scenario.name === "two" ? "both" : "main";
    const track = associate(data, choice),
      path = cameraPath(data, 30, 90, 1080, 1920, "smooth", choice);
    let jump = 0;
    for (let frame = 1; frame < 90; frame++)
      jump = Math.max(
        jump,
        Math.abs(value(path.x, frame) - value(path.x, frame - 1)),
      );
    expect(jump).toBeLessThan(1080 * 0.05);
    const scale = path.scale[0].value,
      contain = Math.min(1080 / data.width, 1920 / data.height),
      sw = data.width * scale * contain,
      sh = data.height * scale * contain;
    for (const { box, timeMs } of track.samples) {
      const frame = Math.min(89, Math.round(timeMs * 0.03)),
        x = 1080 / 2 + (box.x - 0.5) * sw + value(path.x, frame),
        y = 1920 / 2 + (box.y - 0.5) * sh + value(path.y, frame);
      const visibleW = Math.max(
          0,
          Math.min(1080, x + box.width * sw) - Math.max(0, x),
        ),
        visibleH = Math.max(
          0,
          Math.min(1920, y + box.height * sh) - Math.max(0, y),
        );
      expect(visibleW / (box.width * sw)).toBeGreaterThan(0.94);
      expect(visibleH / (box.height * sh)).toBeGreaterThan(0.94);
    }
    if (scenario.name === "occluded") expect(track.uncertain).toBe(true);
    if (scenario.name === "two") expect(path.letterbox).toBe(true);
  });
