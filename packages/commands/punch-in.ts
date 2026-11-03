import { newClip } from "../project-schema";
import { editable, type Edit } from "./index";
import { setParent } from "./parenting";
/** A separate ordinary null controller composes with the shot's camera keys. */
export function addPunchIn(
  clipId: string,
  controllerId: string,
  amount: number,
  peak: number,
  baseScale = 1,
): Edit {
  return (p) => {
    const c = editable(p, clipId);
    if (
      !c ||
      c.kind !== "media" ||
      p.tracks.find((t) => t.id === c.trackId)?.kind !== "video"
    )
      throw new Error("Punch-in requires an unlocked video layer");
    if (c.parentId)
      throw new Error(
        "Review the existing parent before adding a punch-in controller",
      );
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 0.07 ||
      !Number.isFinite(baseScale) ||
      baseScale < 0.94 ||
      baseScale > 1.04 ||
      baseScale * (1 + amount) > 1.09 ||
      !Number.isInteger(peak) ||
      peak <= 0 ||
      peak >= c.duration - 1
    )
      throw new Error("Invalid punch-in amount or timing");
    if (p.clips.some((c) => c.id === controllerId))
      throw new Error("Punch-in controller already exists");
    const controller = newClip(c.trackId, c.start, c.duration, "null");
    controller.id = controllerId;
    controller.name = `${amount ? "Punch-in" : "Framing treatment"} · ${c.name}`;
    p.clips.push(controller);
    setParent(c.id, controller.id, c.start, true)(p);
    controller.keyframes.scale = amount
      ? [
          { frame: 0, value: baseScale, easing: "ease-in-out" },
          {
            frame: peak,
            value: baseScale * (1 + amount),
            easing: "ease-in-out",
          },
          { frame: c.duration - 1, value: baseScale, easing: "linear" },
        ]
      : [{ frame: 0, value: baseScale, easing: "linear" }];
  };
}
