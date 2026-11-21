/** Text already in the raw footage (burned-in labels, captions, signs), measured only on the
 * candidate windows the planner considers, and compared with the reference's own titles.
 *
 *  - equivalent: the source already shows the reference's words, where the reference shows them
 *    → keep the source text and add no duplicate title;
 *  - unrelated: other persistent text → a clean, similarly strong candidate is preferred, and a
 *    kept one is reported as "Source contains baked-in text.";
 *  - absent: measured, and nothing persistent was read;
 *  - uncertain: something was read, but not steadily enough to say either way;
 *  - unmeasured windows stay unmeasured (never treated as clean). */
import { z } from "zod";
import type { Asset } from "../../project-schema";
import type { JobContext } from "../../jobs";

const unit = z.number().min(0).max(1);
export const rawTextRegionSchema = z
  .object({
    interval: z.number().int().nonnegative(),
    text: z.string().max(240),
    x: z.number().min(-0.01).max(1.01),
    y: z.number().min(-0.01).max(1.01),
    width: unit,
    height: unit,
    frames: z.number().int().nonnegative(),
    sampled: z.number().int().positive(),
    drift: z.number().nonnegative(),
    confidence: unit,
    likelyBurnedIn: z.boolean(),
  })
  .strict();
export type RawTextRegion = z.infer<typeof rawTextRegionSchema>;
/** One measured source window and what was read in it (an empty list is a measured absence). */
export interface SourceTextWindow {
  startMs: number;
  endMs: number;
  regions: Omit<RawTextRegion, "interval">[];
}
/** A reference title on screen during a shot, in reference frame fractions (top-left origin). */
export interface ReferenceText {
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bump when the native measurement or its meaning changes. */
export const SOURCE_TEXT_VERSION = "1";
const key = (a: Asset, w: { startMs: number; endMs: number }) => `source-text-v${SOURCE_TEXT_VERSION}:${a.fingerprint}:${w.startMs}-${w.endMs}`;

/** Read source text in the given windows (100 ms grid), from cache where measured before. */
export async function sourceText(a: Asset, windows: { startMs: number; endMs: number }[], job: JobContext): Promise<SourceTextWindow[]> {
  // Loaded here: the storage layer needs the app (selection code also runs in plain Node).
  const { readDerived, writeDerived } = await import("../../platform/derived");
  const grid = [...new Map(windows.map((w) => [`${Math.round(w.startMs / 100) * 100}-${Math.round(w.endMs / 100) * 100}`, { startMs: Math.round(w.startMs / 100) * 100, endMs: Math.round(w.endMs / 100) * 100 }])).values()].filter((w) => w.endMs > w.startMs);
  const out: SourceTextWindow[] = [];
  const missing: typeof grid = [];
  for (const w of grid) {
    const cached = z.array(rawTextRegionSchema.omit({ interval: true })).safeParse(await readDerived(key(a, w)).catch(() => undefined));
    if (cached.success) out.push({ ...w, regions: cached.data });
    else missing.push(w);
  }
  if (missing.length) {
    const { nativeJob } = await import("../media-analysis/service");
    const regions = z.array(rawTextRegionSchema).parse(await nativeJob("source_text", { path: a.path, intervals: missing }, job));
    for (const [i, w] of missing.entries()) {
      const mine = regions.filter((r) => r.interval === i).map(({ interval: _i, ...r }) => r);
      out.push({ ...w, regions: mine });
      await writeDerived(key(a, w), mine, JSON.stringify(mine).length * 2 + 256).catch(() => {});
    }
  }
  return out.sort((x, y) => x.startMs - y.startMs);
}

const compact = (s: string) => s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
/** Similarity of two readings (0–1): edit distance over the compacted strings. */
export function textSimilarity(a: string, b: string) {
  const x = compact(a),
    y = compact(b);
  if (!x.length || !y.length) return 0;
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

export type SourceTextStatus = "equivalent" | "unrelated" | "absent" | "uncertain" | "unmeasured";
export interface SourceTextVerdict {
  status: SourceTextStatus;
  /** Burned-in regions that show a reference title's words (keep them; add no duplicate). */
  equivalent: { region: SourceTextWindow["regions"][number]; reference: ReferenceText }[];
  /** Burned-in regions that show something else. */
  unrelated: SourceTextWindow["regions"][number][];
}

/** What the source shows in [inMs, outMs] against the reference titles of the shot it plays.
 * Positions are compared loosely (frames are reframed), words strictly. */
export function classifySourceText(windows: readonly SourceTextWindow[] | undefined, inMs: number, outMs: number, refs: readonly ReferenceText[]): SourceTextVerdict {
  const covering = (windows ?? []).filter((w) => Math.min(w.endMs, outMs) - Math.max(w.startMs, inMs) >= 0.5 * Math.min(outMs - inMs, w.endMs - w.startMs));
  if (!covering.length) return { status: "unmeasured", equivalent: [], unrelated: [] };
  const regions = covering.flatMap((w) => w.regions);
  const steady = regions.filter((r) => r.likelyBurnedIn);
  const equivalent: SourceTextVerdict["equivalent"] = [];
  const unrelated: SourceTextVerdict["unrelated"] = [];
  for (const region of steady) {
    const reference = refs.find((t) => textSimilarity(region.text, t.content) >= 0.75 && Math.abs(region.y + region.height / 2 - (t.y + t.height / 2)) <= 0.25);
    if (reference) {
      if (!equivalent.some((e) => e.reference === reference)) equivalent.push({ region, reference });
    } else if (!unrelated.some((u) => textSimilarity(u.text, region.text) >= 0.75)) unrelated.push(region);
  }
  const status: SourceTextStatus = equivalent.length ? "equivalent" : unrelated.length ? "unrelated" : regions.some((r) => r.confidence >= 0.5) ? "uncertain" : "absent";
  return { status, equivalent, unrelated };
}

/** Score penalty (0–0.08) for unrelated persistent text where clean imagery is wanted: larger,
 * more central, more persistent and more confident text costs more, and text under a planned
 * reference title costs most. A small corner watermark or timestamp costs almost nothing. */
export function unrelatedTextPenalty(regions: readonly SourceTextWindow["regions"][number][], titles: readonly ReferenceText[]) {
  let total = 0;
  for (const r of regions) {
    const area = r.width * r.height;
    const size = Math.min(1, area / 0.02);
    const cx = r.x + r.width / 2,
      cy = r.y + r.height / 2;
    const centrality = Math.max(0, 1 - 2 * Math.hypot(cx - 0.5, cy - 0.5));
    const overlap = titles.some((t) => Math.min(r.x + r.width, t.x + t.width) > Math.max(r.x, t.x) && Math.min(r.y + r.height, t.y + t.height) > Math.max(r.y, t.y)) ? 1 : 0;
    const persistence = r.frames / Math.max(1, r.sampled);
    total += r.confidence * persistence * (0.5 * size + 0.25 * centrality + 0.25 * overlap);
  }
  return Math.min(0.08, 0.08 * total);
}
