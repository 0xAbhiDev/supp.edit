/** Turn isolated title masks into measured, editable title descriptions.
 *
 * Evidence is layered. A reviewer's wording always wins. Otherwise a wording must be supported
 * by the mask's shape: prior OCR that still fits, a vocal word that fits, or a letter-by-letter
 * decode. A vocal word that does not fit on its own (connected script, a single letter) is
 * accepted only when confirmed neighbors on both sides pin its place in the spoken sequence. */
import type { TextAppearance } from "./appearance";
import { joinedScriptFamilies } from "../../typography/fonts";
import { smoothOutlines } from "./title-outline";
import type { Transcript } from "../transcript";
import { measureTitleInk } from "./font-match";
import {
  exposedVote,
  baselineAngle,
  levelMask,
  trimRows,
  extendIntoHidden,
  glyphRows,
  inkBounds,
  inkRuns,
  lettingDepth,
  titleStrokes,
  type InkBand,
  type InkSample,
} from "./title-ink";
import {
  connectedScript,
  installedFaces,
  letterCombinations,
  decodeCapitals,
  rankReadings,
  sharedFace,
  wordFit,
  type Candidate,
  type Reading,
  type TitleShape,
} from "./title-read";

/** Band colors are kept at half resolution; enough to compare ink with the plate beneath. */
export const COLOR_STRIDE = 2;
export interface InkFrame extends InkSample {
  colors: Uint8Array;
  shot: number;
  /** A brief flat subject flash recolors the plate under the title. */
  flash?: boolean;
  /** Flat colored lettering, read in its own pass. */
  flat?: Uint8Array;
}
export interface InkTitleInput {
  samples: InkFrame[];
  band: InkBand;
  frame: { w: number; h: number };
  endMs: number;
  /** Title center line and vertical reach, in band pixels. */
  centerY: number;
  reach: number;
  seeds: TextAppearance[];
  transcript?: Transcript;
  reviews?: { timeMs: number; content: string }[];
}

const token = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
/** Letters that must change to turn one wording into the other. */
function editDistance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
const shared = (a: number, b: number, c: number, d: number) =>
  Math.max(0, Math.min(b, d) - Math.max(a, c));
const hex = (v: number[]) =>
  "#" + v.map((c) => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, "0")).join("");

interface Measured {
  startMs: number;
  endMs: number;
  frames: InkFrame[];
  shape: TitleShape;
  reading?: Reading;
  evidence?: TextAppearance["evidence"];
  word?: number;
  hints?: string[];
  hidden?: number;
  /** Measured angle; the shape holds the lettering turned level. */
  rotation?: number;
  /** Earlier unreadable run absorbed into this title (a blurred transition into it). */
  absorbed?: boolean;
  depth?: ReturnType<typeof lettingDepth>;
}

