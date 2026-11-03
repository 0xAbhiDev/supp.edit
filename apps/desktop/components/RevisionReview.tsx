import { useMemo, useState } from "react";
import {
  type EditPreview,
  isEditPreviewCurrent,
  applyEditPreview,
} from "../../../packages/ai/editor-agent/execution";
import { useEditor } from "../../../packages/editor-state";
import { compositionView } from "../../../packages/commands/compositions";
import { SequencePreview } from "./SequencePreview";
export function RevisionReview({
  preview,
  onCancel,
}: {
  preview: EditPreview;
  onCancel: () => void;
}) {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    history = useEditor((s) => s.historyNames);
  const [original] = useState(project),
    [applied, setApplied] = useState(false),
    [error, setError] = useState("");
  const call = preview.plan.commands.find(
    (c) => c.tool === "sequence.revise" || c.tool === "sequence.treatment",
  );
  const view = useMemo(
    () =>
      compositionView(
        preview.project,
        preview.plan.resultCompositionId ?? null,
      ),
    [preview],
  );
  if (!call) return null;
  const before = original.compositions.find((c) => c.id === call.sequenceId)!,
    after = preview.project.compositions.find((c) => c.id === call.sequenceId)!;
  const rate = before.settings.fps.num / before.settings.fps.den;
  const unchanged = (key: "masks" | "effectStack" | "keyframes" | "effects") =>
    before.layers.filter((c) => {
      const next = after.layers.find((l) => l.id === c.id);
      return next && JSON.stringify(c[key]) === JSON.stringify(next[key]);
    }).length;
  const current = isEditPreviewCurrent(preview, project, revision),
    label = "AI Revision: " + preview.plan.summary;
  function apply() {
    try {
      const s = useEditor.getState();
      s.execute(label, applyEditPreview(preview, s.project, s.revision));
      if (useEditor.getState().project !== s.project) {
        s.setComposition(call!.sequenceId);
        setApplied(true);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="revision-review" aria-label="AI revision plan">
      <h3>AI REVISION PLAN</h3>
      <p>Request: {call.record.request}</p>
      <p>{preview.plan.summary}</p>
      <h4>Planned changes</h4>
      <ul>
        {call.tool === "sequence.treatment"
          ? call.changes.map((change) => (
              <li key={change.clipId}>
                {before.layers.find((l) => l.id === change.clipId)?.name}:{" "}
                {change.gain !== undefined
                  ? `base gain ${change.gain.toFixed(1)} dB; `
                  : ""}
                {change.gainKeys
                  ? `${change.gainKeys.length} editable gain keys; `
                  : ""}
                {change.timeRemap === null ? "normal playback speed; " : ""}
                {change.scaleKeys
                  ? `${change.scaleKeys.length} scale keys; `
                  : ""}
                {change.effects ? `${change.effects.length} effects` : ""}
              </li>
            ))
          : call.changes.map((change) => {
              const old = before.layers.find((l) => l.id === change.clipId)!;
              return (
                <li key={old.id}>
                  {old.name}:{" "}
                  {change.source
                    ? `replace source with ${project.assets.find((a) => a.id === change.source!.assetId)?.name}; `
                    : ""}
                  {old.start !== change.start
                    ? `move ${(old.start / rate).toFixed(2)}s → ${(change.start / rate).toFixed(2)}s; `
                    : ""}
                  {old.duration !== change.duration
                    ? `duration ${(old.duration / rate).toFixed(2)}s → ${(change.duration / rate).toFixed(2)}s`
                    : "duration unchanged"}
                </li>
              );
            })}
        {("remove" in call ? call.remove : []).map((id) => (
          <li key={id}>
            Remove {before.layers.find((l) => l.id === id)?.name}
          </li>
        ))}
      </ul>
      <p>
        Preserved on retained layers: {unchanged("masks")} mask sets ·{" "}
        {unchanged("effectStack")} effect stacks · {unchanged("effects")} color
        settings · {unchanged("keyframes")} animation sets. Clip identities and
        parent references remain attached.
      </p>
      <SequencePreview key={preview.plan.id} project={view} />
      <button
        className="primary"
        disabled={!current || applied}
        onClick={apply}
      >
        {applied ? "Revision applied" : "Apply revision"}
      </button>
      <button
        disabled={!applied || history.at(-1) !== label}
        onClick={() => {
          useEditor.getState().undo();
          setApplied(false);
        }}
      >
        Undo revision
      </button>
      <button onClick={onCancel}>Cancel revision preview</button>
      {!current && !applied && (
        <p>Project changed. Preview this request again before applying.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
