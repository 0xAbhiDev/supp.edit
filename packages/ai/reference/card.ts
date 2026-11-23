/** Card shots: a title or end card on a plain background (white with words, black with words).
 *
 * No raw footage plays such a shot: the evaluation set's baseline filled every card with whatever
 * moment scored best (a trailer's white "Coming soon" card played by a forest). A card is recreated
 * instead as a plain plate in the card's colour, under the recreated text and above the footage,
 * which stays underneath (delete the plate to show it). A shot is a card only when it holds still,
 * its picture is flat (nearly every cell of its 4×4 brightness layout at one level), and the
 * reference shows text during it: a dark night shot or a logo on navy is left to the footage. */
import type { VisualFrame } from "./visual";

/** Share of layout cells that must sit at the frame's typical level. */
const FLAT_CELLS = 13 / 16;
const FLAT_SPREAD = 0.06;
const STILL_CHANGE = 0.004;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};
const hex = (rgb: readonly number[]) => "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");

/** The plate colour of a card shot, or null when the shot is not a card. */
export function cardColor(frames: readonly VisualFrame[], startMs: number, endMs: number, hasText: boolean): string | null {
  if (!hasText) return null;
  const inside = frames.filter((f) => f.timeMs >= startMs + 100 && f.timeMs < endMs - 100);
  if (inside.length < 3) return null;
  const moving = inside.slice(1).filter((f) => f.change >= STILL_CHANGE).length;
  if (moving > 0.1 * (inside.length - 1)) return null;
  const flat = inside.filter((f) => {
    const level = median(f.layout);
    return f.layout.filter((v) => Math.abs(v - level) <= FLAT_SPREAD).length >= FLAT_CELLS * 16;
  }).length;
  if (flat < 0.8 * inside.length) return null;
  const white = median(inside.map((f) => f.whiteFraction)),
    black = median(inside.map((f) => f.blackFraction));
  const channel = (pick: (f: VisualFrame) => readonly number[] | undefined, k: number) => median(inside.map(pick).filter((x): x is readonly number[] => !!x).map((x) => x[k]));
  const has = (pick: (f: VisualFrame) => readonly number[] | undefined) => inside.some((f) => pick(f));
  const highlight = has((f) => f.highlightRgb) ? [0, 1, 2].map((k) => channel((f) => f.highlightRgb, k)) : null;
  const shadow = has((f) => f.shadowRgb) ? [0, 1, 2].map((k) => channel((f) => f.shadowRgb, k)) : null;
  if (white >= 0.6) return hex(highlight ?? [255, 255, 255]);
  if (black >= 0.6) return hex(shadow ?? [0, 0, 0]);
  // A plain colour card: its highlights and shadows are both the card's colour.
  if (highlight && shadow) return hex([0, 1, 2].map((k) => (highlight[k] + shadow[k]) / 2));
  const level = median(inside.map((f) => median(f.layout))) * 255;
  return hex([level, level, level]);
}
