/** Read an isolated title mask by comparing it with locally rendered lettering.
 *
 * Candidate wordings come from prior OCR, nearby vocal words and a per-letter decode of the
 * mask itself. Every candidate is rendered in each installed face and compared with the full
 * mask, so a damaged stroke lowers every score equally and cannot favor a wrong word. Nothing
 * leaves the device and no wording is embedded here. */
import { fontFamilies, scriptFamilies } from "../../typography/fonts";

export type Weight = "400" | "700" | "900";
export interface Face {
  family: string;
  weight: Weight;
}
export interface TitleShape {
  /** One byte per pixel; `stride` pixels per row. */
  mask: Uint8Array;
  stride: number;
  box: { x: number; y: number; width: number; height: number };
  /** 1 where the pixel was observed at least a few times. Pixels always hidden behind a subject
   * or a recurring label are unknown, and no reading is scored on them. */
  known?: Uint8Array;
}
export interface Candidate {
  content: string;
  origin: "review" | "seed" | "speech" | "glyphs" | "fragment" | "combined";
}
export interface Reading extends Candidate, Face {
  fit: number;
}

const GRID_W = 128;
let surface: CanvasRenderingContext2D | null | undefined;
function context() {
  if (surface !== undefined) return surface;
  if (typeof document === "undefined") return (surface = null);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  return (surface = canvas.getContext("2d", { willReadFrequently: true }));
}

let installed: Face[] | undefined;
/** Installed candidate faces. Unknown families silently fall back, so compare with two bases. */
export function installedFaces(): Face[] {
  if (installed) return installed;
  const ctx = context();
  if (!ctx) return [];
  const probe = "WmiQ90ag";
  const width = (font: string) => {
    ctx.font = font;
    return ctx.measureText(probe).width;
  };
  const faces: Face[] = [];
  for (const family of fontFamilies) {
    const present = ["monospace", "serif"].some(
      (base) =>
        Math.abs(width("43px " + base) - width('43px "' + family + '",' + base)) > 0.1,
    );
    if (!present) continue;
    // A family without a heavier cut renders the same outline again; skip the duplicate.
    let prior = -1;
    for (const weight of ["400", "700", "900"] as const) {
      const w = width(weight + ' 43px "' + family + '"');
      if (Math.abs(w - prior) < 0.05) continue;
      prior = w;
      faces.push({ family, weight });
    }
  }
  return (installed = faces);
}

const rasters = new Map<string, { bits: Uint8Array; ratio: number } | null>();
/** Tight ink of `text`, stretched to a w×h grid. `ratio` keeps the natural proportions. */
function raster(text: string, face: Face, w: number, h: number) {
  const key = JSON.stringify([text, face.family, face.weight, w, h]);
  const cached = rasters.get(key);
  if (cached !== undefined) return cached;
  const ctx = context()!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = face.weight + ' 64px "' + face.family + '"';
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const tw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
    th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  let entry: { bits: Uint8Array; ratio: number } | null = null;
  if (tw > 0 && th > 0) {
    ctx.setTransform(w / tw, 0, 0, h / th, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillText(text, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data,
      bits = new Uint8Array(w * h);
    for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3] >= 110 ? 1 : 0;
    entry = { bits, ratio: tw / th };
  }
  if (rasters.size > 60000) rasters.clear();
  rasters.set(key, entry);
  return entry;
}

/** Area-sample a mask region to a w×h occupancy grid. */
function resample(
  shape: TitleShape,
  box: TitleShape["box"],
  w: number,
  h: number,
  source: Uint8Array = shape.mask,
) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = box.y + Math.floor((y * box.height) / h),
      y1 = Math.max(y0 + 1, box.y + Math.floor(((y + 1) * box.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = box.x + Math.floor((x * box.width) / w),
        x1 = Math.max(x0 + 1, box.x + Math.floor(((x + 1) * box.width) / w));
      let hits = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) hits += source[yy * shape.stride + xx];
      if (hits * 2 >= (x1 - x0) * (y1 - y0)) out[y * w + x] = 1;
    }
  }
  return out;
}
/** Grid cells observed often enough to score; all cells when nothing was hidden. */
function knownGrid(shape: TitleShape, box: TitleShape["box"], w: number, h: number) {
  return shape.known ? resample(shape, box, w, h, shape.known) : undefined;
}
function overlap(a: Uint8Array, b: Uint8Array, known?: Uint8Array) {
  let both = 0,
    any = 0;
  for (let i = 0; i < a.length; i++) {
    if (known && !known[i]) continue;
    both += a[i] & b[i];
    any += a[i] | b[i];
  }
  return both / Math.max(1, any);
}
const proportion = (a: number, b: number, k: number) =>
  Math.exp(-k * Math.abs(Math.log(a / b)));

