import type { Project } from "../project-schema";
import { sourceFrameAt, timeRemapSchema } from "./model";
/** Only remapped clips pay for the additional source-bound validation at history boundaries. */
export function assertTimeRemaps(p: Project) {
  const scopes = [{ settings: p.settings, layers: p.clips }, ...p.compositions];
  if (!scopes.some((s) => s.layers.some((c) => c.timeRemap))) return;
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  for (const scope of scopes)
    for (const c of scope.layers) {
      if (!c.timeRemap) continue;
      timeRemapSchema.parse(c.timeRemap);
      const asset = assets.get(c.assetId ?? "");
      if (c.kind !== "media" || !asset || asset.kind === "image")
        throw new Error("Speed ramps require a video or audio source");
      const end = sourceFrameAt(c, c.duration),
        rate = scope.settings.fps.num / scope.settings.fps.den;
      if (sourceFrameAt(c, 0) < 0 || end > asset.duration * rate + 1e-7)
        throw new Error("Speed ramp exceeds source duration");
      if (
        c.duration / rate > 300 ||
        end / rate - sourceFrameAt(c, 0) / rate > 300
      )
        throw new Error(
          "A speed-remapped clip supports up to 5 minutes of source and timeline duration",
        );
    }
}
