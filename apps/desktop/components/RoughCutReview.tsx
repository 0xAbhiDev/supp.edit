import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../../../packages/editor-state";
import { sourceUrl } from "../../../packages/platform";
import { type Asset, fps } from "../../../packages/project-schema";
import { Compositor } from "../../../packages/engine/compositor";
import { compositionView } from "../../../packages/commands/compositions";
import {
  applyEditPreview,
  isEditPreviewCurrent,
} from "../../../packages/ai/editor-agent/execution";
import {
  type RoughCutSession,
  roughCutService,
} from "../../../packages/ai/rough-cut/service";
import { clock } from "../../../packages/engine/clock";
import { gymStyles } from "../../../packages/ai/rough-cut/styles";
function MomentThumbnail({ asset, timeMs }: { asset: Asset; timeMs: number }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = true;
    void sourceUrl(asset)
      .then((u) => {
        if (current) setUrl(u);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [asset]);
  return url ? (
    <video
      aria-label={`Source frame: ${asset.name}`}
      src={url}
      muted
      preload="metadata"
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = timeMs / 1000;
      }}
    />
  ) : (
    <span>Source preview unavailable</span>
  );
}
export function RoughCutReview({
  session,
  onChange,
}: {
  session: RoughCutSession;
  onChange: (s: RoughCutSession) => void;
}) {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    history = useEditor((s) => s.historyNames),
    [error, setError] = useState(""),
    [applied, setApplied] = useState(false),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    canvas = useRef<HTMLCanvasElement>(null);
  const { cut, preview } = session,
    view = useMemo(
      () =>
        compositionView(
          preview.project,
          preview.plan.resultCompositionId ?? null,
        ),
      [preview],
    );
  const rate = fps(view),
    end = Math.max(...view.clips.map((c) => c.start + c.duration));
  const current = isEditPreviewCurrent(preview, project, revision);
  const seekFrame = playing ? null : frame;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    setFrame(0);
    setApplied(false);
    setPlaying(false);
    setError("");
  }, [preview]);
  useEffect(() => {
    if (!canvas.current) return;
    let disposed = false;
    const renderer = new Compositor(canvas.current, false, {
      scale: Math.min(0.5, 480 / view.settings.width),
    });
    const startFrame =
        frameRef.current >= end - 1 && playing ? 0 : frameRef.current,
      start = performance.now();
    const pending = (async () => {
      let next = startFrame;
      do {
        const failure = await renderer.render(view, next, playing);
        if (failure) throw failure;
        if (disposed) return;
        setFrame(next);
        if (!playing) return;
        if (next >= end - 1) {
          setPlaying(false);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 / rate));
        next = Math.min(
          end - 1,
          Math.max(
            next + 1,
            startFrame +
              Math.floor(((performance.now() - start) * rate) / 1000),
          ),
        );
      } while (!disposed);
    })().catch((e) => {
      if (!disposed) {
        setError(String(e));
        setPlaying(false);
      }
    });
    return () => {
      disposed = true;
      renderer.cancel();
      void pending.then(() => renderer.dispose());
    };
  }, [view, seekFrame, playing, end, rate]);
  function change(ids: string[]) {
    try {
      onChange(roughCutService.reselect(session, ids));
    } catch (e) {
      setError(String(e));
    }
  }
  const ids = cut.shots.map((s) => s.candidate.id),
    alternatives = cut.candidates.filter((c) => !ids.includes(c.id));
  return (
    <section className="rough-cut-review" aria-label="Gym edit plan">
      <h3>{view.name}</h3>
      <p>{cut.brief.prompt}</p>
      {cut.brief.style && (
        <p>
          Style: {gymStyles[cut.brief.style].name} · {view.settings.width}×
          {view.settings.height} ·{" "}
          {cut.shots.filter((s) => s.beatAligned).length} aligned boundaries ·{" "}
          {cut.musicEvents.filter((e) => e.kind === "strong-onset").length}{" "}
          strong measured music events ·{" "}
          {cut.color.filter((c) => c.length).length} shots with editable color
        </p>
      )}
      <p>
        {cut.analyzedAssets} videos analyzed · {cut.candidates.length} candidate
        moments · {cut.shots.length} selected · {cut.durationSeconds.toFixed(1)}{" "}
        seconds
      </p>
      <p>
        Music: {cut.music?.name ?? "None"} · Detected tempo:{" "}
        {cut.beatMap?.bpm ? `${cut.beatMap.bpm.toFixed(1)} BPM` : "unavailable"}{" "}
        · Beat sync: {cut.brief.beatSync}
      </p>
      <div className="rough-cut-preview">
        <canvas ref={canvas} aria-label="Gym sequence preview" />
        <label>
          Preview position{" "}
          <input
            aria-label="Gym preview frame"
            type="range"
            min={0}
            max={end - 1}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              setFrame(Number(e.target.value));
            }}
          />
        </label>
        <button
          onClick={() => {
            clock.pause();
            setPlaying((v) => !v);
          }}
        >
          {playing ? "Pause preview" : "Play sequence preview"}
        </button>
        <span>{(frame / rate).toFixed(1)}s</span>
      </div>
      <div className="moment-cards">
        {cut.shots.map((shot, i) => {
          const c = shot.candidate,
            asset = session.project.assets.find((a) => a.id === c.assetId)!;
          return (
            <article className="moment-card" key={c.id}>
              <MomentThumbnail
                asset={asset}
                timeMs={((shot.sourceIn + shot.duration / 2) / rate) * 1000}
              />
              <h4>
                {String(i + 1).padStart(2, "0")} · {asset.name}
              </h4>
              <p>
                {(shot.sourceIn / rate).toFixed(2)} →{" "}
                {((shot.sourceIn + shot.duration) / rate).toFixed(2)}s ·{" "}
                {shot.role}
              </p>
              <p>
                Rank score {c.overallScore.toFixed(2)}
                {shot.beatAligned ? " · ending near measured strong onset" : ""}
              </p>
              <details>
                <summary>Why this moment</summary>
                {shot.placementReason && <p>{shot.placementReason}</p>}
                {cut.color[i].map((e) => (
                  <p key={e.type}>
                    {e.type}: {e.value.toFixed(3)} · {e.reason}
                  </p>
                ))}
                <ul>
                  {c.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p>
                  Semantic {c.semanticScore.toFixed(2)} · prompt{" "}
                  {c.promptRelevance.toFixed(2)} · subject{" "}
                  {c.subjectScore.toFixed(2)} · motion{" "}
                  {c.motionScore.toFixed(2)} · novelty{" "}
                  {c.diversityScore.toFixed(2)}
                </p>
              </details>
              <button
                aria-label={`Remove shot ${i + 1}`}
                disabled={applied || !current || ids.length < 2}
                onClick={() => change(ids.filter((id) => id !== c.id))}
              >
                Remove
              </button>
              <button
                aria-label={`Move shot ${i + 1} earlier`}
                disabled={applied || !current || i === 0}
                onClick={() => {
                  const next = [...ids];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  change(next);
                }}
              >
                Earlier
              </button>
              {alternatives.length > 0 && (
                <select
                  aria-label={`Replace shot ${i + 1}`}
                  value=""
                  disabled={applied || !current}
                  onChange={(e) =>
                    change(ids.map((id, j) => (j === i ? e.target.value : id)))
                  }
                >
                  <option value="" disabled>
                    Replace with…
                  </option>
                  {alternatives.map((a) => (
                    <option key={a.id} value={a.id}>
                      {
                        session.project.assets.find((s) => s.id === a.assetId)
                          ?.name
                      }{" "}
                      · {(a.sourceStartMs / 1000).toFixed(1)}s
                    </option>
                  ))}
                </select>
              )}
            </article>
          );
        })}
      </div>
      <details>
        <summary>Evidence and limitations ({cut.warnings.length})</summary>
        <ul>
          {cut.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </details>
      <button
        className="primary"
        disabled={!current || applied}
        onClick={() => {
          try {
            const s = useEditor.getState();
            s.execute(
              "Apply AI Edit · " + view.name,
              applyEditPreview(preview, s.project, s.revision),
            );
            if (useEditor.getState().project !== s.project) {
              setApplied(true);
              s.setComposition(preview.plan.resultCompositionId!);
              clock.seek(0);
            }
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        {applied ? "AI edit applied" : "Apply AI edit"}
      </button>
      <button
        disabled={!applied || !history.at(-1)?.startsWith("Apply AI Edit ·")}
        onClick={() => {
          useEditor.getState().undo();
          setApplied(false);
        }}
      >
        Undo AI edit
      </button>
      {applied && (
        <button onClick={() => useEditor.getState().setWorkspace("Edit")}>
          Open sequence in Edit
        </button>
      )}
      {!current && !applied && (
        <p>Project changed. Run the prompt again before applying.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
