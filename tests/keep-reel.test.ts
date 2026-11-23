import { describe, expect, it } from "vitest";
import { reelShotsToKeep } from "../packages/ai/reference/planner";

const shot = (startMs: number, endMs: number, card?: { color: string }) => ({ startMs, endMs, ...(card ? { card } : {}) });
const pick = (sourceId: string, certainty: number, label = "best available") => ({ sourceId, certainty, label });

describe("keeping the reel's own shots where the footage has nothing like them", () => {
  // A meme reel: a 4.3 s flex shot, then half-second memes, then an end card. The raw clip is one flex.
  const reel = [shot(0, 4270), ...Array.from({ length: 6 }, (_, i) => shot(4270 + i * 500, 4770 + i * 500)), shot(7270, 11000, { color: "#000000" })];

  it("plays the footage in the shot it fits best and keeps every other shot, card included", () => {
    const choices = [pick("raw", 0.62), pick("raw", 0.4), pick("raw", 0.66), pick("raw", 0.35), pick("raw", 0.3), pick("raw", 0.45), pick("raw", 0.38), pick("raw", 0.2)];
    // The half-second meme scores a little higher, but the long flex shot is where the clip belongs.
    expect([...reelShotsToKeep(choices, reel)]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("plays every close match, and at least one shot per clip", () => {
    const choices = [pick("a", 0.9, "close match"), pick("b", 0.3), pick("a", 0.85, "close match"), pick("b", 0.5), pick("a", 0.2), pick("a", 0.1), pick("b", 0.1), undefined];
    const kept = reelShotsToKeep(choices, reel);
    expect(kept.has(0) || kept.has(2)).toBe(false);
    expect(kept.has(3)).toBe(false); // clip b's best shot
    expect([...kept]).toEqual([1, 4, 5, 6, 7]);
  });

  it("keeps a card even when the footage was matched to it", () => {
    const choices = reel.map((_, i) => pick("raw", i === 7 ? 0.99 : 0.1, i === 7 ? "close match" : "best available"));
    const kept = reelShotsToKeep(choices, reel);
    expect(kept.has(7)).toBe(true);
    expect(kept.has(0)).toBe(false);
  });
});
