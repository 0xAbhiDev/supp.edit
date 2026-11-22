import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain ES module of the evaluation scripts (no type declarations)
import { calibration, gradePair, labelsDigest, labelsSchema, parsePicks, rowsFromLog, shotProblems } from "../scripts/eval/lib.mjs";

const shot = (n: number, startMs: number, endMs: number, acceptable: { clip: string; startMs: number; endMs: number; level: string }[] = []) => ({
  shot: n,
  startMs,
  endMs,
  shows: "something",
  role: "action",
  energy: "peak",
  action: "",
  acceptable,
  note: "",
  done: true,
});
const labels = (shots: ReturnType<typeof shot>[]) => labelsSchema.parse({ version: 1, updatedAt: "2026-11-22T00:00:00Z", shots });
const row = (n: number, a: number, b: number, clip: string, i: number, o: number, confidence: number, label: string) =>
  `${n} ${a.toFixed(2)}–${b.toFixed(2)} s action peak confidence ${confidence}% ${label} source coverage: good ${clip} @ ${i.toFixed(2)}–${o.toFixed(2)} s moves like the reference`;

describe("reading the app's picks", () => {
  it("finds clip names with spaces and the label shown", () => {
    const picks = parsePicks(
      [row(1, 0, 1.5, "My Clip 2.mp4", 3, 4.5, 83, "close match"), row(2, 1.5, 3, "b.mp4", 1, 2.5, 40, "best available candidate") + " No close source match found"],
      ["b.mp4", "My Clip 2.mp4", "Clip 2.mp4"],
    );
    expect(picks).toEqual([
      { appShot: 1, refStartMs: 0, refEndMs: 1500, clip: "My Clip 2.mp4", inMs: 3000, outMs: 4500, confidence: 83, label: "close match" },
      { appShot: 2, refStartMs: 1500, refEndMs: 3000, clip: "b.mp4", inMs: 1000, outMs: 2500, confidence: 40, label: "best available" },
    ]);
  });

  it("reads the rows from a driver log", () => {
    const log = `09:00:01 Preview ready {}\n09:00:02 Explained each choice {"rows":["a","b"]}\n`;
    expect(rowsFromLog(log)).toEqual(["a", "b"]);
    expect(rowsFromLog("nothing here")).toBeUndefined();
  });
});

describe("grading a pair", () => {
  const set = labels([
    shot(1, 0, 1000, [{ clip: "a.mp4", startMs: 2000, endMs: 4000, level: "exact" }]),
    shot(2, 1000, 2000, [
      { clip: "a.mp4", startMs: 10000, endMs: 12000, level: "action" },
      { clip: "b.mp4", startMs: 0, endMs: 9000, level: "role" },
    ]),
    shot(3, 2000, 3000, [{ clip: "b.mp4", startMs: 0, endMs: 5000, level: "role" }]),
    shot(4, 3000, 4000),
  ]);

  it("scores each shot at the best level its pick reaches", () => {
    const picks = [
      { appShot: 1, refStartMs: 0, refEndMs: 1000, clip: "a.mp4", inMs: 2500, outMs: 3500, confidence: 90, label: "close match" },
      // Covers more of shot 2 than the next pick does: it speaks for shot 2.
      { appShot: 2, refStartMs: 1000, refEndMs: 1900, clip: "b.mp4", inMs: 1000, outMs: 2000, confidence: 70, label: "close match" },
      { appShot: 3, refStartMs: 1900, refEndMs: 3000, clip: "b.mp4", inMs: 3000, outMs: 4000, confidence: 40, label: "best available" },
    ];
    const { shots, totals } = gradePair(set, picks);
    expect(shots.map((s: { level: string | null }) => s.level)).toEqual(["exact", "role", "role", null]);
    expect(shots[1]).toMatchObject({ rightAction: false, rightRole: true, falseConfident: true, rightClip: false });
    expect(shots[2]).toMatchObject({ actionAvailable: false, flagged: true });
    expect(shots[3]).toMatchObject({ placed: false, roleAvailable: false });
    expect(totals.rightAction.text).toBe("1/2");
    expect(totals.rightMoment.text).toBe("1/1");
    expect(totals.rightRole.text).toBe("3/3");
    expect(totals.unavailableFlagged.text).toBe("1/2"); // shot 4 has no pick, so nothing flagged it
    expect(totals.falseConfident.text).toBe("1/2");
    expect(totals.notPlaced).toBe(1);
  });

  it("needs most of the pick inside a range of the same clip", () => {
    const one = labels([shot(1, 0, 1000, [{ clip: "a.mp4", startMs: 0, endMs: 1000, level: "action" }])]);
    const at = (inMs: number, outMs: number, clip = "a.mp4") => gradePair(one, [{ appShot: 1, refStartMs: 0, refEndMs: 1000, clip, inMs, outMs, confidence: 50, label: "best available" }]).shots[0].rightAction;
    expect(at(200, 1200)).toBe(true); // 80% inside
    expect(at(300, 1300)).toBe(false); // 70% inside
    expect(at(0, 1000, "b.mp4")).toBe(false);
  });

  it("buckets confidence against results", () => {
    const { shots } = gradePair(set, [
      { appShot: 1, refStartMs: 0, refEndMs: 1000, clip: "a.mp4", inMs: 2500, outMs: 3500, confidence: 90, label: "close match" },
      { appShot: 2, refStartMs: 1000, refEndMs: 2000, clip: "a.mp4", inMs: 10000, outMs: 11000, confidence: 60, label: "best available" },
    ]);
    expect(calibration(shots)).toEqual([
      { from: 0, to: 50, shots: 0, rightAction: 0 },
      { from: 50, to: 65, shots: 1, rightAction: 1 },
      { from: 65, to: 80, shots: 0, rightAction: 0 },
      { from: 80, to: 100, shots: 1, rightAction: 1 },
    ]);
  });
});

describe("labels", () => {
  it("lock on their content, not their save time", () => {
    const a = labels([shot(1, 0, 1000)]);
    const b = { ...a, updatedAt: "2030-01-01T00:00:00Z" };
    expect(labelsDigest(a)).toBe(labelsDigest(b));
    expect(labelsDigest(a)).not.toBe(labelsDigest(labels([shot(1, 0, 1100)])));
  });

  it("reject a range that ends before it starts, and say what a shot still needs", () => {
    expect(() => labels([shot(1, 0, 1000, [{ clip: "a.mp4", startMs: 500, endMs: 400, level: "role" }])])).toThrow();
    expect(shotProblems({ ...shot(1, 0, 1000), shows: " ", role: null, done: false })).toEqual(["say what it shows", "choose its role", "mark it done"]);
  });
});
