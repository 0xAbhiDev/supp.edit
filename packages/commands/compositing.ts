import { editable, type Edit } from "./index";
import { type Matte, type BlendMode, assertMattes } from "../compositing/model";
import type { Project } from "../project-schema";
export function matteCandidates(p: Project, id: string) {
  return p.clips.filter((c) => {
    if (
      c.id === id ||
      c.kind === "null" ||
      p.tracks.find((t) => t.id === c.trackId)?.kind !== "video"
    )
      return false;
    const seen = new Set<string>();
    let cursor: typeof c | undefined = c;
    while (cursor?.matte) {
      if (cursor.matte.layerId === id || seen.has(cursor.id)) return false;
      seen.add(cursor.id);
      const nextId: string = cursor.matte.layerId;
      cursor = p.clips.find((c) => c.id === nextId);
    }
    return true;
  });
}
export function setMatte(id: string, matte: Matte | undefined): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) throw new Error("Unlock the layer to change its matte");
    if (matte) c.matte = matte;
    else delete c.matte;
    assertMattes(p);
  };
}
export function setBlendMode(id: string, mode: BlendMode): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) throw new Error("Unlock the layer to change its blend mode");
    c.blendMode = mode;
    assertMattes(p);
  };
}