/** Decide whether the ink is a flat fill or the plate seen through a difference composite. */
interface Treatment {
  foreground: string;
  differenceInk?: string;
  solid?: number;
  difference?: number;
  spread?: number;
}
function inkTreatment(run: Measured, all: Measured[], samples: InkFrame[], band: InkBand): Treatment {
  const cw = Math.ceil(band.width / COLOR_STRIDE);
  const owner = new Map<InkFrame, Measured>();
  for (const r of all) for (const f of r.frames) owner.set(f, r);
  // Compare like with like: an unlit title frame against unlit plate frames.
  const calm = run.frames.filter((f) => !f.flash && !f.pulsed),
    pool = calm.length ? calm : run.frames,
    key = pool[pool.length >> 1];
  const others = samples
    .filter(
      (f) =>
        owner.get(f) !== run &&
        !f.pulsed &&
        f.shot === key.shot &&
        !f.flash === !key.flash &&
        Math.abs(f.timeMs - key.timeMs) < 900,
    )
    .sort((a, b) => Math.abs(a.timeMs - key.timeMs) - Math.abs(b.timeMs - key.timeMs));
  const fg: number[][] = [],
    bg: (number[] | undefined)[] = [];
  const { box, mask, stride } = run.shape;
  for (let y = box.y + (box.y % 2); y < box.y + box.height; y += COLOR_STRIDE)
    for (let x = box.x + (box.x % 2); x < box.x + box.width; x += COLOR_STRIDE) {
      const p = y * stride + x;
      // Lettering behind a person: sample only what this frame actually shows.
      if (!mask[p] || (run.shape.known && (!key.mask[p] || key.person?.[p]))) continue;
      // Interior pixels only: edges mix ink and plate.
      if (!mask[p - 1] || !mask[p + 1] || !mask[p - stride] || !mask[p + stride]) continue;
      const i = ((y / COLOR_STRIDE) * cw + x / COLOR_STRIDE) * 3;
      fg.push([key.colors[i], key.colors[i + 1], key.colors[i + 2]]);
      const exposed = others.find((f) => {
        const o = owner.get(f);
        return !f.mask[p] && !(o && o.shape.mask[p]);
      });
      bg.push(exposed ? [exposed.colors[i], exposed.colors[i + 1], exposed.colors[i + 2]] : undefined);
    }
  if (fg.length < 12) return { foreground: "#ffffff" };
  const fill = [0, 1, 2].map((c) => median(fg.map((p) => p[c])));
  const spread = median(fg.map((p) => p.reduce((s, v, c) => s + Math.abs(v - fill[c]), 0) / 3));
  const paired = fg.flatMap((p, i) => (bg[i] ? [{ fg: p, bg: bg[i]! }] : []));
  if (paired.length >= 20) {
    const ink = [0, 1, 2].map((c) => Math.min(255, median(paired.map((p) => p.fg[c] + p.bg[c]))));
    const solid = median(paired.map((p) => p.fg.reduce((s, v, c) => s + Math.abs(v - fill[c]), 0) / 3));
    const difference = median(
      paired.map((p) => p.fg.reduce((s, v, c) => s + Math.abs(v - Math.abs(ink[c] - p.bg[c])), 0) / 3),
    );
    if (difference + 2 < solid && difference < 30)
      return {
        foreground: hex(fill),
        differenceInk: ink.every((v) => v >= 228) ? "#ffffff" : hex(ink),
        solid,
        difference,
      };
    if (solid <= 14) return { foreground: hex(fill), solid, difference };
  }
  // No comparable plate. A fill that varies this much across one word is not a flat color.
  return spread > 18 ? { foreground: hex(fill), differenceInk: "#ffffff", spread } : { foreground: hex(fill), spread };
}