function grid(box: TitleShape["box"]) {
  const w = Math.max(8, Math.min(GRID_W, box.width)),
    h = Math.max(8, Math.min(96, Math.round((box.height * w) / box.width)));
  return { w, h };
}

/** Shape agreement of one wording in one face, 0–1. */
export function wordFit(shape: TitleShape, content: string, face: Face) {
  if (!context() || !content.trim()) return 0;
  const { w, h } = grid(shape.box);
  const template = raster(content, face, w, h);
  if (!template) return 0;
  return (
    overlap(resample(shape, shape.box, w, h), template.bits, knownGrid(shape, shape.box, w, h)) *
    proportion(template.ratio, shape.box.width / shape.box.height, 0.3)
  );
}

/** Lettering whose strokes join across letters: far fewer separate pieces than letters. */
export function connectedScript(shape: TitleShape, letters: number) {
  if (letters < 3) return false;
  const { box, mask, stride } = shape;
  const seen = new Uint8Array(box.width * box.height),
    queue = new Int32Array(box.width * box.height);
  let ink = 0;
  const sizes: number[] = [];
  for (let start = 0; start < seen.length; start++) {
    const sx = start % box.width,
      sy = (start - sx) / box.width;
    if (seen[start] || !mask[(box.y + sy) * stride + box.x + sx]) continue;
    let n = 1;
    queue[0] = start;
    seen[start] = 1;
    for (let j = 0; j < n; j++) {
      const px = queue[j] % box.width,
        py = (queue[j] - px) / box.width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx,
            qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= box.width || qy >= box.height) continue;
          const k = qy * box.width + qx;
          if (!seen[k] && mask[(box.y + qy) * stride + box.x + qx]) {
            seen[k] = 1;
            queue[n++] = k;
          }
        }
    }
    sizes.push(n);
    ink += n;
  }
  // Pieces carrying real weight; specks and dots are not letters.
  const pieces = sizes.filter((n) => n >= ink * 0.04).length;
  return pieces < letters;
}

/** Rank each candidate wording by its best installed face. Connected lettering is compared
 * with script faces only; separated lettering with every face. */
