import type { Edit } from "./index";
import type { Treatment } from "../ai/revisions/treatment-model";
import type { RevisionRecord } from "../ai/revisions/model";
export function rememberTreatments(sequenceId: string): Edit {
  return (p) => {
    const c = p.compositions.find((c) => c.id === sequenceId);
    if (!c?.ai)
      throw new Error(
        "Only an AI-created sequence has generated treatment baselines",
      );
    c.ai.generated = JSON.parse(
      JSON.stringify(
        c.layers.map((l) => ({
          clipId: l.id,
          gain: l.gain,
          gainKeys: l.keyframes.gain,
          scale: l.transform.scale,
          scaleKeys: l.keyframes.scale,
          timeRemap: l.timeRemap ?? null,
          effects: l.effectStack,
        })),
      ),
    );
  };
}
export function reviseTreatments(
  sequenceId: string,
  changes: Treatment[],
  record: RevisionRecord,
  generated: Treatment[] = changes,
): Edit {
  return (p) => {
    const c = p.compositions.find((c) => c.id === sequenceId);
    if (!c) throw new Error("Sequence no longer exists");
    if (new Set(changes.map((x) => x.clipId)).size !== changes.length)
      throw new Error("Repeated treatment layer");
    for (const change of changes) {
      const l = c.layers.find((l) => l.id === change.clipId);
      if (!l || c.tracks.find((t) => t.id === l.trackId)?.locked)
        throw new Error("Treatment layer is missing or locked");
      if (change.gain !== undefined) l.gain = change.gain;
      if (change.gainKeys) l.keyframes.gain = change.gainKeys;
      if (change.scale !== undefined) l.transform.scale = change.scale;
      if (change.scaleKeys) l.keyframes.scale = change.scaleKeys;
      if (change.timeRemap !== undefined) {
        if (change.timeRemap) l.timeRemap = change.timeRemap;
        else delete l.timeRemap;
      }
      if (change.effects) l.effectStack = change.effects;
      const baseline = c.ai?.generated?.find((b) => b.clipId === l.id);
      const automatic = generated.find((g) => g.clipId === l.id);
      if (baseline && automatic)
        Object.assign(baseline, JSON.parse(JSON.stringify(automatic)));
    }
    c.revisions = [...(c.revisions ?? []), record].slice(-100);
  };
}