export interface InkTitles {
  titles: TextAppearance[];
  /** Readings that rest partly on letters hidden behind a person; shown for review. */
  notes: string[];
  /** Lettering that was isolated but not read with enough evidence to print, with what the
   * decoder and OCR saw there, for a reviewer. */
  unread: { startMs: number; endMs: number; hints: string[] }[];
}
export async function inkTitles(input: InkTitleInput): Promise<InkTitles> {
  const { samples, band, frame, endMs, centerY, reach, seeds, reviews = [] } = input;
  const minimumInk = Math.max(30, band.width * band.height * 0.002);
  const measured: Measured[] = [];
  for (const run of inkRuns(samples, endMs, minimumInk)) {
    // Two frames is the shortest flash an edit holds on screen; a single frame is noise.
    if (run.frames.length < 2) continue;
    const strokesOf = (vote: Uint8Array) =>
      titleStrokes(vote, band.width, band.height, centerY, reach, Math.max(6, band.width * band.height * 0.0001));
    // Assemble the lettering from exposed pixels first, to learn whether a person passes in front
    // of it. Only lettering measured behind a person keeps the occlusion-aware vote; lettering in
    // front is visible over the person and every frame counts.
    const exposed = exposedVote(run.frames, 0.4),
      hiddenStrokes = strokesOf(exposed.ink),
      depth = lettingDepth(run.frames, hiddenStrokes),
      behind = depth.relation === "behind";
    let strokes = behind ? hiddenStrokes : strokesOf(exposedVote(run.frames.map((f) => ({ ...f, person: undefined })), 0.4).ink);
    let known = behind ? exposed.known : undefined;
    let found = inkBounds(strokes, band.width, band.height);
    if (!found || found.count < minimumInk) continue;
    // Lettering set at an angle is read and measured level, about its own center.
    const angle = baselineAngle(strokes, band.width, found);
    let rotation = 0;
    if (Math.abs(angle) >= 2 && Math.abs(angle) <= 30) {
      const cx = found.x + found.width / 2,
        cy = found.y + found.height / 2;
      strokes = levelMask(strokes, band.width, band.height, angle, cx, cy);
      if (known) known = levelMask(known, band.width, band.height, angle, cx, cy);
      const level = inkBounds(strokes, band.width, band.height);
      if (level) {
        found = level;
        rotation = angle;
      }
    }
    let box = trimRows(strokes, band.width, found);
    if (known) box = extendIntoHidden(strokes, known, band.width, box);
    measured.push({
      startMs: run.startMs,
      endMs: run.endMs,
      frames: run.frames as InkFrame[],
      shape: { mask: strokes, stride: band.width, box, ...(known ? { known } : {}) },
      depth,
      ...(rotation ? { rotation } : {}),
    });
  }
  if (!measured.length) return { titles: [], unread: [], notes: [] };
  const notes: string[] = [];
  const words = (input.transcript?.segments ?? []).flatMap((s) => s.words ?? []);
  const forms = (text: string) => {
    const s = text.replace(/[^\p{L}\p{N}'’]/gu, "");
    return s ? [s.toLocaleUpperCase(), s[0].toLocaleUpperCase() + s.slice(1).toLocaleLowerCase(), s.toLocaleLowerCase()] : [];
  };
  const confirmedSeeds = seeds.filter(
    (s) => s.content && s.role !== "persistent-overlay" && s.evidence?.status !== "uncertain",
  );
  const fragmentSeeds = seeds.filter(
    (s) => s.content && s.role !== "persistent-overlay" && s.evidence?.status === "uncertain",
  );
  const ranked = new Map<Measured, Reading[]>();
  for (const run of measured) {
    const length = run.endMs - run.startMs;
    const review = reviews.find((q) => q.timeMs >= run.startMs && q.timeMs < run.endMs);
    const seed = confirmedSeeds
      .filter((s) => shared(s.startMs, s.endMs, run.startMs, run.endMs) > length * 0.5)
      .sort(
        (a, b) =>
          shared(b.startMs, b.endMs, run.startMs, run.endMs) -
          shared(a.startMs, a.endMs, run.startMs, run.endMs),
      )[0];
    const candidates: Candidate[] = [];
    if (review) candidates.push({ content: review.content, origin: "review" });
    if (seed) candidates.push({ content: seed.content!, origin: "seed" });
    for (const w of words)
      if (w.startMs < run.endMs + 400 && w.endMs > run.startMs - 400)
        for (const content of forms(w.text)) candidates.push({ content, origin: "speech" });
    const decoded = decodeCapitals(run.shape);
    if (decoded) candidates.push({ content: decoded.content, origin: "glyphs" });
    // Fragments read by OCR in the same place at the same time, with spacing removed: an
    // occluded word is often read as two pieces.
    const left = (band.x + run.shape.box.x) / frame.w,
      right = (band.x + run.shape.box.x + run.shape.box.width) / frame.w;
    const fragments = fragmentSeeds
      .filter(
        (q) =>
          shared(q.startMs, q.endMs, run.startMs, run.endMs) > 0 &&
          q.x + q.width / 2 > left &&
          q.x + q.width / 2 < right,
      )
      .map((q) => q.content!.replace(/\s+/g, "").toLocaleUpperCase())
      .filter((q) => /^\p{Lu}+$/u.test(q));
    for (const content of new Set(fragments)) candidates.push({ content, origin: "fragment" });
    if (decoded)
      for (const fragment of new Set(fragments))
        for (const content of letterCombinations(decoded.content, fragment))
          candidates.push({ content, origin: "combined" });
    const readings = rankReadings(run.shape, candidates);
    ranked.set(run, readings);
    console.debug(
      "reference title reading",
      run.startMs,
      run.endMs,
      JSON.stringify(readings.slice(0, 6).map((r) => [r.content, r.origin, r.family, r.weight, Number(r.fit.toFixed(3))])),
      decoded ? JSON.stringify([decoded.content, Number(decoded.fit.toFixed(3)), Number(decoded.weakest.toFixed(3))]) : "",
      run.depth ? run.depth.relation + "/" + run.depth.observations.length : "",
      run.shape.known ? "partly hidden" : "",
      run.rotation ? "rotated " + run.rotation.toFixed(1) : "",
    );
    const top = readings[0];
    if (!top) continue;
    const reviewed = readings.find((r) => r.origin === "review");
    if (reviewed) {
      run.reading = reviewed;
      run.evidence = { status: "reviewed", kind: "title", wordStartsMs: [], beatDistanceMs: null };
      continue;
    }
    // A damaged stroke can turn one decoded letter into another. When the decode is within a
    // letter or two of a wording that OCR or the vocal already supplied, and that wording fits
    // nearly as well, that wording stands, whichever of the two happens to rank first.
    const glyphReading = readings.find((r) => r.origin === "glyphs");
    if (glyphReading) {
      // Damage substitutes a letter; it does not add or remove one.
      const name = token(glyphReading.content),
        allowed = Math.floor(name.length / 4);
      const near = readings.find(
        (r) =>
          (r.origin === "seed" || r.origin === "speech") &&
          r.fit >= 0.35 &&
          r.content === r.content.toLocaleUpperCase() &&
          token(r.content).length === name.length &&
          editDistance(token(r.content), name) <= allowed,
      );
      if (near) {
        run.reading = near;
        run.evidence =
          near.origin === "seed"
            ? seed?.evidence
            : { status: "audio-visual", kind: "captioned-speech", wordStartsMs: [], beatDistanceMs: null };
        continue;
      }
    }
    const rival = readings.find((r) => token(r.content) !== token(top.content));
    const kept = readings.find((r) => r.origin === "seed");
    // Prior OCR read these pixels directly; keep it unless another wording fits clearly better.
    if (kept && kept.fit >= 0.35 && top.fit - kept.fit < 0.1) {
      run.reading = kept;
      run.evidence = seed?.evidence;
      continue;
    }
    // A wording assembled from a letter decode and an OCR fragment of the same lettering is
    // accepted when it fits better than either source and both sources span the whole word.
    run.hints = [
      ...(decoded ? [`letter shapes read "${decoded.content}"${decoded.hidden ? ` with ${decoded.hidden} letter${decoded.hidden > 1 ? "s" : ""} mostly hidden` : ""}`] : []),
      ...[...new Set(fragments)].map((q) => `OCR saw "${q}"`),
    ];
    if (decoded?.hidden && run.shape.known) run.hidden = decoded.hidden;
    if (top.origin === "combined" && top.fit >= 0.5) {
      const sources = readings.filter((r) => r.origin === "glyphs" || r.origin === "fragment");
      if (sources.length >= 2 && sources.every((r) => top.fit >= r.fit)) {
        run.reading = top;
        run.evidence = { status: "visual-consensus", kind: "title", wordStartsMs: [], beatDistanceMs: null };
        continue;
      }
    }
    // Letter shapes alone, with neither OCR nor a vocal word behind them, must be held on screen
    // long enough to vote out compression damage. A two-frame flash is left for review.
    const alone = (top.origin === "glyphs" || top.origin === "fragment" || top.origin === "combined") && run.frames.length < 3;
    // An uncertain OCR fragment is evidence only when a measured decode agrees with it exactly.
    const unsupported = top.origin === "fragment" && !(decoded && token(decoded.content) === token(top.content));
    if (!alone && !unsupported && top.fit >= 0.5 && (!rival || top.fit - rival.fit >= 0.05)) {
      // A decode and a vocal word that agree corroborate each other.
      const spoken = readings.some((r) => r.origin === "speech" && token(r.content) === token(top.content));
      run.reading = top;
      run.evidence = spoken
        ? { status: "audio-visual", kind: "captioned-speech", wordStartsMs: [], beatDistanceMs: null }
        : { status: "visual-consensus", kind: "title", wordStartsMs: [], beatDistanceMs: null };
    }
  }
  // Pin confirmed titles to their place in the spoken sequence.
  let floor = -1;
  for (const run of measured) {
    if (!run.reading) continue;
    const mid = (run.startMs + run.endMs) / 2;
    let best = -1;
    words.forEach((w, i) => {
      if (i <= floor || token(w.text) !== token(run.reading!.content)) return;
      const distance = Math.abs((w.startMs + w.endMs) / 2 - mid);
      if (distance < 1200 && (best < 0 || distance < Math.abs((words[best].startMs + words[best].endMs) / 2 - mid)))
        best = i;
    });
    if (best >= 0) {
      run.word = best;
      floor = best;
    }
  }
  measured.forEach((run, k) => {
    if (run.reading) return;
    let before = k - 1,
      after = k + 1;
    while (before >= 0 && measured[before].word === undefined) before--;
    while (after < measured.length && measured[after].word === undefined) after++;
    if (before < 0 || after >= measured.length) return;
    const first = measured[before].word!,
      last = measured[after].word!;
    // Exactly one unassigned spoken word per unread title between two confirmed anchors.
    if (after - before !== last - first) return;
    const word = words[first + k - before];
    // Joined strokes, or no separated face coming close, mark connected script.
    const script =
      connectedScript(run.shape, token(word.text).length) ||
      (token(word.text).length >= 3 && ((ranked.get(run) ?? [])[0]?.fit ?? 0) < 0.3);
    // Connected script is conventionally set with an initial capital; all-capitals script is rare
    // and a weak shape fit cannot tell the cases apart.
    const cases = forms(word.text);
    const readings = rankReadings(
      run.shape,
      (script ? [cases[1]] : cases).map((content) => ({ content, origin: "speech" as const })),
      script,
    );
    // A decode one damaged letter away from the spoken word supports it rather than contradicting it.
    const contradicted = (ranked.get(run) ?? []).find(
      (r) =>
        r.origin === "glyphs" &&
        r.fit >= 0.5 &&
        editDistance(token(r.content), token(word.text)) > Math.floor(token(word.text).length / 4),
    );
    // No installed script reproduces an unknown hand closely enough for shape comparison to
    // rank faces. Prefer one whose letters join, as the measured strokes do.
    if (script && readings[0] && readings[0].fit < 0.3) {
      const joined = joinedScriptFamilies
        .map((name) => installedFaces().find((q) => q.family === name))
        .find((q) => q);
      if (joined)
        readings[0] = { ...readings[0], ...joined, fit: wordFit(run.shape, readings[0].content, joined) };
    }
    if (!readings[0] || contradicted) return;
    run.reading = readings[0];
    run.word = first + k - before;
    run.evidence = { status: "audio-visual", kind: "captioned-speech", wordStartsMs: [], beatDistanceMs: null };
    console.debug("reference title sequence", run.startMs, readings[0].content, readings[0].family, Number(readings[0].fit.toFixed(3)));
  });
  measured.forEach((run, k) => {
    const prior = measured[k - 1];
    if (!run.reading || !prior || prior.reading || run.startMs - prior.endMs > 70) return;
    const a = run.shape.box,
      b = prior.shape.box,
      shared = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (shared < b.width * 0.5) return;
    run.startMs = prior.startMs;
    prior.absorbed = true;
  });
  const accepted = measured.filter((r) => r.reading);
  const treatments = new Map(accepted.map((run) => [run, inkTreatment(run, measured, samples, band)]));
  // Capitals of one size and one compositing are one lettering style; set them in a single face.
  // A flat colored word of the same height is a different style.
  // Light lettering (white, or white composited in difference mode) is one style; a saturated
  // flat fill such as red is another.
  const composite = (r: Measured) => {
    const t = treatments.get(r);
    if (!t || t.differenceInk) return true;
    const rgb = [1, 3, 5].map((i) => parseInt(t.foreground.slice(i, i + 2), 16));
    return Math.min(...rgb) >= 170 && Math.max(...rgb) - Math.min(...rgb) < 60;
  };
  const capitals = accepted.filter((r) => r.reading!.content === r.reading!.content.toLocaleUpperCase() && /\p{L}/u.test(r.reading!.content));
  const blendedCaps = capitals.filter(composite),
    leading = blendedCaps.length >= capitals.length / 2 ? blendedCaps : capitals.filter((r) => !composite(r));
  const capHeight = median(leading.map((r) => r.shape.box.height));
  const family = leading.filter((r) => Math.abs(r.shape.box.height - capHeight) <= capHeight * 0.2);
  let style: { family: string; weight: Reading["weight"] } | undefined;
  if (family.length > 1) {
    const face = sharedFace(family.map((r) => ({ shape: r.shape, content: r.reading!.content })));
    if (face) style = { family: face.family, weight: face.weight };
    if (face)
      for (const r of family)
        r.reading = {
          ...r.reading!,
          family: face.family,
          weight: face.weight,
          fit: wordFit(r.shape, r.reading!.content, face),
        };
  }
  const canvas = typeof document === "undefined" ? undefined : document.createElement("canvas");
  const ctx = canvas?.getContext("2d");
  // Over a dark plate a difference composite and a flat near-white fill look alike. Words of one
  // lettering style share one treatment, so the family's clear majority settles the unclear ones.
  const blended = family.flatMap((r) => treatments.get(r)?.differenceInk ?? []);
  if (family.length > 1 && blended.length >= family.length * 0.6) {
    const ink = blended.sort((a, b) => blended.filter((v) => v === b).length - blended.filter((v) => v === a).length)[0];
    for (const r of accepted.filter(composite)) {
      const t = treatments.get(r)!;
      if (!t.differenceInk) treatments.set(r, { ...t, differenceInk: ink });
    }
  }
  const unread = measured
    .filter((r) => !r.reading && !r.absorbed)
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs, hints: r.hints ?? [] }));
  for (const r of accepted)
    if (r.hidden && r.reading!.origin !== "review")
      notes.push(
        `"${r.reading!.content}" at ${(r.startMs / 1000).toFixed(2)} s has ${r.hidden} letter${r.hidden > 1 ? "s" : ""} mostly hidden behind a person; ` +
          "the reading rests on the visible strokes. Review it before applying.",
      );
  // How the family's words sit: shared center, and how far the face is stretched to their ink.
  const natural = (content: string, face: { family: string; weight: Reading["weight"] }) => {
    const m = ctx ? measureTitleInk(ctx, content, face.family, face.weight) : undefined;
    return m ? m.widthEm / m.heightEm : undefined;
  };
  const setting =
    style && ctx
      ? {
          stretch: median(
            family.flatMap((r) => {
              const n = natural(r.reading!.content, style!);
              return n ? [r.shape.box.width / r.shape.box.height / n] : [];
            }),
          ),
          centerX: median(family.map((r) => r.shape.box.x + r.shape.box.width / 2)),
          centerY: median(family.map((r) => r.shape.box.y + r.shape.box.height / 2)),
          ink: family.map((r) => treatments.get(r)?.differenceInk).find((v) => v),
        }
      : undefined;
  const titles = accepted.map((run) => {
    const { mask, stride } = run.shape;
    let box: { x: number; y: number; width: number; height: number } = run.shape.box,
      reading = run.reading!,
      treatment = treatments.get(run)!;
    // Capitals too damaged to choose a face or a size take the family's setting: its face, cap
    // height, stretch, center and ink. Their wording still comes from their own evidence.
    const capital = reading.content === reading.content.toLocaleUpperCase() && /\p{L}/u.test(reading.content);
    // A reviewer names a word precisely because its pixels could not be read; they cannot size it either.
    if (style && setting && capital && !family.includes(run) && composite(run) === composite(family[0]) && reading.fit < (reading.origin === "review" ? 0.45 : 0.55)) {
      const n = natural(reading.content, style);
      if (n) {
        const height = capHeight,
          width = Math.min(band.width, n * setting.stretch * height);
        box = { x: setting.centerX - width / 2, y: setting.centerY - height / 2, width, height };
        reading = { ...reading, ...style };
        if (setting.ink) treatment = { ...treatment, differenceInk: setting.ink };
      }
    }
    const rotation = run.rotation ?? 0;
    // The same word shown again (turned, moved) keeps the lettering of its clearest occurrence;
    // only its own center and angle are measured here.
    const twin = accepted
      .filter((r) => r !== run && token(r.reading!.content) === token(reading.content) && r.reading!.fit >= 0.45)
      .sort((a, b) => b.reading!.fit - a.reading!.fit)[0];
    if (twin && reading.fit < 0.45) {
      const own = run.shape.box,
        size = twin.shape.box;
      box = { x: own.x + own.width / 2 - size.width / 2, y: own.y + own.height / 2 - size.height / 2, width: size.width, height: size.height };
      reading = { ...reading, family: twin.reading!.family, weight: twin.reading!.weight, fit: twin.reading!.fit };
      if (treatments.get(twin)?.differenceInk) treatment = { ...treatment, differenceInk: treatments.get(twin)!.differenceInk };
    }
    const metrics = ctx ? measureTitleInk(ctx, reading.content, reading.family, reading.weight) : undefined;
    // A face that only approximates the lettering would be stretched to swashes it does not
    // have. Keep its own proportions over the same center and area instead.
    let place = { x: box.x, y: box.y, width: box.width, height: box.height };
    if (metrics && reading.fit < 0.3) {
      const natural = metrics.widthEm / metrics.heightEm,
        area = box.width * box.height;
      const width = Math.min(band.width, Math.sqrt(area * natural)),
        height = width / natural;
      place = {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height,
      };
    }
    const unit = (v: number) => Math.min(1, Math.max(0, v));
    return {
      startMs: run.startMs,
      endMs: run.endMs,
      x: unit((band.x + place.x) / frame.w),
      y: unit((band.y + place.y) / frame.h),
      width: unit(place.width / frame.w),
      height: unit(place.height / frame.h),
      words: reading.content.trim().split(/\s+/).length,
      content: reading.content,
      foreground: treatment.foreground,
      ...(treatment.differenceInk ? { differenceInk: treatment.differenceInk } : {}),
      observations: run.frames.length,
      glyphRows: glyphRows(mask, stride, run.shape.box),
      geometry: [],
      face: { family: reading.family, weight: reading.weight, fit: Math.min(1, Math.max(0, reading.fit)) },
      ...(metrics ? { inkMetrics: { family: reading.family, weight: reading.weight, ...metrics } } : {}),
      evidence: run.evidence,
      ...(run.depth && run.depth.relation !== "unknown" ? { depth: run.depth } : {}),
      ...(rotation ? { rotation: Number(rotation.toFixed(2)) } : {}),
      // No installed face resembles this lettering, and enough frames agree on its strokes:
      // keep the measured letterforms themselves as an editable vector shape.
      ...(reading.fit < 0.3 && !rotation && run.frames.length >= 6 && !run.shape.known
        ? (() => {
            const outline = smoothOutlines(mask, stride, run.shape.box).map((o) => ({
              hole: o.hole,
              points: o.points.map(([x, y]) => [unit((band.x + x) / frame.w), unit((band.y + y) / frame.h)] as [number, number]),
            }));
            return outline.length ? { outline } : {};
          })()
        : {}),
    } satisfies TextAppearance;
  });
  return { titles, unread, notes };
}
