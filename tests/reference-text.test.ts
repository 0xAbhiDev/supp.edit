import { expect, it } from "vitest";
import {
  classifyTextOverlays,
  type TextAppearance,
} from "../packages/ai/reference/appearance";
import { createTypography } from "../packages/typography/commands";
import { placement } from "../packages/typography/planner";
import { newProject, parseProject } from "../packages/project-schema";
import { History } from "../packages/commands";

const text = (startMs: number, content: string, x = 0.8): TextAppearance => ({
  startMs,
  endMs: startMs + 800,
  content,
  words: 1,
  x,
  y: 0.3,
  width: 0.15,
  height: 0.04,
});
it("distinguishes recurring edge identities from timed creative words without hardcoded handles", () => {
  const labels = [0, 2000, 4000, 6000, 8000].map((t, i) =>
    text(t, ["OCREATOR", "@CREATOR", "CCREATOR"][i % 3]),
  );
  const result = classifyTextOverlays(
    [...labels, text(1200, "MOTIVATE", 0.2), text(1400, "MOTIVATE", 0.2)],
    10000,
  );
  expect(result.slice(0, 5).every((t) => t.role === "persistent-overlay")).toBe(
    true,
  );
  expect(result.slice(5).every((t) => t.role == null)).toBe(true);
  expect(labels.every((t) => t.role == null)).toBe(true);
});
it("keeps measured horizontal layout and short overlapping text editable through history and persistence", () => {
  const p = newProject("Reference text", 848, 446),
    history = new History(p);
  const band = placement(p, 0, 8, [], 0.4, {
    x: 0.1,
    width: 0.2,
    height: 0.07,
  });
  expect(band.x).toBeLessThan(-150);
  expect(band.y + 223).toBeCloseTo(446 * 0.4);
  const edit = createTypography({
    tool: "text.create",
    id: "word",
    trackId: "titles",
    content: "FOCUS",
    start: 0,
    duration: 8,
    style: "Bold",
    treatment: "Pop",
    timing: "manual",
    y: band.y,
    layout: { x: band.x, width: band.width },
  });
  const after = history.execute(p, "Measured title", edit);
  expect(after.clips[0].duration).toBe(8);
  expect(after.clips[0].transform.x).toBe(band.x);
  expect(after.clips[0].text.maxWidth).toBe(band.width);
  expect(parseProject(JSON.parse(JSON.stringify(after))).clips).toEqual(
    after.clips,
  );
  expect(history.undo(after)).toEqual(p);
  expect(history.redo(p)).toEqual(after);
});
