/** Second-stage cut detection on the dense (33 ms) per-frame measurements.
 *
 * Scene detection compares sparse samples, so it misses cuts between similar material: two dark
 * gym takes from the same corner, a held frame and the live action of the same subject. At frame
 * level such a cut is still a one-frame discontinuity. A frame is a cut when its change stands
 * well above its own neighbourhood (movement raises the neighbourhood, a cut does not) AND
 * independent evidence agrees: the spatial layout jumps, the palette jumps, global flow loses
 * its match, sharpness or level settles somewhere new, the motion regime switches (moving to
 * frozen), or the subject jumps. Flashes and glitches are rejected because the picture returns. */
import type { VisualFrame } from "./visual";
import type { PersonSample } from "./subject-mask";

export interface FrameCut {
  /** First frame of the new shot (source milliseconds). */
  timeMs: number;
  /** Change at the cut over its neighbourhood's typical change. */
  strength: number;
  evidence: string[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const layoutDelta = (a: VisualFrame, b: VisualFrame) => Math.sqrt(a.layout.reduce((s, v, j) => s + (v - b.layout[j]) ** 2, 0) / a.layout.length);
const paletteDelta = (a: VisualFrame, b: VisualFrame) => {
  const [as, ah, bs, bh] = [a.shadowRgb, a.highlightRgb, b.shadowRgb, b.highlightRgb];
  if (!as || !ah || !bs || !bh) return 0;
  return (as.reduce((s, v, j) => s + Math.abs(v - bs[j]), 0) + ah.reduce((s, v, j) => s + Math.abs(v - bh[j]), 0)) / (6 * 255);
};

function subjectAt(people: readonly PersonSample[], timeMs: number, side: -1 | 1) {
  // The nearest sample strictly on one side of the boundary, within 150 ms.
  let best: PersonSample | undefined;
  for (const p of people) {
    const d = (p.timeMs - timeMs) * side;
    if (d < (side > 0 ? 0 : 1) || d > 150) continue;
    if (!best || Math.abs(p.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)) best = p;
  }
  if (!best) return undefined;
  if (!best.points.length) return null;
  const xs = best.points.map((p) => p[0]),
    ys = best.points.map((p) => p[1]);
  return { cx: xs.reduce((a, b) => a + b, 0) / xs.length, cy: ys.reduce((a, b) => a + b, 0) / ys.length, h: Math.max(...ys) - Math.min(...ys) };
}

/** A measured overlay (a title line) and where it sits, in frame fractions. */
export interface Overlay {
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** strict (for finished, stylised references, whose effects imitate cuts): titles are masked
 * whatever other evidence says; a picture that returns within half a second (a silhouette flash,
 * a colour pulse, a short insert) is an effect, not a shot; and the cut must break the picture
 * globally: global flow loses its match or the scale/position jumps for one frame (a continuous
 * zoom or pan is coherent over many frames) AND the palette, the level or the motion regime
 * changes. */
export function frameCuts(frames: readonly VisualFrame[], people: readonly PersonSample[] = [], overlays: readonly Overlay[] = [], strict = false): FrameCut[] {
  const cuts: FrameCut[] = [];
  const n = frames.length;
  // A subject never stops dead within one frame: a discontinuity between moving picture on one
  // side and a static one (a held still, a paused stream) on the other needs less change.
  const activity = (from: number, to: number) => {
    const xs = frames.slice(Math.max(1, from), Math.min(n, to)).map((x) => x.change);
    return xs.length >= 4 ? { mean: xs.reduce((a, b) => a + b, 0) / xs.length, max: Math.max(...xs) } : undefined;
  };
  const isStatic = (a?: { mean: number; max: number }) => !!a && a.mean <= 0.0004 && a.max <= 0.001;
  // Against a digitally frozen side (no codec noise at all), even slow movement is a regime.
  const isMoving = (a?: { mean: number; max: number }, other?: { mean: number; max: number }) => !!a && a.mean >= (other && other.mean <= 0.0001 ? 0.0009 : 0.002);
  for (let i = 1; i < n; i++) {
    const f = frames[i],
      c = f.change;
    const before6 = activity(i - 6, i),
      after6 = activity(i + 1, i + 7);
    const stillSide = (isStatic(before6) && isMoving(after6, before6)) || (isMoving(before6, after6) && isStatic(after6));
    if (c < (stillSide ? 0.012 : 0.02)) continue;
    // Gaps in the frame clock (a chunk boundary or a dropped frame) are not evidence.
    if (frames[i].timeMs - frames[i - 1].timeMs > 80) continue;
    const around: number[] = [];
    for (let k = Math.max(1, i - 8); k <= Math.min(n - 1, i + 8); k++) if (k !== i) around.push(frames[k].change);
    // Footage below the delivery frame rate repeats frames, which pulls a plain median towards
    // zero and makes every real update look like a spike: compare with the frames that update.
    const updates = around.filter((x) => x >= 0.0015);
    const typical = Math.max(updates.length >= 3 ? median(updates) : median(around), 0.004);
    // A moving camera raises per-frame change everywhere but barely moves the coarse layout; a cut
    // during camera movement shows as a layout jump far above its neighbourhood.
    const layoutNear: number[] = [];
    for (let k = Math.max(1, i - 8); k <= Math.min(n - 1, i + 8); k++) if (k !== i) layoutNear.push(layoutDelta(frames[k], frames[k - 1]));
    // Repeated frames (footage below the delivery rate) do not count as layout neighbours.
    const layoutUpdates = layoutNear.filter((v) => v >= 0.0005);
    const layoutRatio = layoutDelta(f, frames[i - 1]) / Math.max(layoutUpdates.length >= 3 ? median(layoutUpdates) : median(layoutNear), 0.0008);
    if (c < (stillSide ? 2.5 : 4) * typical && !(layoutRatio >= 8 && c >= 2.5 * typical)) continue;
    // One-frame discontinuity, not the middle of a dissolve or a fast whip.
    if (Math.max(frames[i - 1].change, frames[i + 1]?.change ?? 0) > 0.72 * c) continue;
    const prev = frames[i - 1];
    // A flash or glitch returns to the old picture within a few frames.
    const back = frames[Math.min(n - 1, i + 3)];
    const jump = layoutDelta(f, prev);
    if (back !== f && layoutDelta(back, prev) < 0.3 * jump && paletteDelta(back, prev) < 0.01) continue;
    const evidence: string[] = [];
    const layoutAround: number[] = [];
    for (let k = Math.max(1, i - 8); k <= Math.min(n - 1, i + 8); k++) if (k !== i) layoutAround.push(layoutDelta(frames[k], frames[k - 1]));
    if (jump >= Math.max(0.006, 3 * median(layoutAround))) evidence.push("layout jump");
    if (paletteDelta(f, prev) >= 0.01) evidence.push("palette jump");
    // Global flow loses its match at the cut, against how well it matched just before (a frozen
    // picture after the cut has nothing to match, so only the side before counts).
    const conf = f.flow?.confidence;
    const confBefore = median(frames.slice(Math.max(1, i - 6), i).map((x) => x.flow?.confidence ?? 1));
    if (conf !== undefined && conf < 0.75 && conf <= confBefore - 0.15 && confBefore >= 0.6) evidence.push("flow reset");
    // Cut or zoom: a continuous zoom (or pan) is coherent over many frames; a punch-in cut or a
    // cut between two set-ups shows a scale or translation jump at one frame only.
    const nbFlow = frames.slice(Math.max(1, i - 6), i).concat(frames.slice(i + 1, Math.min(n, i + 7)));
    const exp = Math.abs(f.flow?.expansion ?? 0),
      pan = Math.hypot(f.flow?.panX ?? 0, f.flow?.panY ?? 0);
    const nbExp = median(nbFlow.map((x) => Math.abs(x.flow?.expansion ?? 0))),
      nbPan = median(nbFlow.map((x) => Math.hypot(x.flow?.panX ?? 0, x.flow?.panY ?? 0)));
    if (exp >= 0.05 && nbExp <= 0.2 * exp) evidence.push("scale jump");
    else if (pan >= 1 && nbPan <= 0.2 * pan) evidence.push("camera transform jump");
    const before = frames.slice(Math.max(0, i - 5), i),
      after = frames.slice(i, Math.min(n, i + 5));
    const sharpShift = Math.abs(median(before.map((x) => x.sharpness)) - median(after.map((x) => x.sharpness)));
    if (sharpShift >= Math.max(0.008, 0.05 * median(before.map((x) => x.sharpness)))) evidence.push("sharpness shift");
    if (Math.abs(median(before.map((x) => x.luma)) - median(after.map((x) => x.luma))) >= 0.008) evidence.push("level shift");
    const motionBefore = frames.slice(Math.max(1, i - 6), i).map((x) => x.change),
      motionAfter = frames.slice(i + 1, Math.min(n, i + 7)).map((x) => x.change);
    const mb = motionBefore.reduce((a, b) => a + b, 0) / Math.max(1, motionBefore.length),
      ma = motionAfter.reduce((a, b) => a + b, 0) / Math.max(1, motionAfter.length);
    if ((Math.min(mb, ma) <= 0.0003 && Math.max(mb, ma) >= 0.002) || Math.max(mb, ma) >= 8 * Math.max(Math.min(mb, ma), 0.0001)) evidence.push("motion regime switch");
    if (people.length) {
      const a = subjectAt(people, f.timeMs, -1),
        b = subjectAt(people, f.timeMs, 1);
      if (a !== undefined && b !== undefined) {
        if ((a === null) !== (b === null)) evidence.push("subject appears or leaves");
        else if (a && b && (Math.hypot(a.cx - b.cx, a.cy - b.cy) >= 0.08 || Math.abs(Math.log(Math.max(0.01, a.h) / Math.max(0.01, b.h))) >= 0.35)) evidence.push("subject jump");
      }
    }
    // A title appearing, changing or leaving over the same picture is not a cut: where an overlay
    // starts or ends here, the picture outside its box must change too.
    const titled: Overlay[] = overlays.filter((o) => Math.abs(o.startMs - f.timeMs) <= 130 || Math.abs(o.endMs - f.timeMs) <= 130);
    if (titled.length && (strict || (!evidence.includes("flow reset") && !evidence.includes("motion regime switch")))) {
      const covered = (cell: number) => {
        const cx0 = (cell % 4) / 4,
          cy0 = Math.floor(cell / 4) / 4;
        // Box origin conventions differ between measurements; cover both corner and centre.
        return titled.some((o) => cx0 < o.x + o.width + 0.06 && cx0 + 0.25 > o.x - o.width / 2 - 0.06 && cy0 < o.y + o.height + 0.06 && cy0 + 0.25 > o.y - o.height / 2 - 0.06);
      };
      const open = f.layout.map((_, j) => j).filter((j) => !covered(j));
      const outside = open.length ? Math.sqrt(open.reduce((s, j) => s + (f.layout[j] - prev.layout[j]) ** 2, 0) / open.length) : 0;
      if (outside < Math.max(0.006, 0.35 * jump)) continue;
      evidence.push("picture changes beyond the titles");
    }
    if (strict) {
      // The picture's geometry breaks (flow loses its match, or the scale or position jumps for
      // one frame, as at a punch-in) AND its palette, level or motion regime changes.
      const geometry = evidence.includes("flow reset") || evidence.includes("scale jump") || evidence.includes("camera transform jump");
      if (!geometry || !(evidence.includes("palette jump") || evidence.includes("motion regime switch") || evidence.includes("level shift"))) continue;
      const returns = (from: number, to: number, target: VisualFrame) => {
        // Layout alone: a strobing effect returns the layout while its colour is still pulsing.
        for (let k = Math.max(0, from); k <= Math.min(n - 1, to); k++) if (layoutDelta(frames[k], target) < 0.3 * jump) return true;
        return false;
      };
      // The old picture comes back soon after, or the new one was on screen just before.
      if (returns(i + 2, i + 15, prev) || returns(i - 15, i - 2, f)) continue;
    }
    const strong = c >= 0.08 && c >= 10 * typical;
    if (evidence.length >= 2 || (strong && evidence.length >= 1)) cuts.push({ timeMs: f.timeMs, strength: Number((c / typical).toFixed(1)), evidence });
  }
  return cuts;
}

/** Split intervals at cuts, keeping a safety margin of frames on both sides of every cut. */
export function cutSafeSegments(
  intervals: readonly { startMs: number; endMs: number }[],
  cuts: readonly FrameCut[],
  marginMs = 67,
  minMs = 400,
): { startMs: number; endMs: number; cutBefore: boolean; cutAfter: boolean }[] {
  const out: { startMs: number; endMs: number; cutBefore: boolean; cutAfter: boolean }[] = [];
  for (const iv of intervals) {
    const inside = cuts.filter((c) => c.timeMs > iv.startMs + 33 && c.timeMs < iv.endMs - 33).map((c) => c.timeMs);
    let start = iv.startMs,
      cutBefore = false;
    for (const t of inside) {
      if (t - marginMs - start >= minMs) out.push({ startMs: start, endMs: t - marginMs, cutBefore, cutAfter: true });
      start = t + marginMs;
      cutBefore = true;
    }
    if (iv.endMs - start >= minMs) out.push({ startMs: start, endMs: iv.endMs, cutBefore, cutAfter: false });
  }
  return out;
}
