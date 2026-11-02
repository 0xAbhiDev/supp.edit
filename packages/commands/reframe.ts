import { type Edit } from "./index";
import { reframeSchema, type ReframeChange } from "../ai/reframe/model";
import type { Composition } from "../project-schema";
/** Stable IDs are derived from a plan-owned prefix so preview and Apply create identical graphs. */
export function duplicateSequence(
  sequenceId: string,
  id: string,
  name: string,
): Edit {
  return (p) => {
    const source = p.compositions.find((c) => c.id === sequenceId);
    if (!source) throw Error("Sequence no longer exists");
    if (p.compositions.some((c) => c.id === id))
      throw Error("Duplicate sequence ID already exists");
    const copy = JSON.parse(JSON.stringify(source)) as Composition,
      mapping = new Map<string, string>();
    let index = 0;
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      for (const [key, v] of Object.entries(value)) {
        if (key === "id" && typeof v === "string")
          mapping.set(v, `${id}-${index++}`);
        else visit(v);
      }
    }
    visit(copy);
    mapping.set(source.id, id);
    function remap(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, v]) => [
            key,
            typeof v === "string" &&
            ["id", "trackId", "parentId", "layerId"].includes(key)
              ? (mapping.get(v) ?? v)
              : key === "changedLayerIds" && Array.isArray(v)
                ? v.map((x) => mapping.get(x) ?? x)
                : remap(v),
          ]),
        );
      return value;
    }
    const result = remap(copy) as Composition;
    result.name = name;
    p.compositions.push(result);
  };
}
export function reframeSequence(input: ReframeChange): Edit {
  const change = reframeSchema.parse(input);
  return (p) => {
    const c = p.compositions.find((c) => c.id === change.sequenceId);
    if (!c) throw Error("Reframe sequence no longer exists");
    if (
      new Set(change.changes.map((x) => x.clipId)).size !==
      change.changes.length
    )
      throw Error("Repeated framing layer");
    for (const patch of change.changes) {
      const clip = c.layers.find((l) => l.id === patch.clipId),
        asset = p.assets.find((a) => a.id === patch.assetId);
      if (
        !clip ||
        !asset ||
        asset.kind !== "video" ||
        clip.assetId !== asset.id ||
        asset.fingerprint !== patch.fingerprint ||
        clip.sourceIn !== patch.sourceIn ||
        clip.duration !== patch.duration ||
        JSON.stringify(clip.timeRemap) !== JSON.stringify(patch.timeRemap)
      )
        throw Error("Framing source or range changed");
      if (c.tracks.find((t) => t.id === clip.trackId)?.locked)
        throw Error("Unlock the framing layer first");
      if (
        clip.parentId ||
        clip.matte ||
        c.layers.some(
          (l) => l.parentId === clip.id || l.matte?.layerId === clip.id,
        ) ||
        clip.transform.rotation ||
        clip.transform.scaleX !== 1 ||
        clip.transform.scaleY !== 1 ||
        clip.transform.anchorX ||
        clip.transform.anchorY ||
        clip.parentOffset.some((x, i) => x !== [1, 0, 0, 1, 0, 0][i]) ||
        Object.values(clip.crop).some(Boolean) ||
        [
          "rotation",
          "scaleX",
          "scaleY",
          "anchorX",
          "anchorY",
          "cropLeft",
          "cropRight",
          "cropTop",
          "cropBottom",
        ].some((k) => clip.keyframes[k as keyof typeof clip.keyframes].length)
      )
        throw Error(
          `Resolve parent, matte, rotation, anchor or crop geometry on ${clip.name} before auto-reframing`,
        );
      for (const key of ["x", "y", "scale"] as const) {
        const keys = patch[key];
        if (
          keys[0].frame !== 0 ||
          keys.some(
            (v, i) =>
              v.frame >= clip.duration ||
              (i > 0 && v.frame <= keys[i - 1].frame) ||
              v.easing !== "linear" ||
              (key === "scale"
                ? v.value < 0.01 || v.value > 10
                : Math.abs(v.value) > 32768),
          )
        )
          throw Error("Invalid camera animation");
        clip.keyframes[key] = keys;
        clip.transform[key] = keys[0].value;
      }
    }
    // Resizing overlays would require an explicit layout plan; protect them until that exists.
    if (
      (c.settings.width !== change.width ||
        c.settings.height !== change.height) &&
      c.layers.some(
        (l) =>
          !change.changes.some((x) => x.clipId === l.id) &&
          p.assets.find((a) => a.id === l.assetId)?.kind !== "audio",
      )
    )
      throw Error(
        "This sequence includes other visual layers; arrange them for portrait before automatic framing",
      );
    c.settings.width = change.width;
    c.settings.height = change.height;
    c.revisions = [...(c.revisions ?? []), change.record].slice(-100);
  };
}
