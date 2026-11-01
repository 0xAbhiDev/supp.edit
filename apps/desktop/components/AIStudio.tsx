import { useState, useSyncExternalStore } from "react";
import { useEditor } from "../../../packages/editor-state";
import { aiStudio } from "../../../packages/ai/studio";
import {
  isCaptionPreviewCurrent,
  captionPreviewEdit,
} from "../../../packages/ai/captions";
import { MAX_SRT_BYTES } from "../../../packages/ai/srt";
import "./ai-studio.css";
import { AIEditBox } from "./AIEditBox";
import { MediaAnalysisPanel } from "./MediaAnalysisPanel";

export function AIStudio() {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    selected = useEditor((s) => s.selected),
    history = useEditor((s) => s.historyNames);
  const activeSequence = useEditor((s) => s.activeComposition);
  const sequence = project.compositions.find((c) => c.id === activeSequence);
  const entries = useSyncExternalStore(
      aiStudio.subscribe,
      aiStudio.getSnapshot,
    ),
    jobs = useSyncExternalStore(
      aiStudio.jobs.subscribe,
      aiStudio.jobs.getSnapshot,
    );
  const [request, setRequest] = useState("generate captions"),
    [srt, setSrt] = useState(""),
    [offset, setOffset] = useState(0),
    [entryId, setEntryId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [preparing, setPreparing] = useState(false);
  const ownEntries = entries.filter((e) => e.projectId === project.id),
    entry = ownEntries.find((e) => e.id === entryId) ?? ownEntries.at(-1),
    preview = entry?.preview;
  const job = jobs.find((j) => j.id === entry?.jobId),
    current = !!preview && isCaptionPreviewCurrent(preview, project, revision);
  async function run() {
    setError("");
    setPreparing(true);
    try {
      setEntryId(
        await aiStudio.submit(
          request,
          srt,
          project,
          revision,
          {
            selectedClipIds: selected ? [selected] : [],
            selectedLayerId: selected,
          },
          offset,
        ),
      );
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setPreparing(false);
    }
  }
  function apply() {
    if (!preview || !entry) return;
    try {
      const s = useEditor.getState();
      const edit = captionPreviewEdit(preview, s.project, s.revision);
      s.execute("AI Studio: apply captions", edit);
      if (useEditor.getState().project !== s.project)
        aiStudio.markApplied(entry.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section className="ai-studio panel" aria-label="AI Studio workspace">
      <header>
        <div>
          <strong>AI Studio</strong>
          <p>
            {project.name} · {sequence?.name ?? "Main sequence"} ·{" "}
            {selected ? "1 selected layer" : "No layer selected"} ·{" "}
            {project.transcripts.length} transcripts
          </p>
        </div>
        <span className="ai-local">LOCAL · No media upload</span>
      </header>
      <AIEditBox />
      {!!sequence?.revisions?.length && (
        <details>
          <summary>
            Sequence revision history · {sequence.revisions.length}
          </summary>
          <ol>
            {sequence.revisions.map((r) => (
              <li key={r.id}>
                <strong>{r.request}</strong>
                <p>{r.summary}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
      <MediaAnalysisPanel />
      <div className="ai-columns">
        <div className="ai-input">
          <label>
            Command
            <input
              aria-label="AI command"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="generate captions"
            />
          </label>
          <p>
            Available: captions from an existing SRT transcript. This built-in
            tool uses timestamps, with no model download or speech recognition.
          </p>
          {aiStudio.availableActions().map((action) => (
            <button
              key={action.kind}
              onClick={() => setRequest("generate captions")}
            >
              {action.label}
            </button>
          ))}
          <label>
            Timestamped transcript
            <textarea
              aria-label="SRT transcript"
              value={srt}
              onChange={(e) => setSrt(e.target.value)}
              placeholder={"1\n00:00:00,000 --> 00:00:01,000\nYour caption"}
              maxLength={MAX_SRT_BYTES}
            />
          </label>
          <label className="ai-file">
            Import SRT
            <input
              aria-label="Import SRT transcript"
              type="file"
              accept=".srt,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > MAX_SRT_BYTES)
                    throw new Error("SRT exceeds 2 MiB");
                  setSrt(await file.text());
                  setError("");
                } catch (error) {
                  setError(String(error));
                }
                e.target.value = "";
              }}
            />
          </label>
          <label>
            Offset in frames
            <input
              aria-label="Caption offset"
              type="number"
              min={0}
              max={2_000_000_000}
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
            />
          </label>
          <button
            className="primary"
            disabled={preparing || !srt.trim()}
            onClick={() => void run()}
          >
            {preparing ? "Preparing…" : "Preview captions"}
          </button>
          {error && <p role="alert">{error}</p>}
          <details>
            <summary>Model manager</summary>
            {aiStudio.models.list().map((model) => (
              <p key={model.id}>
                {model.name} · {model.executionDevice} · {model.installedState}{" "}
                · version {model.version} · {model.sizeBytes} bytes · download{" "}
                {model.download.state}
              </p>
            ))}
            <p>
              Install local speech processing in Media understanding above.
              Remote providers and credential setup are not installed.
            </p>
          </details>
        </div>
        <div className="ai-results">
          <h3>Result preview</h3>
          {job && (
            <div role="status">
              <strong>{job.state}</strong>
              {job.progress && (
                <>
                  <progress
                    max={job.progress.total}
                    value={job.progress.completed}
                  />
                  <span>
                    {job.progress.completed}/{job.progress.total}{" "}
                    {job.progress.unit}
                  </span>
                </>
              )}
              {job.error && <p role="alert">{job.error}</p>}
              {(["Queued", "Running", "Paused"] as string[]).includes(
                job.state,
              ) && (
                <button onClick={() => aiStudio.jobs.cancel(job.id)}>
                  Cancel job
                </button>
              )}
              {job.supportsPause &&
                job.state === "Running" &&
                !job.pauseRequested && (
                  <button onClick={() => aiStudio.jobs.pause(job.id)}>
                    Pause job
                  </button>
                )}
              {job.supportsPause && job.pauseRequested && (
                <button onClick={() => aiStudio.jobs.resume(job.id)}>
                  Resume job
                </button>
              )}
            </div>
          )}
          {preview ? (
            <>
              <p>
                {preview.clips.length} text layers on a new Captions track.
                Applying also saves the timestamped transcript in this project.
              </p>
              <div className="ai-preview">
                <table>
                  <thead>
                    <tr>
                      <th>Frames</th>
                      <th>Text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.clips.slice(0, 100).map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.start}–{c.start + c.duration}
                        </td>
                        <td>{c.text.content}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.clips.length > 100 && (
                  <p>
                    Showing the first 100 of {preview.clips.length} captions.
                  </p>
                )}
              </div>
              {!current && !entry?.applied && (
                <p>Project changed. Generate a new preview before applying.</p>
              )}
              <button
                className="primary"
                disabled={!current || entry?.applied}
                onClick={apply}
              >
                {entry?.applied ? "Applied" : "Apply captions"}
              </button>
            </>
          ) : (
            <p>
              Run a supported command to inspect its proposed project changes
              here.
            </p>
          )}
          <button
            disabled={!history.length}
            onClick={() => useEditor.getState().undo()}
          >
            Undo last project edit
          </button>
          <h3>Background jobs</h3>
          <ul>
            {jobs
              .filter((j) => j.scope === project.id)
              .slice(-10)
              .map((j) => (
                <li key={j.id}>
                  {j.label} · {j.state}
                  {j.progress
                    ? ` · ${j.progress.completed}/${j.progress.total} ${j.progress.unit}`
                    : ""}
                </li>
              ))}
          </ul>
          <h3>Operation history</h3>
          <p className="muted">Current session</p>
          <ol>
            {[...ownEntries].reverse().map((e) => (
              <li key={e.id}>
                <button onClick={() => setEntryId(e.id)}>
                  Captions ·{" "}
                  {jobs.find((j) => j.id === e.jobId)?.state ?? "Finished"}
                  {e.applied ? " · applied" : ""}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
