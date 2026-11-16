import type { Asset, Clip, Project } from "../../project-schema";
import { resolveClip } from "../../animation";
import { point, layerTransforms, canvasMatrix } from "../../animation/affine";
import { socialSafeArea } from "../../typography/model";
import type { TextAppearance } from "./appearance";

// The foreground video is contain-fitted before crop, parent transforms and canvas clipping.
// Blurred backing layers are not part of the composition the reference title belongs to.
export function visiblePicture(
  p: Project,
  c: Clip,
  asset: Asset,
  frame: number,
) {
  const { width: w, height: h } = p.settings,
    fit = Math.min(w / asset.width, h / asset.height);
  const crop = resolveClip(c, frame).crop;
  const xs = [
    Math.max((-asset.width * fit) / 2, (crop.cropLeft - 0.5) * w),
    Math.min((asset.width * fit) / 2, (0.5 - crop.cropRight) * w),
  ];
  const ys = [
    Math.max((-asset.height * fit) / 2, (crop.cropTop - 0.5) * h),
    Math.min((asset.height * fit) / 2, (0.5 - crop.cropBottom) * h),
  ];
  if (xs[0] >= xs[1] || ys[0] >= ys[1]) return;
  const matrix = canvasMatrix(p, layerTransforms(p, frame).world(c.id));
  const corners = xs.flatMap((x) => ys.map((y) => point(matrix, x, y)));
  const left = Math.max(0, Math.min(...corners.map((q) => q.x))),
    right = Math.min(w, Math.max(...corners.map((q) => q.x)));
  const top = Math.max(0, Math.min(...corners.map((q) => q.y))),
    bottom = Math.min(h, Math.max(...corners.map((q) => q.y)));
  if (right > left && bottom > top) return { left, right, top, bottom };
}
export function projectInk(
  p: Project,
  picture: NonNullable<ReturnType<typeof visiblePicture>>,
  box: Pick<TextAppearance, "x" | "y" | "width" | "height">,
  safe: boolean,
) {
  const { width: w, height: h } = p.settings,
    pw = picture.right - picture.left,
    ph = picture.bottom - picture.top;
  const bounds = safe
    ? socialSafeArea(w, h)
    : { left: 0, right: w, top: 0, bottom: h };
  const left = Math.max(picture.left, bounds.left),
    right = Math.min(picture.right, bounds.right),
    top = Math.max(picture.top, bounds.top),
    bottom = Math.min(picture.bottom, bounds.bottom);
  if (right - left < 1 || bottom - top < 1) return;
  const width = Math.min(right - left, box.width * pw),
    height = Math.min(bottom - top, box.height * ph);
  if (width < 1 || height < 1) return;
  return {
    width,
    height,
    x:
      Math.max(
        left + width / 2,
        Math.min(
          right - width / 2,
          picture.left + (box.x + box.width / 2) * pw,
        ),
      ) -
      w / 2,
    y:
      Math.max(
        top + height / 2,
        Math.min(
          bottom - height / 2,
          picture.top + (box.y + box.height / 2) * ph,
        ),
      ) -
      h / 2,
  };
}
