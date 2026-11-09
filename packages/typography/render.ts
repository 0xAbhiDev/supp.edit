import type { TextStyle } from "./model";
type Word = {
  text: string;
  index: number;
  x: number;
  y: number;
  width: number;
  scale: number;
  color: string;
  weight: string;
  charStart: number;
  phrase: number;
};
const font = (t: TextStyle, weight: string = t.weight, scale = 1) =>
  `${weight} ${t.size * scale}px ${t.font}`;
const width = (ctx: CanvasRenderingContext2D, s: string, tracking: number) =>
  Math.max(
    0,
    ctx.measureText(s).width + Math.max(0, Array.from(s).length - 1) * tracking,
  );
/** Same layout and glyph painter for CPU, GPU textures and native export. */
export function layoutText(ctx: CanvasRenderingContext2D, t: TextStyle) {
  const rows: Word[][] = [[]];
  let x = 0,
    index = 0,
    chars = 0,
    phrase = 0;
  for (const token of t.content.split(/(\s+)/)) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      chars += Array.from(token).length;
      if (token.includes("\n")) {
        for (let i = 0; i < token.split("\n").length - 1; i++) rows.push([]);
        x = 0;
        phrase++;
      } else {
        ctx.font = font(t);
        x += width(ctx, token, t.tracking) + t.tracking;
      }
      continue;
    }
    const em = t.emphasis.find((e) => e.word === index),
      scale = em?.scale ?? 1,
      weight = em?.weight ?? t.weight;
    ctx.font = font(t, weight, scale * t.highlightScale);
    const w = width(ctx, token, t.tracking);
    if (t.maxWidth && x + w > t.maxWidth && rows.at(-1)!.length) {
      rows.push([]);
      x = 0;
    }
    rows.at(-1)!.push({
      text: token,
      index,
      x,
      y: 0,
      width: w,
      scale,
      color: em?.color ?? t.color,
      weight,
      charStart: chars,
      phrase,
    });
    x += w;
    index++;
    chars += Array.from(token).length;
    if (/[.!?]$/.test(token)) phrase++;
  }
  const maxScale =
      Math.max(1, ...t.emphasis.map((e) => e.scale)) * t.highlightScale,
    line = t.size * t.lineSpacing * maxScale;
  const contentWidth = Math.max(
    1,
    ...rows.map((r) => (r.at(-1) ? r.at(-1)!.x + r.at(-1)!.width : 0)),
  );
  const contentHeight = Math.max(
    t.size * maxScale,
    (rows.length - 1) * line + t.size * maxScale,
  );
  const words = rows.flatMap((row, i) => {
    const w = row.at(-1) ? row.at(-1)!.x + row.at(-1)!.width : 0;
    const shift = t.align === "left" ? 0 : t.align === "right" ? -w : -w / 2;
    return row.map((word) => ({
      ...word,
      x: word.x + shift,
      y: (i - (rows.length - 1) / 2) * line,
    }));
  });
  const pad =
    t.padding +
    t.strokeWidth +
    t.shadowBlur * 2 +
    Math.max(Math.abs(t.shadowX), Math.abs(t.shadowY)) +
    4;
  const left =
    (t.align === "left"
      ? 0
      : t.align === "right"
        ? -contentWidth
        : -contentWidth / 2) - pad;
  return {
    words,
    chars,
    wordCount: index,
    phraseCount: Math.max(1, ...words.map((w) => w.phrase + 1)),
    left,
    top: -contentHeight / 2 - pad,
    width: contentWidth + pad * 2,
    height: contentHeight + pad * 2,
    contentWidth,
    contentHeight,
  };
}
export function drawText(ctx: CanvasRenderingContext2D, t: TextStyle) {
  const l = layoutText(ctx, t);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  if (t.backgroundOpacity > 0 && t.reveal > 0) {
    ctx.save();
    ctx.globalAlpha *= t.backgroundOpacity;
    ctx.fillStyle = t.backgroundColor;
    const x =
      t.align === "left"
        ? 0
        : t.align === "right"
          ? -l.contentWidth
          : -l.contentWidth / 2;
    ctx.beginPath();
    ctx.roundRect(
      x - t.padding,
      -l.contentHeight / 2 - t.padding,
      l.contentWidth + t.padding * 2,
      l.contentHeight + t.padding * 2,
      t.backgroundRadius,
    );
    ctx.fill();
    ctx.restore();
  }
  const visible = Math.ceil(
    t.reveal *
      (t.revealUnit === "words"
        ? l.wordCount
        : t.revealUnit === "phrases"
          ? l.phraseCount
          : l.chars),
  );
  for (const w of l.words) {
    const text =
      t.revealUnit !== "characters"
        ? (t.revealUnit === "words" ? w.index : w.phrase) < visible
          ? w.text
          : ""
        : Array.from(w.text)
            .slice(0, Math.max(0, visible - w.charStart))
            .join("");
    if (!text) continue;
    const active = Math.floor(t.highlight) === w.index;
    ctx.font = font(t, w.weight, w.scale * (active ? t.highlightScale : 1));
    ctx.fillStyle =
      Math.floor(t.highlight) === w.index ? t.highlightColor : w.color;
    ctx.strokeStyle = t.strokeColor;
    ctx.lineWidth = t.strokeWidth;
    ctx.shadowColor = t.shadowColor;
    ctx.shadowBlur = t.shadowBlur;
    ctx.shadowOffsetX = t.shadowX;
    ctx.shadowOffsetY = t.shadowY;
    const paint = (s: string, x: number) => {
      if (t.strokeWidth > 0) ctx.strokeText(s, x, w.y);
      ctx.fillText(s, x, w.y);
    };
    const centered = w.x + (w.width - width(ctx, w.text, t.tracking)) / 2;
    if (!t.tracking) paint(text, centered);
    else {
      let x = centered;
      for (const char of Array.from(text)) {
        paint(char, x);
        x += ctx.measureText(char).width + t.tracking;
      }
    }
  }
  ctx.restore();
  return l;
}
