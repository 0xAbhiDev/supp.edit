import type { TextStyle } from "../typography/model";
import { drawText, layoutText } from "../typography/render";
/** Compose glyphs, strokes, shadows and backgrounds before layer opacity/filtering. */
export function textSurface(text: TextStyle, resolution: number) {
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d")!,
    bounds = layoutText(ctx, text);
  const scale = Math.min(
    1,
    resolution,
    4096 / bounds.width,
    4096 / bounds.height,
  );
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  ctx.scale(scale, scale);
  ctx.translate(-bounds.left, -bounds.top);
  drawText(ctx, text);
  return {
    canvas,
    left: bounds.left,
    top: bounds.top,
    width: canvas.width / scale,
    height: canvas.height / scale,
  };
}
