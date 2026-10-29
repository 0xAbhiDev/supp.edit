import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEditor } from "../../../packages/editor-state";
import { aiEditorAgent } from "../../../packages/ai/editor-agent/agent";
import {
  applyEditPreview,
  isEditPreviewCurrent,
  type EditPreview,
} from "../../../packages/ai/editor-agent/execution";
import { Compositor } from "../../../packages/engine/compositor";
import { clock } from "../../../packages/engine/clock";
import "./ai-edit-box.css";
export function AIEditBox() {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    selected = useEditor((s) => s.selected),
    scope = useEditor((s) => s.activeComposition);
  const [request, setRequest] = useState(""),
    [preview, setPreview] = useState<EditPreview | null>(null),
    [error, setError] = useState(""),
    [jobId, setJobId] = useState<string | null>(null),
    [applied, setApplied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    generation = useRef(0);
  const jobs = useSyncExternalStore(
      aiEditorAgent.jobs.subscribe,
      aiEditorAgent.jobs.getSnapshot,
    ),
    job = jobs.find((j) => j.id === jobId);
  const busy = job?.state === "Queued" || job?.state === "Running";
  const current = !!preview && isEditPreviewCurrent(preview, project, revision);
  useEffect(() => {
    generation.current++;
    setPreview(null);
    setApplied(false);
    setError("");
  }, [project.id]);
  useEffect(() => {
    if (!preview || !canvas.current) return;
    let disposed = false;
    const r = new Compositor(canvas.current, true, { scale: 0.5 });
    const pending = r.render(preview.project, preview.frame).catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      r.cancel();
      void pending.then(() => r.dispose());
    };
  }, [preview]);
  async function plan() {
    setError("");
    setPreview(null);
    setApplied(false);
    const token = ++generation.current;
    try {
      const handle = aiEditorAgent.plan(request, project, revision, {
        selectedLayerId: selected,
        selectedClipIds: selected ? [selected] : [],
        activeCompositionId: scope,
        frame: clock.get().frame,
      });
      setJobId(handle.id);
      const outcome = await handle.finished;
      if (token !== generation.current) return;
      if (outcome.state === "Completed") setPreview(outcome.result);
      else if (outcome.state === "Failed") setError(outcome.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function apply() {
    if (!preview) return;
    try {
      const s = useEditor.getState(),
        edit = applyEditPreview(preview, s.project, s.revision);
      s.execute("AI Editor: " + preview.plan.summary, edit);
      if (useEditor.getState().project !== s.project) setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section className="ai-edit-box" aria-label="AI edit planner">
      <h2>What do you want to create?</h2>
      <textarea
        aria-label="Describe your edit"
        placeholder="Describe the video you want to create..."
        value={request}
        maxLength={4000}
        onChange={(e) => setRequest(e.target.value)}
      />
      <p>
        LOCAL command planner · Select a main-sequence layer. Available now:
        “Set contrast to 1.2”, “Move selected clip to frame 60”, or “Trim
        selected clip end to frame 90”. Local speech, scene and audio analysis
        are available in Media understanding below; vision requires a future
        provider.
      </p>
      <button disabled={busy || !request.trim()} onClick={() => void plan()}>
        Preview edit plan
      </button>
      {busy && (
        <button onClick={() => jobId && aiEditorAgent.jobs.cancel(jobId)}>
          Cancel planning
        </button>
      )}
      {job && (
        <span role="status">
          {job.state}
          {job.progress
            ? ` · ${job.progress.completed}/${job.progress.total} ${job.progress.unit}`
            : ""}
        </span>
      )}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div className="ai-edit-plan">
          <div>
            <h3>Edit plan</h3>
            <p>{preview.plan.summary}</p>
            <p>
              {preview.validation} · {preview.changedLayerIds.length} changed
              layers · {preview.removedLayerIds.length} removed layers
            </p>
            <ol>
              {preview.plan.commands.map((c, i) => (
                <li key={i}>
                  {c.tool}
                  {"clipId" in c ? ` · ${c.clipId}` : ""}
                </li>
              ))}
            </ol>
            <button disabled={!current || applied} onClick={apply}>
              {applied ? "Edit applied" : "Create edit"}
            </button>
            <button
              disabled={!useEditor.getState().historyNames.length}
              onClick={() => useEditor.getState().undo()}
            >
              Undo last edit
            </button>
            {!current && !applied && (
              <p>Project changed. Preview again before applying.</p>
            )}
          </div>
          <figure>
            <canvas ref={canvas} aria-label="Proposed edit preview" />
            <figcaption>
              Proposed project frame · original project remains unchanged until
              Create edit
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}
