/** Cache of focused title tracing (`traceTitles`), the costliest reference step.
 *
 * Tracing changes four things in the interval's DNA: the text layers, the person flashes, and per
 * shot the tone measured with the title band masked out and the title plate's tint. A cache hit
 * must reproduce all four, or a cached reconstruction would differ from an uncached one.
 *
 * The key holds everything tracing reads and nothing else: the reference file, the interval, the
 * reviewed words, the title seeds, the shot boundaries it measures per shot, the person contours
 * and the transcript. Raw footage never enters it, so a word correction re-traces titles only. */
import type { StyleDNA } from "./dna";

/** Bump when traceTitles changes what it measures. 2: shot tone and plate tint are cached too.
 * 3–4: partial OCR readings of one word may correct each other (fragmentMerges), and agreeing
 * uncertain pieces no longer veto the traced word on ink. 5: titles re-traced once so the person
 * check is verified on first-run (freshly traced) references. 6: a reading only vetoes a trace on
 * size when it overlaps the trace's columns. */
export const TITLE_CACHE_VERSION = "6";

/** Short stable digest of a string, for cache keys. */
export const digest = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export interface TitleCacheInputs {
  fingerprint: string;
  interval: { startMs: number; endMs: number };
  reviewedTitleCues?: string;
  /** The interval's DNA before tracing (restricted to the interval or not: its text and shots). */
  dna: Pick<StyleDNA, "text" | "shots">;
  contours: number;
  transcript?: { startMs: number; endMs: number; text: string }[];
}

export function titleCacheKey(x: TitleCacheInputs) {
  const seeds = (x.dna.text ?? []).map((t) => [t.startMs, t.endMs, t.content ?? "", Math.round(t.x * 1000), Math.round(t.y * 1000), Math.round(t.width * 1000), t.evidence?.status ?? ""]);
  const shots = x.dna.shots.map((s) => [Math.max(s.startMs, x.interval.startMs), Math.min(s.endMs, x.interval.endMs)]).filter(([a, b]) => b > a);
  return [
    `reference-titles-${TITLE_CACHE_VERSION}`,
    x.fingerprint,
    `${x.interval.startMs}-${x.interval.endMs}`,
    digest(x.reviewedTitleCues ?? ""),
    digest(JSON.stringify(seeds)),
    digest(JSON.stringify(shots)),
    x.contours,
    digest(JSON.stringify((x.transcript ?? []).map((s) => [s.startMs, s.endMs, s.text]))),
  ].join(":");
}

export interface TitleCacheEntry {
  text: StyleDNA["text"];
  personFlashes: StyleDNA["personFlashes"];
  shots: { startMs: number; endMs: number; tone?: StyleDNA["shots"][number]["tone"]; plateTint?: string }[];
  warnings: string[];
}

/** What to store after tracing. */
export function titleCacheEntry(traced: StyleDNA, warnings: string[]): TitleCacheEntry {
  return {
    text: traced.text,
    personFlashes: traced.personFlashes,
    shots: traced.shots.map((s) => ({ startMs: s.startMs, endMs: s.endMs, ...(s.tone ? { tone: s.tone } : {}), ...(s.plateTint ? { plateTint: s.plateTint } : {}) })),
    warnings,
  };
}

/** The traced DNA rebuilt from the interval's DNA and a cache entry, or undefined when the entry
 * does not describe these shots (then the caller traces again). */
export function applyTitleCache(restricted: StyleDNA, entry: TitleCacheEntry): StyleDNA | undefined {
  if (!Array.isArray(entry.shots) || !Array.isArray(entry.warnings) || entry.shots.length !== restricted.shots.length) return undefined;
  if (entry.shots.some((s, i) => s.startMs !== restricted.shots[i].startMs || s.endMs !== restricted.shots[i].endMs)) return undefined;
  return {
    ...restricted,
    text: entry.text,
    personFlashes: entry.personFlashes,
    shots: restricted.shots.map((s, i) => {
      const { tone, plateTint } = entry.shots[i];
      const { tone: _t, plateTint: _p, ...rest } = s;
      return { ...rest, ...(tone ? { tone } : {}), ...(plateTint ? { plateTint } : {}) };
    }),
  };
}
