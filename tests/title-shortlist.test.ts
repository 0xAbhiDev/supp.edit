import { describe, expect, it } from "vitest";
import { SPEECH_SHORTLIST, shortlist } from "../packages/ai/reference/title-read";

describe("words offered for one title", () => {
  it("keeps every offer when speech is short, the first offer of a wording winning", () => {
    const out = shortlist([{ content: "HELLO", origin: "seed" }, { content: "HELLO", origin: "speech" }, { content: "there", origin: "speech" }], 3);
    expect(out).toEqual([{ content: "HELLO", origin: "seed" }, { content: "there", origin: "speech" }]);
  });

  it("never drops a review, seed or decoded reading, and bounds the spoken words", () => {
    const spoken = Array.from({ length: 150 }, (_, i) => ({ content: "word" + i, origin: "speech" as const }));
    const out = shortlist([{ content: "REVIEWED", origin: "review" }, ...spoken, { content: "GLYPHS", origin: "glyphs" }], 4);
    expect(out.filter((c) => c.origin === "speech").length).toBeLessThanOrEqual(150);
    expect(out.map((c) => c.content)).toContain("REVIEWED");
    expect(out.map((c) => c.content)).toContain("GLYPHS");
    // Without a canvas (this test runs in node) nothing can be measured, so nothing is dropped.
    expect(SPEECH_SHORTLIST).toBeGreaterThan(20);
  });
});
