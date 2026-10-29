import { useEffect, useRef, useState } from "react";
import { useEditor } from "../../../packages/editor-state";
import { Compositor } from "../../../packages/engine/compositor";
import {
  applyEditPreview,
  isEditPreviewCurrent,
  type EditPreview,
} from "../../../packages/ai/editor-agent/execution";
export function AnalysisPlanPreview({ preview }: { preview: EditPreview }) {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision);
  const [error, setError] = useState(""),
    [applied, setApplied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setApplied(false);
    setError("");
  }, [preview]);
  useEffect(() => {
    if (!canvas.current) return;
    let disposed = false;
    const renderer = new Compositor(canvas.current, true, {
      scale: Math.min(0.5, 480 / preview.project.settings.width),
    });
    const pending = renderer
      .render(preview.project, preview.frame)
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
      renderer.cancel();
      void pending.then(() => renderer.dispose());
    };
  }, [preview]);
  const current = isEditPreviewCurrent(preview, project, revision);
  return (
    <section className="analysis-plan" aria-label="Analysis edit preview">
      <h3>Proposed edit</h3>
      <p>{preview.plan.summary}</p>
      <p>
        {preview.plan.commands.length} commands ·{" "}
        {preview.changedLayerIds.length} changed layers ·{" "}
        {preview.removedLayerIds.length} removed layers
      </p>
      {(preview.changedLayerIds.length > 0 ||
        preview.removedLayerIds.length > 0) && (
        <canvas ref={canvas} aria-label="Analysis result frame" />
      )}
      {!current && !applied && (
        <p>Project changed. Create a fresh preview before applying.</p>
      )}
      <button
        className="primary"
        disabled={!current || applied}
        onClick={() => {
          try {
            const s = useEditor.getState();
            s.execute(
              preview.plan.summary,
              applyEditPreview(preview, s.project, s.revision),
            );
            if (useEditor.getState().project !== s.project) setApplied(true);
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        {applied ? "Applied" : "Apply analysis edit"}
      </button>
      <button
        disabled={!useEditor((s) => s.historyNames).length}
        onClick={() => useEditor.getState().undo()}
      >
        Undo analysis edit
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
