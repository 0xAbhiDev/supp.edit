import {
  type BezierMask,
  type MaskVertex,
  type MaskProperty,
  masksSchema,
  bezierMaskSchema,
} from "../masks/model";
import { resolveMask, maskVertices } from "../masks/evaluate";
import { editable, type Edit } from "./index";
import type { Project } from "../project-schema";
function layer(p: Project, id: string) {
  const c = editable(p, id);
  if (
    !c ||
    c.kind === "null" ||
    p.tracks.find((t) => t.id === c.trackId)?.kind !== "video"
  )
    throw new Error("Select an unlocked visual layer to edit masks");
  return c;
}
export function addMask(id: string, mask: BezierMask): Edit {
  return (p) => {
    const c = layer(p, id);
    c.masks = masksSchema.parse([...c.masks, mask]);
  };
}
export function editMask(
  id: string,
  maskId: string,
  edit: (m: BezierMask) => void,
): Edit {
  return (p) => {
    const c = layer(p, id),
      m = c.masks.find((m) => m.id === maskId);
    if (!m) throw new Error("Mask no longer exists");
    edit(m);
    bezierMaskSchema.parse(m);
  };
}
export function deleteMask(id: string, maskId: string): Edit {
  return (p) => {
    const c = layer(p, id);
    c.masks = c.masks.filter((m) => m.id !== maskId);
  };
}
export function reorderMask(id: string, maskId: string, delta: number): Edit {
  return (p) => {
    const c = layer(p, id),
      i = c.masks.findIndex((m) => m.id === maskId),
      to = Math.max(0, Math.min(c.masks.length - 1, i + delta));
    if (i < 0) throw new Error("Mask no longer exists");
    c.masks.splice(to, 0, c.masks.splice(i, 1)[0]);
  };
}
export function setMaskProperty(
  id: string,
  maskId: string,
  key: MaskProperty,
  value: number,
  frame: number,
): Edit {
  return (p) => {
    const c = layer(p, id);
    editMask(id, maskId, (m) => {
      const keys = m.keyframes[key],
        time = Math.round(frame - c.start);
      if (!keys.length) m[key] = value;
      else {
        const k = keys.find((k) => k.frame === time);
        if (k) k.value = value;
        else keys.push({ frame: time, value, easing: "linear" });
      }
    })(p);
  };
}
export function toggleMaskKey(
  id: string,
  maskId: string,
  key: MaskProperty | "path",
  frame: number,
): Edit {
  return (p) => {
    const c = layer(p, id);
    editMask(id, maskId, (m) => {
      const time = Math.round(frame - c.start),
        resolved = resolveMask(m, time);
      if (key === "path") {
        const index = m.pathKeys.findIndex((k) => k.frame === time);
        if (index >= 0) {
          m.pathKeys.splice(index, 1);
          if (!m.pathKeys.length) m.vertices = resolved.vertices;
        } else
          m.pathKeys.push({
            frame: time,
            easing: "linear",
            vertices: resolved.vertices.map((v) => ({
              ...v,
              in: { ...v.in },
              out: { ...v.out },
            })),
          });
      } else {
        const keys = m.keyframes[key],
          i = keys.findIndex((k) => k.frame === time);
        if (i >= 0) {
          keys.splice(i, 1);
          if (!keys.length) m[key] = resolved[key];
        } else
          keys.push({ frame: time, value: resolved[key], easing: "linear" });
      }
    })(p);
  };
}
export function setMaskVertices(
  id: string,
  maskId: string,
  vertices: MaskVertex[],
  frame: number,
): Edit {
  return (p) => {
    const c = layer(p, id);
    editMask(id, maskId, (m) => {
      if (!m.pathKeys.length) m.vertices = vertices;
      else {
        if (
          vertices.length !== m.vertices.length ||
          vertices.some((v, i) => v.id !== m.vertices[i].id)
        )
          throw new Error(
            "Clear path animation before changing vertex topology",
          );
        const time = Math.round(frame - c.start),
          k = m.pathKeys.find((k) => k.frame === time);
        if (k) k.vertices = vertices;
        else m.pathKeys.push({ frame: time, easing: "linear", vertices });
      }
    })(p);
  };
}
export function clearMaskAnimation(
  id: string,
  maskId: string,
  frame: number,
): Edit {
  return (p) => {
    const c = layer(p, id);
    editMask(id, maskId, (m) => {
      m.vertices = maskVertices(m, frame - c.start);
      m.pathKeys = [];
    })(p);
  };
}
