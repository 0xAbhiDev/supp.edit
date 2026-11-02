import { editable, type Edit } from "./index";
import { timeRemapSchema, type TimeRemap, speedAt } from "../time-remap/model";
import { fps } from "../project-schema";
/** Change speed inside the existing timeline span. Source consumption changes; following cuts stay put. */
export function setTimeRemap(id: string, input: TimeRemap | undefined): Edit {
  const map = input ? timeRemapSchema.parse(input) : undefined;
  return (p) => {
    const c = editable(p, id);
    if (!c) throw new Error("Select an unlocked clip to edit speed");
    if (map) c.timeRemap = structuredClone(map);
    else {
      const asset = p.assets.find((a) => a.id === c.assetId);
      if (asset && c.sourceIn + c.duration > asset.duration * fps(p) + 1e-8)
        throw new Error(
          "Trim this clip before restoring normal speed; there is not enough source media",
        );
      delete c.timeRemap;
    }
  };
}
export function setSpeedKey(
  id: string,
  frame: number,
  speed: number,
  easing: "linear" | "smooth" = "smooth",
): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c) throw new Error("Select an unlocked clip to edit speed");
    const map = c.timeRemap ?? {
      sourceOffset: 0,
      keys: [{ frame: 0, speed: 1, easing: "smooth" as const }],
    };
    const keys = map.keys.filter((k) => k.frame !== frame);
    keys.push({ frame, speed, easing });
    keys.sort((a, b) => a.frame - b.frame);
    setTimeRemap(id, { ...map, keys })(p);
  };
}
export function removeSpeedKey(id: string, frame: number): Edit {
  return (p) => {
    const c = editable(p, id);
    if (!c?.timeRemap) return;
    const keys = c.timeRemap.keys.filter((k) => k.frame !== frame);
    setTimeRemap(id, {
      ...c.timeRemap,
      keys: keys.length
        ? keys
        : [{ frame: 0, speed: speedAt(c, frame), easing: "smooth" }],
    })(p);
  };
}
