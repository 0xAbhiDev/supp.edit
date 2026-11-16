import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEditor } from "../../../packages/editor-state";
import { desktop, sourceUrl } from "../../../packages/platform";
import { fps, uid } from "../../../packages/project-schema";
import { clock } from "../../../packages/engine/clock";
import { mediaAnalysis } from "../../../packages/ai/media-analysis/service";
import {
  defaultAnalysisSettings,
  type AnalysisTask,
  type MediaRange,
} from "../../../packages/ai/media-analysis/model";
import {
  fillerCandidates,
  previewAnalysisCommands,
  sourceToTimelineRanges,
  transcriptCommands,
} from "../../../packages/ai/media-analysis/planning";
import { type EditPreview } from "../../../packages/ai/editor-agent/execution";
import { AnalysisPlanPreview } from "./AnalysisPlanPreview";
import "./media-analysis.css";
const seconds = (ms: number) => (ms / 1000).toFixed(2) + "s";
export function MediaAnalysisPanel() {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    selected = useEditor((s) => s.selected),
    source = useEditor((s) => s.source);
  const results = useSyncExternalStore(
      mediaAnalysis.subscribe,
      mediaAnalysis.getSnapshot,
    ),
    jobs = useSyncExternalStore(
      mediaAnalysis.jobs.subscribe,
      mediaAnalysis.jobs.getSnapshot,
    );
  const [assetId, setAssetId] = useState(""),
    [cap, setCap] = useState<Awaited<
      ReturnType<typeof mediaAnalysis.capabilities>
    > | null>(null);
  const [error, setError] = useState(""),
    [jobId, setJobId] = useState<string | null>(null),
    [query, setQuery] = useState("");
  const [selection, setSelection] = useState<
      (MediaRange & { text: string }) | null
    >(null),
    [preview, setPreview] = useState<EditPreview | null>(null);
  const [threshold, setThreshold] = useState(-35),
    [minimum, setMinimum] = useState(700),
    [padding, setPadding] = useState(100);
  const [language, setLanguage] = useState("auto"),
    [url, setUrl] = useState(""),
    [style, setStyle] = useState<"conservative" | "balanced" | "aggressive">(
      "conservative",
    );
  const player = useRef<HTMLVideoElement>(null),
    generation = useRef(0);
  const selectedClip = project.clips.find((c) => c.id === selected),
    asset =
      project.assets.find(
        (a) => a.id === (assetId || selectedClip?.assetId || source),
      ) ?? project.assets[0];
  const own = results.filter(
    (r) => r.assetId === asset?.id && r.fingerprint === asset?.fingerprint,
  );
  const transcript =
    own.find((r) => r.transcript)?.transcript ??
    project.transcripts.find(
      (t) =>
        t.assetId === asset?.id &&
        (!t.sourceFingerprint || t.sourceFingerprint === asset?.fingerprint),
    );
  const audio = own.find((r) => r.audio)?.audio,
    video = own.find((r) => r.video)?.video,
    vision = own.find((r) => r.vision)?.vision,
    job = jobs.find((j) => j.id === jobId);
  const busy = job?.state === "Running" || job?.state === "Queued";
  const clip = selectedClip?.assetId === asset?.id ? selectedClip : undefined;
  const candidates = transcript ? fillerCandidates(transcript, style) : [];
  const refresh = () => {
    void mediaAnalysis
      .capabilities()
      .then(setCap)
      .catch((e) => setError(String(e)));
  };
  useEffect(refresh, []);
  useEffect(() => {
    generation.current++;
    setPreview(null);
    setSelection(null);
    setError("");
  }, [project.id, asset?.id, asset?.fingerprint]);
  useEffect(() => {
    if (!asset) return;
    let live = true;
    setUrl("");
    void mediaAnalysis.restore(asset).catch((e) => {
      if (live) setError(String(e));
    });
    void sourceUrl(asset)
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [asset?.id, asset?.fingerprint]);
  function seek(startMs: number) {
    if (player.current) player.current.currentTime = startMs / 1000;
    if (clip)
      clock.seek(
        Math.max(
          clip.start,
          Math.min(
            clip.start + clip.duration - 1,
            clip.start +
              Math.round((startMs * fps(project)) / 1000) -
              clip.sourceIn,
          ),
        ),
      );
  }
  async function run(task: AnalysisTask) {
    if (!asset) return;
    setError("");
    const token = generation.current;
    try {
      const handle = mediaAnalysis.submit(project, asset.id, {
        ...defaultAnalysisSettings(task),
        language,
        thresholdDb: threshold,
        minimumSilenceMs: minimum,
        paddingMs: padding,
      });
      setJobId(handle.id);
      const outcome = await handle.finished;
      if (token === generation.current && outcome.state === "Failed")
        setError(outcome.error);
    } catch (e) {
      setError(String(e));
    }
  }
  function cut(ranges: readonly MediaRange[], label: string) {
    try {
      if (!clip)
        throw new Error("Select a timeline clip using this source first");
      const timeline = sourceToTimelineRanges(project, clip.id, ranges),
        saved =
          timeline.reduce((n, r) => n + r.endFrame - r.startFrame, 0) /
          fps(project);
      setPreview(
        previewAnalysisCommands(
          project,
          revision,
          `${label}: remove ${saved.toFixed(2)}s across all sequence tracks`,
          [{ tool: "timeline.rippleDelete", ranges: timeline, prefix: uid() }],
        ),
      );
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="media-analysis" aria-label="Media understanding">
      <header>
        <div>
          <h2>Understand your media</h2>
          <p>
            LOCAL · Source analysis is cached independently of timeline edits.
          </p>
        </div>
        <button onClick={refresh}>Refresh capabilities</button>
      </header>
      <p>
        Transcription:{" "}
        {cap?.model?.installed ? "READY · CPU" : "MODEL NOT INSTALLED"} ·
        Scenes: {cap?.video ? "READY" : "Desktop required"} · Silence / beats:{" "}
        {cap?.audio ? "READY" : "Desktop required"} · Vision:{" "}
        {cap?.visionModel?.installed ? "READY · CPU" : "NOT INSTALLED"} ·
        Semantic search:{" "}
        {vision || transcript
          ? "READY for analyzed ranges"
          : "Analyze media first"}{" "}
        · Segmentation / diarization: NOT INSTALLED
      </p>
      {desktop && cap?.model && !cap.model.installed && (
        <div>
          <p>
            Whisper Tiny multilingual · 74 MiB model · CPU · {cap.model.version}
            . Install downloads an 83 MiB verified runtime and model from GitHub
            and Hugging Face. Media stays on this computer.
          </p>
          {cap.model.installSupported && (
            <button
              disabled={busy}
              onClick={async () => {
                setError("");
                try {
                  const handle = mediaAnalysis.install(project.id);
                  setJobId(handle.id);
                  const outcome = await handle.finished;
                  if (outcome.state === "Failed") setError(outcome.error);
                  refresh();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Download and install Whisper Tiny
            </button>
          )}
        </div>
      )}
      {desktop && cap?.visionModel && (
        <div>
          <p>
            {cap.visionModel.name} · scenes, likely actions and person/object
            positions · {Math.ceil(cap.visionModel.sizeBytes / 1048576)} MiB
            weights · CPU · {cap.visionModel.version}
          </p>
          {!cap.visionModel.installed && cap.visionModel.installSupported && (
            <>
              <p>
                Install downloads{" "}
                {Math.ceil(cap.visionModel.downloadBytes / 1048576)} MiB from
                Hugging Face and GitHub. Media stays LOCAL.{" "}
                <a
                  href="https://huggingface.co/Xenova/mobileclip_s0/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer"
                >
                  MobileCLIP model license
                </a>
                .
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  setError("");
                  try {
                    const handle = mediaAnalysis.install(project.id, "vision");
                    setJobId(handle.id);
                    const result = await handle.finished;
                    if (result.state === "Failed") setError(result.error);
                    refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Download and install local vision
              </button>
            </>
          )}
        </div>
      )}
      {desktop && cap?.personModel && (
        <div className="model-card">
          <p>
            PP-HumanSeg · local person masks · 6 MiB · CPU. Requires the local
            vision runtime. People only; detailed limbs and equipment need
            review.
          </p>
          {!cap.personModel.installed && cap.personModel.installSupported && (
            <button
              disabled={busy}
              onClick={async () => {
                setError("");
                try {
                  const h = mediaAnalysis.install(project.id, "person");
                  setJobId(h.id);
                  const result = await h.finished;
                  if (result.state === "Failed") setError(result.error);
                  refresh();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Download and install person masks
            </button>
          )}
        </div>
      )}
      {desktop &&
        (
          [
            ["speech", cap?.model],
            ["vision", cap?.visionModel],
            ["person", cap?.personModel],
          ] as const
        ).map(
          ([kind, model]) =>
            model?.installed && (
              <div key={kind}>
                <span>
                  {model.name} installed · current pinned version ·{" "}
                  {model.device}{" "}
                </span>
                <button
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await mediaAnalysis.remove(kind);
                      refresh();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Remove {kind} model
                </button>
              </div>
            ),
        )}
      {!desktop && (
        <p>
          Run the Windows desktop build for local inference and FFmpeg analysis.
          Saved transcripts and edit previews are available here.
        </p>
      )}
      <label>
        Source media{" "}
        <select
          aria-label="Analysis source"
          value={asset?.id ?? ""}
          onChange={(e) => setAssetId(e.target.value)}
        >
          <option value="" disabled>
            Import media first
          </option>
          {project.assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="analysis-actions">
        {cap?.visionModel?.installed && cap.video && (
          <button
            disabled={busy || asset?.kind !== "video"}
            onClick={() => void run("vision")}
          >
            Analyze vision and subjects
          </button>
        )}
        {cap?.model?.installed && cap.audio && (
          <>
            <label>
              Language{" "}
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="auto">Detect language</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="es">Spanish</option>
              </select>
            </label>
            <button
              disabled={busy || !asset?.hasAudio}
              onClick={() => void run("speech")}
            >
              Transcribe source
            </button>
          </>
        )}
        {cap?.video && (
          <button
            disabled={busy || asset?.kind !== "video"}
            onClick={() => void run("video")}
          >
            Analyze scenes and quality
          </button>
        )}
        {cap?.audio && (
          <>
            <label>
              Silence dB{" "}
              <input
                type="number"
                min={-80}
                max={-5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>
            <label>
              Minimum pause (ms){" "}
              <input
                type="number"
                min={100}
                max={10000}
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </label>
            <label>
              Keep padding (ms){" "}
              <input
                type="number"
                min={0}
                max={2000}
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
              />
            </label>
            <button
              disabled={busy || !asset?.hasAudio}
              onClick={() => void run("audio")}
            >
              Analyze silence and music
            </button>
          </>
        )}
      </div>
      {job && (
        <div role="status">
          {job.label} · {job.state}
          {job.progress && (
            <>
              <progress
                max={job.progress.total}
                value={job.progress.completed}
              />
              {job.progress.completed.toLocaleString()}/
              {job.progress.total.toLocaleString()} {job.progress.unit}
            </>
          )}
          {busy && (
            <button onClick={() => mediaAnalysis.jobs.cancel(job.id)}>
              Cancel analysis
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {vision && (
        <details open>
          <summary>
            Visual evidence · {vision.frames.length} frames from{" "}
            {vision.analyzedScenes}/{vision.totalScenes} scenes ·{" "}
            {vision.device}
          </summary>
          <p>
            Candidate confidence compares the installed label vocabulary; it is
            not a calibrated exercise probability. Sparse subject detections
            support framing, not identity tracking.
          </p>
          {vision.frames.map((f, i) => (
            <button
              key={i}
              onClick={() => seek(f.timeMs)}
              title={f.description}
            >
              {seconds(f.timeMs)} · {f.description} ·{" "}
              {f.detections.filter((d) => d.label === "person").length} people ·{" "}
              {f.labels[0]?.relativeConfidence.toFixed(2)} relative confidence
            </button>
          ))}
        </details>
      )}
      <div className="analysis-columns">
        <div>
          {url && asset?.kind !== "image" && (
            <video
              ref={player}
              src={url}
              controls
              preload="metadata"
              aria-label="Analysis source player"
            />
          )}
          {video && (
            <details open>
              <summary>{video.scenes.length} scene ranges</summary>
              <p>{video.method}</p>
              <div className="analysis-scroll">
                {video.scenes.map((s) => (
                  <button
                    key={s.startMs}
                    onClick={() => seek(s.representativeMs)}
                  >
                    {seconds(s.startMs)}–{seconds(s.endMs)} · motion{" "}
                    {s.motion?.toFixed(3) ?? "n/a"} · sharpness{" "}
                    {s.sharpness?.toFixed(1) ?? "n/a"} · black{" "}
                    {s.blackFraction === null
                      ? "n/a"
                      : (s.blackFraction * 100).toFixed(0)}
                    %
                  </button>
                ))}
              </div>
            </details>
          )}
          {audio && (
            <details open>
              <summary>
                {audio.silences.length} pauses · {audio.beatMap.beats.length}{" "}
                observed beat candidates
              </summary>
              <p>
                {audio.beatMap.bpm
                  ? `Estimated ${audio.beatMap.bpm.toFixed(1)} BPM · periodicity ${audio.beatMap.confidence.toFixed(2)} (half/double tempo may differ)`
                  : "No reliable tempo detected"}
              </p>
              <p>{audio.beatMap.method}</p>
              <button
                disabled={!clip || !audio.removalRanges.length}
                onClick={() =>
                  cut(audio.removalRanges, "Remove measured silences")
                }
              >
                Preview silence removal
              </button>
              <div className="analysis-scroll">
                {audio.silences.map((r) => (
                  <button key={r.startMs} onClick={() => seek(r.startMs)}>
                    Pause {seconds(r.startMs)}–{seconds(r.endMs)}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
        <div>
          {transcript ? (
            <>
              <h3>
                Transcript · {transcript.language ?? "unspecified language"}
              </h3>
              <p>
                {transcript.timingQuality === "approximate"
                  ? "Approximate word timing · confidence uses model token probabilities. Review before cutting."
                  : "Imported timing"}
              </p>
              <label>
                Search transcript{" "}
                <input
                  aria-label="Search transcript"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <p>
                Click to seek and select. Shift-click another word to extend the
                range.
              </p>
              <div className="analysis-transcript">
                {transcript.segments
                  .filter((s) =>
                    s.text
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase()),
                  )
                  .slice(0, 500)
                  .map((s) => (
                    <p key={s.id}>
                      <button
                        className="sentence-time"
                        onClick={() => {
                          setSelection({ ...s });
                          seek(s.startMs);
                        }}
                      >
                        {seconds(s.startMs)}
                      </button>
                      {s.words?.length
                        ? s.words.map((w, i) => (
                            <button
                              className={
                                selection &&
                                w.startMs >= selection.startMs &&
                                w.endMs <= selection.endMs
                                  ? "word selected"
                                  : "word"
                              }
                              key={i}
                              title={`${seconds(w.startMs)}–${seconds(w.endMs)}${w.confidence === undefined ? "" : ` · token confidence ${w.confidence.toFixed(2)}`}`}
                              onClick={(e) => {
                                setSelection(
                                  e.shiftKey && selection
                                    ? {
                                        startMs: Math.min(
                                          selection.startMs,
                                          w.startMs,
                                        ),
                                        endMs: Math.max(
                                          selection.endMs,
                                          w.endMs,
                                        ),
                                        text: transcript.segments
                                          .flatMap((s) => s.words ?? [])
                                          .filter(
                                            (x) =>
                                              x.startMs >=
                                                Math.min(
                                                  selection.startMs,
                                                  w.startMs,
                                                ) &&
                                              x.endMs <=
                                                Math.max(
                                                  selection.endMs,
                                                  w.endMs,
                                                ),
                                          )
                                          .map((x) => x.text)
                                          .join(" "),
                                      }
                                    : { ...w },
                                );
                                seek(w.startMs);
                              }}
                            >
                              {w.text}{" "}
                            </button>
                          ))
                        : s.text}
                    </p>
                  ))}
              </div>
              {selection && (
                <p>
                  Selected {seconds(selection.startMs)}–
                  {seconds(selection.endMs)}{" "}
                  <button
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(selection.text)
                        .catch((e) => setError(String(e)));
                    }}
                  >
                    Copy selected text
                  </button>
                  <button
                    disabled={!clip || selection.endMs <= selection.startMs}
                    onClick={() =>
                      cut([selection], "Delete transcript selection")
                    }
                  >
                    Preview ripple delete
                  </button>
                </p>
              )}
              <div className="analysis-actions">
                <button
                  disabled={project.transcripts.some(
                    (t) => t.id === transcript.id,
                  )}
                  onClick={() => {
                    try {
                      setPreview(
                        previewAnalysisCommands(
                          project,
                          revision,
                          "Save source transcript",
                          transcriptCommands(project, transcript),
                        ),
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Preview transcript import
                </button>
                <button
                  disabled={!clip}
                  onClick={() => {
                    try {
                      setPreview(
                        previewAnalysisCommands(
                          project,
                          revision,
                          "Create editable speech captions",
                          transcriptCommands(project, transcript, clip!.id),
                        ),
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Preview speech captions
                </button>
              </div>
              <label>
                Filler candidates{" "}
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as typeof style)}
                >
                  <option value="conservative">Conservative</option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </label>
              <p>
                {candidates.length} candidates · review context before removal.
                English words only.
              </p>
              <div className="analysis-scroll">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    title={c.reason}
                    onClick={() => {
                      setSelection(c);
                      seek(c.startMs);
                    }}
                  >
                    {c.text} · {seconds(c.startMs)}
                  </button>
                ))}
              </div>
              <button
                disabled={!clip || !candidates.length}
                onClick={() =>
                  cut(candidates, "Remove reviewed filler candidates")
                }
              >
                Preview filler cuts
              </button>
            </>
          ) : (
            <p>
              {own.some(
                (r) =>
                  r.settings.task === "speech" && r.speechDetected === false,
              )
                ? "No speech was detected in this source. No transcript or captions were invented."
                : "Transcribe a source to search speech, select timed words, and create editable captions."}
            </p>
          )}
        </div>
      </div>
      {preview && <AnalysisPlanPreview preview={preview} />}
    </section>
  );
}
