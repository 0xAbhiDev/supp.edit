import { useMemo, useState } from "react";
import { useEditor } from "../../../packages/editor-state";
import { compositionView } from "../../../packages/commands/compositions";
import {
  type EditPreview,
  applyEditPreview,
  isEditPreviewCurrent,
} from "../../../packages/ai/editor-agent/execution";
import { SequencePreview } from "./SequencePreview";
export function ReframeReview({
  preview,
  onCancel,
}: {
  preview: EditPreview;
  onCancel: () => void;
}) {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    history = useEditor((s) => s.historyNames);
  const [applied, setApplied] = useState(false),
    [error, setError] = useState("");
  const view = useMemo(
    () =>
      compositionView(
        preview.project,
        preview.plan.resultCompositionId ?? null,
      ),
    [preview],
  );
  const call = preview.plan.commands.find((c) => c.tool === "sequence.reframe");
  if (!call) return null;
  const label = "AI Revision: " + preview.plan.summary,
    current = isEditPreviewCurrent(preview, project, revision);
  return (
    <section className="revision-review" aria-label="AI reframe plan">
      <h3>Portrait framing plan</h3>
      <p>{call.record.request}</p>
      <p>{preview.plan.summary}</p>
      <ul>
        {call.changes.map((c) => (
          <li key={c.clipId}>
            {view.clips.find((l) => l.id === c.clipId)?.name}:{" "}
            {c.x.length + c.y.length + c.scale.length} editable position/scale
            keys; source range, cuts, masks and effects retained.
          </li>
        ))}
      </ul>
      <SequencePreview key={preview.plan.id} project={view} />
      <button
        className="primary"
        disabled={!current || applied}
        onClick={() => {
          try {
            const s = useEditor.getState();
            s.execute(label, applyEditPreview(preview, s.project, s.revision));
            if (useEditor.getState().project !== s.project) {
              s.setComposition(call.sequenceId);
              setApplied(true);
            }
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        {applied ? "Framing applied" : "Apply framing"}
      </button>
      <button
        disabled={!applied || history.at(-1) !== label}
        onClick={() => {
          useEditor.getState().undo();
          setApplied(false);
        }}
      >
        Undo framing
      </button>
      <button onClick={onCancel}>Cancel framing preview</button>
      {!current && !applied && (
        <p>Project changed. Preview framing again before applying.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