export function rankReadings(
  shape: TitleShape,
  candidates: Candidate[],
  script = false,
): Reading[] {
  if (!context()) return [];
  const { w, h } = grid(shape.box),
    observed = resample(shape, shape.box, w, h),
    known = knownGrid(shape, shape.box, w, h),
    ratio = shape.box.width / shape.box.height;
  const seen = new Set<string>(),
    out: Reading[] = [];
  for (const candidate of candidates) {
    const content = candidate.content.trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    let best: Reading | undefined;
    const faces = installedFaces(),
      scripts = faces.filter((f) => scriptFamilies.includes(f.family));
    for (const face of script && scripts.length ? scripts : faces) {
      const template = raster(content, face, w, h);
      if (!template) continue;
      const fit = overlap(observed, template.bits, known) * proportion(template.ratio, ratio, 0.3);
      if (!best || fit > best.fit) best = { ...candidate, content, ...face, fit };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.fit - a.fit);
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const LW = 16,
  LH = 24;
/** Decode separated display capitals letter by letter.
 *
 * Column gaps split the mask into strokes; dynamic programming joins up to three neighboring
 * strokes per letter so a letter broken by a damaged pixel column is still read whole. Returns
 * nothing for connected scripts or when letters are not individually convincing. */
export function decodeCapitals(shape: TitleShape, faces = installedFaces()) {
  if (!context() || !faces.length) return;
  const { box, mask, stride } = shape;
  const ink: number[] = [];
  for (let x = 0; x < box.width; x++) {
    let n = 0;
    for (let y = 0; y < box.height; y++) n += mask[(box.y + y) * stride + box.x + x];
    ink.push(n);
  }
  const strokes: { x: number; end: number }[] = [];
  for (let x = 0; x < box.width; x++) {
    if (!ink[x]) continue;
    const last = strokes.at(-1);
    if (last && last.end === x) last.end = x + 1;
    else strokes.push({ x, end: x + 1 });
  }
  // Serifs and tight spacing join neighboring letters through thin columns. Split a stroke wider
  // than a letter at columns holding only a hairline of ink; a letter split this way (the bar of
  // an H) is rejoined below.
  const hairline = Math.max(1, Math.round(box.height * 0.08));
  for (let k = 0; k < strokes.length; k++) {
    const q = strokes[k];
    if (q.end - q.x <= box.height * 0.75) continue;
    for (let x = q.x + 2; x < q.end - 2; x++) {
      if (ink[x] > hairline) continue;
      const window = ink.slice(Math.max(q.x, x - 3), Math.min(q.end, x + 4));
      if (ink[x] > Math.min(...window)) continue;
      strokes.splice(k, 1, { x: q.x, end: x }, { x: x + 1, end: q.end });
      break;
    }
  }
  if (!strokes.length || strokes.length > 40) return;
  // Tight vertical extent of a horizontal span.
  const span = (x: number, end: number) => {
    let top = box.height,
      bottom = -1;
    for (let y = 0; y < box.height; y++)
      for (let xx = x; xx < end; xx++)
        if (mask[(box.y + y) * stride + box.x + xx]) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          break;
        }
    return { x: box.x + x, y: box.y + top, width: end - x, height: bottom - top + 1 };
  };
  const groups: {
    from: number;
    to: number;
    box: TitleShape["box"];
    bits: Uint8Array;
    known?: Uint8Array;
  }[] = [];
  for (let from = 0; from < strokes.length; from++)
    for (let to = from; to < Math.min(strokes.length, from + 4); to++) {
      const b = span(strokes[from].x, strokes[to].end);
      // A letter is never much wider than the line is tall.
      if (b.width > box.height * 1.6 || b.height < box.height * 0.55) continue;
      groups.push({ from, to, box: b, bits: resample(shape, b, LW, LH), known: knownGrid(shape, b, LW, LH) });
    }
  let best: { content: string; fit: number; weakest: number; hidden: number; face: Face } | undefined;
  // A letter mostly hidden behind a subject is matched on its visible strokes but cannot be
  // required to match convincingly; it is counted so the reading can be flagged for review.
  const exposure = groups.map((g) => (g.known ? g.known.reduce((t, v) => t + v, 0) / g.known.length : 1));
  for (const face of faces) {
    const templates = [...LETTERS].map((ch) => raster(ch, face, LW, LH));
    const score = groups.map((g) => {
      let top = 0,
        letter = "";
      const ratio = g.box.width / g.box.height;
      templates.forEach((t, i) => {
        if (!t) return;
        const fit = overlap(g.bits, t.bits, g.known) * proportion(t.ratio, ratio, 0.5);
        if (fit > top) {
          top = fit;
          letter = LETTERS[i];
        }
      });
      return { top, letter };
    });
    // Maximize width-weighted fit over a partition of the strokes into letters.
    const total = new Float64Array(strokes.length + 1).fill(-Infinity),
      via = new Int32Array(strokes.length + 1).fill(-1);
    total[0] = 0;
    for (let end = 1; end <= strokes.length; end++)
      groups.forEach((g, i) => {
        if (g.to !== end - 1 || total[g.from] === -Infinity) return;
        const value = total[g.from] + score[i].top * g.box.width;
        if (value > total[end]) {
          total[end] = value;
          via[end] = i;
        }
      });
    if (total[strokes.length] === -Infinity) continue;
    let content = "",
      width = 0,
      weakest = 1,
      hidden = 0;
    for (let end = strokes.length; end > 0; ) {
      const i = via[end];
      content = score[i].letter + content;
      width += groups[i].box.width;
      if (exposure[i] < 0.6) hidden++;
      else weakest = Math.min(weakest, score[i].top);
      end = groups[i].from;
    }
    const fit = total[strokes.length] / Math.max(1, width);
    if (weakest >= 0.3 && hidden <= Math.floor(content.length / 4) && content.length <= 24 && (!best || fit > best.fit))
      best = { content, fit, weakest, hidden, face };
  }
  return best;
}

/** One face for a group of titles set in the same lettering. */
export function sharedFace(shapes: { shape: TitleShape; content: string }[]) {
  let best: (Face & { fit: number }) | undefined;
  for (const face of installedFaces()) {
    let sum = 0;
    for (const s of shapes) sum += wordFit(s.shape, s.content, face);
    const fit = sum / Math.max(1, shapes.length);
    if (!best || fit > best.fit) best = { ...face, fit };
  }
  return best;
}

/** Wordings built letter by letter from two equally long readings of the same lettering, taking
 * each differing letter from one or the other. Every letter of every result was read by some
 * measurement; none is invented. At most four differing positions are combined. */
/** Wordings assembled from several partial OCR readings of one lettering. A shorter reading that
 * sits inside a longer one (at its start, end or middle, in exactly one best place) and differs
 * from it in at most one letter in three corrects the longer reading where they disagree: OCR
 * read "HON" at the start and "HOFORABLE" across a word gives "HONORABLE". Nothing here is
 * accepted on its own: each wording competes on how well it draws the measured strokes. */
export function fragmentMerges(fragments: readonly string[]) {
  const words = [...new Set(fragments.filter((f) => f.length >= 3))];
  const out = new Set<string>();
  for (const long of words) {
    if (long.length < 5) continue;
    const merged = [...long];
    let changed = false;
    for (const short of words) {
      if (short.length >= long.length) continue;
      const misses = Array.from({ length: long.length - short.length + 1 }, (_, at) => [...short].filter((ch, i) => ch !== long[at + i]).length);
      const fewest = Math.min(...misses);
      if (fewest === 0 || fewest > Math.floor(short.length / 3) || misses.filter((m) => m === fewest).length > 1) continue;
      const at = misses.indexOf(fewest);
      [...short].forEach((ch, i) => {
        if (merged[at + i] !== ch) {
          merged[at + i] = ch;
          changed = true;
        }
      });
    }
    const word = merged.join("");
    if (changed && !words.includes(word)) out.add(word);
  }
  return [...out];
}

/** Whether an OCR piece is part of a word: it sits inside it (letters only, any case) with at
 * most one letter in three different. */
export function pieceOf(piece: string, word: string) {
  const a = piece.replace(/[^\p{L}\p{N}]/gu, "").toLocaleUpperCase(),
    b = word.replace(/[^\p{L}\p{N}]/gu, "").toLocaleUpperCase();
  if (a.length < 2 || a.length > b.length) return false;
  for (let at = 0; at + a.length <= b.length; at++)
    if ([...a].filter((ch, i) => ch !== b[at + i]).length <= Math.floor(a.length / 3)) return true;
  return false;
}

export function letterCombinations(a: string, b: string) {
  if (a.length !== b.length || a === b) return [];
  const differ = [...a].flatMap((ch, i) => (ch !== b[i] ? [i] : []));
  if (differ.length > 4) return [];
  const out: string[] = [];
  for (let mask = 0; mask < 1 << differ.length; mask++) {
    const letters = [...a];
    differ.forEach((i, k) => {
      if (mask & (1 << k)) letters[i] = b[i];
    });
    const word = letters.join("");
    if (word !== a && word !== b) out.push(word);
  }
  return out;
}
