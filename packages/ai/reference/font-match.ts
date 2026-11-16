import type { TextAppearance } from "./appearance";
import { fontFamilies } from "../../typography/fonts";
export function measureTitleInk(
  ctx: CanvasRenderingContext2D,
  content: string,
  family: string,
  weight: "400" | "700" | "900",
) {
  ctx.save();
  ctx.font = weight + " 96px " + family;
  ctx.textBaseline = "middle";
  const m = ctx.measureText(content);
  ctx.restore();
  const w = m.actualBoundingBoxRight + m.actualBoundingBoxLeft,
    h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (w <= 0 || h <= 0) return;
  return {
    widthEm: w / 96,
    heightEm: h / 96,
    centerXEm:
      (m.actualBoundingBoxRight - m.actualBoundingBoxLeft - m.width) / 192,
    centerYEm: (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 192,
  };
}

/** Compare the visible, normalized OCR ink to locally rendered glyphs. No font files leave the device. */
export async function matchReferenceFonts(lines: TextAppearance[], aspect = 1) {
  if (typeof document === "undefined") return lines;
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 80;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return lines;
  // FontFaceSet.check also returns true for unknown system fonts. Compare against two fallback faces.
  const installed = fontFamilies.filter((f) =>
    ["monospace", "serif"].some((base) => {
      ctx.font = "43px " + base;
      const a = ctx.measureText("WmiQ90").width;
      ctx.font = '43px "' + f + '",' + base;
      return Math.abs(a - ctx.measureText("WmiQ90").width) > 0.1;
    }),
  );
  const cache = new Map<string, { rows: number[]; ratio: number }>();
  const sample = (text: string, family: string, weight: string) => {
    const key = JSON.stringify([text, family, weight]);
    const cached = cache.get(key);
    if (cached) return cached;
    ctx.font = weight + ' 48px "' + family + '"';
    const m = ctx.measureText(text);
    const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
      height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (width <= 0 || height <= 0) return;
    ctx.clearRect(0, 0, 32, 16);
    ctx.save();
    ctx.scale(32 / width, 16 / height);
    ctx.fillText(text, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
    ctx.restore();
    const data = ctx.getImageData(0, 0, 32, 16).data;
    const rows = Array.from({ length: 16 }, (_, y) => {
      let bits = 0;
      for (let x = 0; x < 32; x++)
        if (data[(32 * y + x) * 4 + 3] >= 100) bits |= 1 << x;
      return bits >>> 0;
    });
    const entry = { rows, ratio: width / height };
    cache.set(key, entry);
    return entry;
  };
  const pop = (n: number) => {
    let count = 0;
    for (let v = n >>> 0; v; v = (v & (v - 1)) >>> 0) count++;
    return count;
  };
  return lines.map((line) => {
    if (!line.content) return line;
    let best: TextAppearance["face"];
    if (line.glyphRows)
      for (const family of installed)
        for (const weight of ["400", "700", "900"] as const) {
          const shape = sample(line.content, family, weight);
          if (!shape) continue;
          let intersection = 0,
            union = 0;
          line.glyphRows.forEach((r, y) => {
            intersection += pop(r & shape.rows[y]);
            union += pop(r | shape.rows[y]);
          });
          const ratio = (line.width * aspect) / Math.max(0.001, line.height);
          const fit =
            (intersection / Math.max(1, union)) *
            Math.exp(-0.3 * Math.abs(Math.log(shape.ratio / ratio)));
          if (!best || fit > best.fit) best = { family, weight, fit };
        }
    const face = best && best.fit >= 0.48 ? best : undefined;
    const family = face?.family ?? "sans-serif",
      weight = face?.weight ?? "700";
    const metrics = measureTitleInk(ctx, line.content, family, weight);
    return metrics
      ? {
          ...line,
          ...(face
            ? { face, templateRows: sample(line.content, family, weight)?.rows }
            : {}),
          inkMetrics: { family, weight, ...metrics },
        }
      : line;
  });
}
