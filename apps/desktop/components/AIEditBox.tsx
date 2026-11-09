import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {typographyRequest} from "../../../packages/typography/planner";
import {typographyService} from "../../../packages/typography/service";
import {SequencePreview} from "./SequencePreview";
import { useEditor } from "../../../packages/editor-state";
import { aiEditorAgent } from "../../../packages/ai/editor-agent/agent";
import {
  applyEditPreview,
  isEditPreviewCurrent,
  type EditPreview,
} from "../../../packages/ai/editor-agent/execution";
import { Compositor } from "../../../packages/engine/compositor";
import { clock } from "../../../packages/engine/clock";
import { compositionView } from "../../../packages/commands/compositions";
import { routeRequest } from "../../../packages/ai/rough-cut/model";
import {
  roughCutService,
  type RoughCutSession,
} from "../../../packages/ai/rough-cut/service";
import { RoughCutReview } from "./RoughCutReview";
import { revisionService } from "../../../packages/ai/revisions/service";
import { RevisionReview } from "./RevisionReview";
import {
  reframeRequest,
  type ReframeMode,
} from "../../../packages/ai/reframe/model";
import { reframeService } from "../../../packages/ai/reframe/service";
import { ReframeReview } from "./ReframeReview";
import "./ai-edit-box.css";
export function AIEditBox() {
  const [reframeMode, setReframeMode] = useState<ReframeMode>("smooth");
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    selected = useEditor((s) => s.selected),
    scope = useEditor((s) => s.activeComposition);
  const [request, setRequest] = useState(""),
    [preview, setPreview] = useState<EditPreview | null>(null),
    [error, setError] = useState(""),
    [jobId, setJobId] = useState<string | null>(null),
    [applied, setApplied] = useState(false),
    [roughCut, setRoughCut] = useState<RoughCutSession | null>(null),
    [musicId, setMusicId] = useState("");
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
    setRoughCut(null);
    setMusicId("");
    setApplied(false);
    setError("");
  }, [project.id]);
  useEffect(() => {
    if (!preview || !canvas.current) return;
    let disposed = false;
    const r = new Compositor(canvas.current, true, { scale: 0.5 });
    const pending = r
      .render(
        compositionView(
          preview.project,
          preview.plan.resultCompositionId ?? preview.plan.compositionId,
        ),
        preview.frame,
      )
      .catch((e) => {
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
    setRoughCut(null);
    setApplied(false);
    const token = ++generation.current;
    try {
      if (/^undo (?:that|the) revision[.!]?$/i.test(request.trim())) {
        const s = useEditor.getState();
        if (!s.historyNames.at(-1)?.startsWith("AI Revision:"))
          throw new Error(
            "The latest project edit is not an AI revision; use normal Undo to review intervening edits",
          );
        s.undo();
        return;
      }
      if (typographyRequest.test(request)) {
        const handle=typographyService.plan(request,project,revision,scope);
        setJobId(handle.id);
        const outcome=await handle.finished;
        if(token!==generation.current)return;
        if(outcome.state==="Completed")setPreview(outcome.result);
        else if(outcome.state==="Failed")setError(outcome.error);
        return;
      }
      if (reframeRequest.test(request)) {
        const handle = reframeService.plan(
          request,
          project,
          revision,
          scope,
          reframeMode,
        );
        setJobId(handle.id);
        const outcome = await handle.finished;
        if (token !== generation.current) return;
        if (outcome.state === "Completed") setPreview(outcome.result);
        else if (outcome.state === "Failed") setError(outcome.error);
        return;
      }
      if (routeRequest(request) === "revision") {
        const handle = revisionService.plan(request, project, revision, scope);
        setJobId(handle.id);
        const outcome = await handle.finished;
        if (token !== generation.current) return;
        if (outcome.state === "Completed") setPreview(outcome.result);
        else if (outcome.state === "Failed") setError(outcome.error);
        return;
      }
      if (routeRequest(request) === "creative") {
        const handle = roughCutService.plan(
          request,
          project,
          revision,
          musicId || null,
          useEditor.getState().source,
        );
        setJobId(handle.id);
        const outcome = await handle.finished;
        if (token !== generation.current) return;
        if (outcome.state === "Completed") setRoughCut(outcome.result);
        else if (outcome.state === "Failed") setError(outcome.error);
        return;
      }
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
      const isRevision = preview.plan.commands.some(
        (c) => c.tool === "sequence.revise" || c.tool === "sequence.treatment",
      );
      s.execute(
        (isRevision ? "AI Revision: " : "AI Editor: ") + preview.plan.summary,
        edit,
      );
      if (preview.plan.resultCompositionId)
        s.setComposition(preview.plan.resultCompositionId);
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
        LOCAL · Try “Pick my best gym lifts and sync cuts to the music.”
        Imported videos are analyzed on this device using the installed vision
        model. Review the selected moments before applying a new editable
        sequence. Precise layer commands such as “Set contrast to 1.2” also
        work.
      </p>
      {project.assets.some((a) => a.kind === "audio") && (
        <label>
          Music{" "}
          <select
            aria-label="Music for AI edit"
            value={musicId}
            onChange={(e) => setMusicId(e.target.value)}
          >
            <option value="">Use selected audio or the only audio asset</option>
            {project.assets
              .filter((a) => a.kind === "audio")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {reframeRequest.test(request) && (
        <label>
          Camera motion{" "}
          <select
            aria-label="Reframe camera motion"
            value={reframeMode}
            onChange={(e) => setReframeMode(e.target.value as ReframeMode)}
          >
            <option value="locked">Locked</option>
            <option value="smooth">Smooth</option>
            <option value="responsive">Responsive</option>
          </select>
        </label>
      )}
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
      {roughCut && <RoughCutReview session={roughCut} onChange={setRoughCut} />}
      {preview?.plan.commands.some((c) => c.tool === "sequence.reframe") ? (
        <ReframeReview
          key={preview.plan.id}
          preview={preview}
          onCancel={() => setPreview(null)}
        />
      ) : preview?.plan.commands.some(
          (c) =>
            c.tool === "sequence.revise" || c.tool === "sequence.treatment",
        ) ? (
        <RevisionReview
          key={preview.plan.id}
          preview={preview}
          onCancel={() => setPreview(null)}
        />
      ) : (
        preview && (
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
                    {c.tool === "sequence.revise"
                      ? `${c.changes.length} layer ranges changed · ${c.remove.length} layers removed · ${(c.duration / (project.compositions.find((s) => s.id === c.sequenceId)!.settings.fps.num / project.compositions.find((s) => s.id === c.sequenceId)!.settings.fps.den)).toFixed(2)} seconds`
                      : c.tool === "text.create" ? `${c.content} · ${c.treatment} · ${c.timing} · frame ${c.start}` : c.tool}
                    {"clipId" in c ? ` · ${c.clipId}` : ""}
                  </li>
                ))}
              </ol>
              <button disabled={!current || applied} onClick={apply}>
                {applied
                  ? "Edit applied"
                  : preview.plan.commands.some(
                        (c) => c.tool === "sequence.revise",
                      )
                    ? "Apply revision"
                    : "Create edit"}
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
            {preview.plan.commands.some(c=>c.tool==="text.create") ? <SequencePreview project={compositionView(preview.project,preview.plan.compositionId)} /> : <figure>
              <canvas ref={canvas} aria-label="Proposed edit preview" />
              <figcaption>
                Proposed project frame · original project remains unchanged
                until Create edit
              </figcaption>
            </figure>}
          </div>
        )
      )}
    </section>
  );
}
