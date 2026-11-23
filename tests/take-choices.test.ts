import { describe, expect, it } from "vitest";
import { TAKE_SHIFT, takeChoiceShift, takesFor, type TakeChoice } from "../packages/ai/reference/corrections";

const choice = (at: string, rejected: [string, number, number], chosen: [string, number, number], shot = [2000, 4000]): TakeChoice => ({
  at,
  reference: { fingerprint: "reel", durationMs: 10000 },
  shot: { startMs: shot[0], endMs: shot[1] },
  rejected: { fingerprint: rejected[0], inMs: rejected[1], outMs: rejected[2] },
  chosen: { fingerprint: chosen[0], inMs: chosen[1], outMs: chosen[2] },
});

describe("your take choices carry into the next recreation", () => {
  it("raises the moment you chose and lowers the one you replaced, for that shot only", () => {
    const takes = takesFor([choice("2026-11-23T10:00:00Z", ["raw", 0, 2000], ["raw", 8000, 10000])], "reel", "raw");
    expect(takeChoiceShift(takes, 2000, 4000, 8000, 10000)).toBe(TAKE_SHIFT);
    expect(takeChoiceShift(takes, 2000, 4000, 0, 2000)).toBe(-TAKE_SHIFT);
    expect(takeChoiceShift(takes, 6000, 8000, 8000, 10000)).toBe(0);
    expect(takesFor([choice("2026-11-23T10:00:00Z", ["raw", 0, 2000], ["raw", 8000, 10000])], "another reel", "raw")).toBeUndefined();
  });

  it("follows the latest choice when you change your mind", () => {
    const takes = takesFor(
      [choice("2026-11-23T10:00:00Z", ["raw", 0, 2000], ["raw", 8000, 10000]), choice("2026-11-23T10:05:00Z", ["raw", 8000, 10000], ["raw", 0, 2000])],
      "reel",
      "raw",
    );
    expect(takeChoiceShift(takes, 2000, 4000, 0, 2000)).toBe(TAKE_SHIFT);
    expect(takeChoiceShift(takes, 2000, 4000, 8000, 10000)).toBe(-TAKE_SHIFT);
  });

  it("drops a clip's earlier pick when you later choose another clip for the shot", () => {
    const takes = takesFor(
      [choice("2026-11-23T10:00:00Z", ["b", 0, 2000], ["raw", 8000, 10000]), choice("2026-11-23T10:05:00Z", ["raw", 8000, 10000], ["b", 4000, 6000])],
      "reel",
      "raw",
    );
    expect(takeChoiceShift(takes, 2000, 4000, 8000, 10000)).toBe(-TAKE_SHIFT);
  });
});
