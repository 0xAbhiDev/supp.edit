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
import { speedAt } from "../../../packages/time-remap/model";
import type { ReviewOptions } from "../../../packages/ai/rough-cut/planner";
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
    [rebuilding, setRebuilding] = useState(false),
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
  async function change(
    ids: string[],
    disabled?: string[],
    options?: ReviewOptions,
  ) {
    if (rebuilding) return;
    setRebuilding(true);
    setPlaying(false);
    setError("");
    try {
      const outcome = await roughCutService.reselect(
        session,
        ids,
        disabled,
        options,
      ).finished;
      if (outcome.state === "Completed") onChange(outcome.result);
      else if (outcome.state === "Failed") setError(outcome.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setRebuilding(false);
    }
  }
  const ids = cut.shots.map((s) => s.candidate.id),
    alternatives = cut.candidates.filter((c) => !ids.includes(c.id));
  return (
    <section className="rough-cut-review" aria-label="Gym edit plan">
      <h3>
        {cut.brief.style ? "Aesthetic gym edit" : "Gym edit plan"} · {view.name}
      </h3>
      <p>{cut.brief.prompt}</p>
      {rebuilding && (
        <p role="status">
          Updating the framed preview. Progress and cancellation are available
          in Jobs.
        </p>
      )}
      {cut.brief.style && (
        <p>
          Style: {gymStyles[cut.brief.style].name} · {view.settings.width}×
          {view.settings.height} ·{" "}
          {cut.shots.filter((s) => s.beatAligned).length} aligned boundaries ·{" "}
          {cut.musicEvents.filter((e) => e.kind === "strong-onset").length}{" "}
          strong measured music events ·{" "}
          {
            view.clips.filter((c) => c.effectStack.some((e) => e.enabled))
              .length
          }{" "}
          shots with editable color
          {" · "}
          {cut.colorMatchedShots} shots matched from RGB measurements
          {" · "}
          {cut.framedShots} framed shots ·{" "}
          {cut.ramps.filter((r) => r.enabled).length} speed ramps ·{" "}
          {cut.punchIns.filter((p) => p.enabled).length} punch-ins ·{" "}
          {cut.framingTreatment}
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
      {cut.audio && (
        <p>
          Audio: {cut.audio.speechClips} spoken shots · {cut.audio.duckedRanges}{" "}
          speech ranges duck music · {cut.audio.suppressedSources} room-audio
          clips suppressed · editable fades and gain · peak protection.
          Captions: {view.clips.filter((c) => c.kind === "text").length}{" "}
          editable clips
          {cut.audio.captionStyle ? ` (${cut.audio.captionStyle})` : " · Off"}.
        </p>
      )}
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
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Enable ${e.type} on shot ${i + 1}`}
                        disabled={rebuilding || applied || !current}
                        checked={
                          !cut.reviewOptions.disabledEffects.includes(
                            `${c.id}:${e.type}`,
                          )
                        }
                        onChange={() => {
                          const key = `${c.id}:${e.type}`,
                            prior = cut.reviewOptions.disabledEffects;
                          void change(ids, undefined, {
                            ...cut.reviewOptions,
                            disabledEffects: prior.includes(key)
                              ? prior.filter((k) => k !== key)
                              : [...prior, key],
                          });
                        }}
                      />
                    </label>{" "}
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
              {cut.punchIns
                .filter((p) => p.candidateId === c.id)
                .map((p) => (
                  <label key={p.controllerId}>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      disabled={rebuilding || applied || !current}
                      onChange={() => {
                        const prior = cut.reviewOptions.disabledPunchIns;
                        void change(ids, undefined, {
                          ...cut.reviewOptions,
                          disabledPunchIns: p.enabled
                            ? [...prior, c.id]
                            : prior.filter((id) => id !== c.id),
                        });
                      }}
                    />{" "}
                    Punch-in +{(p.amount * 100).toFixed(1)}% · independent
                    controller
                  </label>
                ))}
              {cut.ramps
                .filter((r) => r.candidateId === c.id)
                .map((r) => (
                  <div key={r.candidateId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={rebuilding || applied || !current}
                        onChange={() => {
                          const disabled = cut.ramps
                            .filter((x) =>
                              x.candidateId === r.candidateId
                                ? r.enabled
                                : !x.enabled,
                            )
                            .map((x) => x.candidateId);
                          void change(ids, disabled);
                        }}
                      />{" "}
                      Speed ramp
                    </label>
                    <p>
                      Timeline: {(r.beforeFrames / rate).toFixed(2)}s →{" "}
                      {(r.afterFrames / rate).toFixed(2)}s · {r.reason}
                    </p>
                    <svg
                      viewBox="0 0 300 90"
                      role="img"
                      aria-label={`Proposed speed curve ${i + 1}`}
                      style={{ width: "100%", height: 65 }}
                    >
                      <polyline
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        points={Array.from(
                          { length: 61 },
                          (_, j) =>
                            `${j * 5},${85 - speedAt({ sourceIn: 0, timeRemap: r.curve }, (shot.duration * j) / 60) * 35}`,
                        ).join(" ")}
                      />
                    </svg>
                  </div>
                ))}
              <button
                aria-label={`Remove shot ${i + 1}`}
                disabled={rebuilding || applied || !current || ids.length < 2}
                onClick={() => change(ids.filter((id) => id !== c.id))}
              >
                Remove
              </button>
              <button
                aria-label={`Move shot ${i + 1} earlier`}
                disabled={rebuilding || applied || !current || i === 0}
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
                  disabled={rebuilding || applied || !current}
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
        disabled={rebuilding || !current || applied}
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
