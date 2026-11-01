import { type Edit, deleteClip } from "./index";
import { fps } from "../project-schema";
import { inComposition } from "./compositions";
import {
  sequenceRevisionSchema,
  type SequenceRevision,
} from "../ai/revisions/model";

/** A bounded patch to existing layers, never a replacement composition graph. */
export function reviseSequence(input: SequenceRevision): Edit {
  const edit = sequenceRevisionSchema.parse(input);
  return (p) => {
    const c = p.compositions.find((c) => c.id === edit.sequenceId);
    if (!c) throw new Error("Choose an existing sequence to revise");
    const ids = [...edit.changes.map((x) => x.clipId), ...edit.remove];
    if (new Set(ids).size !== ids.length)
      throw new Error("Repeated revision layer");
    for (const id of ids) {
      const clip = c.layers.find((x) => x.id === id);
      if (!clip || c.tracks.find((t) => t.id === clip.trackId)?.locked)
        throw new Error("A revision layer is missing or locked");
    }
    inComposition(c.id, (view) => {
      for (const change of edit.changes) {
        const clip = view.clips.find((x) => x.id === change.clipId)!;
        if (change.source) {
          const source = view.assets.find(
            (a) => a.id === change.source!.assetId,
          );
          if (
            !source ||
            source.fingerprint !== change.source.fingerprint ||
            source.kind !== "video" ||
            clip.kind !== "media"
          )
            throw new Error(
              "Replacement source is missing, changed, or incompatible",
            );
          clip.assetId = source.id;
          clip.sourceIn = change.source.sourceIn;
          clip.name = source.name;
        }
        const source = view.assets.find((a) => a.id === clip.assetId);
        if (
          source &&
          source.kind !== "image" &&
          clip.sourceIn + change.duration >
            Math.floor(source.duration * fps(view))
        )
          throw new Error("Revision exceeds the available source range");
        clip.start = change.start;
        clip.duration = change.duration;
      }
      for (const id of edit.remove) deleteClip(id)(view);
      for (const marker of edit.markers) {
        const existing = view.markers.find((m) => m.id === marker.id);
        if (!existing) throw new Error("Revision marker no longer exists");
        existing.frame = marker.frame;
      }
    })(p);
    c.duration = edit.duration;
    c.revisions = [...(c.revisions ?? []), edit.record].slice(-100);
  };
}
