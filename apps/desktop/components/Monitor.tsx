import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat2,
  Maximize,
  Scan,
  Film,
  Upload,
  X,
  Volume2,
} from "lucide-react";
import { useEditor, editorProject } from "../../../packages/editor-state";
import { fps, duration, timecode } from "../../../packages/project-schema";
import { Compositor } from "../../../packages/engine/compositor";
import { clock, useClock } from "../../../packages/engine/clock";
import { lifecycleMark, sourceUrl } from "../../../packages/platform";
import {
  animated,
  setTransform,
  sourceEdit,
  editPoints,
} from "../../../packages/commands";
import { IconButton } from "./Controls";
import { MaskOverlay } from "./MaskEditor";
import { usePlayback } from "../../../packages/engine/diagnostics";
import {
  canvasMatrix,
  inverse,
  layerTransforms,
  point,
} from "../../../packages/animation/affine";
export function Monitor({
  onImport,
  onCanvas,
}: {
  onImport: () => void;
  onCanvas: (c: HTMLCanvasElement | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    renderRef = useRef<Compositor | null>(null),
    project = useEditor(editorProject),
    selected = useEditor((s) => s.selected);
  const mode = usePlayback((s) => s.mode),
    resolution = usePlayback((s) => s.scale);
  const [safe, setSafe] = useState(false),
    [renderError, setRenderError] = useState<string | null>(null),
    [fit, setFit] = useState({ width: 640, height: 360 });
  useEffect(() => {
    const stage = container.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      const css = getComputedStyle(stage),
        w =
          stage.clientWidth -
          parseFloat(css.paddingLeft) -
          parseFloat(css.paddingRight),
        h =
          stage.clientHeight -
          parseFloat(css.paddingTop) -
          parseFloat(css.paddingBottom),
        scale = Math.min(
          w / project.settings.width,
          h / project.settings.height,
        );
      setFit({
        width: Math.max(1, project.settings.width * scale),
        height: Math.max(1, project.settings.height * scale),
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [project.settings.width, project.settings.height]);
  useEffect(() => {
    if (!canvas.current) return;
    const renderer = new Compositor(canvas.current, false, {
      renderer: mode,
      scale: resolution,
    });
    renderRef.current = renderer;
    onCanvas(canvas.current);
    let disposed = false,
      running = false,
      pending = true;
    let rendered = 0,
      dropped = 0,
      lastFrame: number | null = null,
      lastPublish = 0;
    async function render() {
      if (running || disposed) return;
      running = true;
      while (pending && !disposed) {
        pending = false;
        const p = editorProject(useEditor.getState()),
          s = clock.get();
        try {
          const start = performance.now();
          const state = useEditor.getState();
          const background =
            state.project.compositions.find(
              (c) => c.id === state.activeComposition,
            )?.background ?? "#000000";
          const error = await renderer.render(
            p,
            s.frame,
            s.playing,
            s.speed,
            false,
            background,
          );
          if (
            s.playing &&
            lastFrame !== null &&
            s.speed === 1 &&
            s.frame > lastFrame
          )
            dropped += Math.max(0, s.frame - lastFrame - 1);
          lastFrame = s.playing ? s.frame : null;
          if (rendered === 0)
            lifecycleMark("renderer first frame", `${renderer.backend}${error ? `: ${error}` : ""}`);
          rendered++;
          if (
            !disposed &&
            (performance.now() - lastPublish > 250 || !s.playing)
          ) {
            lastPublish = performance.now();
            usePlayback.getState().publish({
              renderer: renderer.backend,
              gpu: renderer.device,
              fallback: renderer.fallback,
              renderMs: performance.now() - start,
              rendered,
              dropped,
              decodedDropped: renderer.pool.decodedDropped,
              frameCacheBytes: renderer.pool.frames.bytes,
              frameCacheHits: renderer.pool.frames.hits,
              resourceCount: renderer.pool.size,
              textureBytes: renderer.textureBytes,
              error: error?.message ?? "",
            });
          }
          if (!disposed) setRenderError(error?.message ?? null);
        } catch (e) {
          if (!disposed) setRenderError(String(e));
        }
      }
      running = false;
    }
    const request = () => {
      pending = true;
      void render();
    };
    const u1 = clock.subscribe(request),
      u2 = useEditor.subscribe((s, old) => {
        if (
          s.project !== old.project ||
          s.activeComposition !== old.activeComposition
        )
          request();
      });
    request();
    return () => {
      disposed = true;
      renderer.cancel();
      u1();
      u2();
      // Let an in-flight frame release its borrowed image surfaces before tearing down the pool.
      const close = () => {
        if (running) setTimeout(close, 10);
        else void renderer.dispose();
      };
      close();
      onCanvas(null);
    };
  }, [onCanvas, mode, resolution]);
  function move(e: React.PointerEvent) {
    if (e.button !== 0 || !selected) return;
    const c = project.clips.find((c) => c.id === selected);
    if (!c || project.tracks.find((t) => t.id === c.trackId)?.locked) return;
    clock.pause();
    const bounds = canvas.current!.getBoundingClientRect(),
      startX = e.clientX,
      startY = e.clientY,
      frame = clock.get().frame,
      t = animated(c, frame),
      target = e.currentTarget;
    let basis;
    try {
      basis = inverse(layerTransforms(project, frame).basis(c.id));
    } catch (error) {
      useEditor.getState().report(error);
      return;
    }
    const offset = (event: PointerEvent) => {
      const dx =
          ((event.clientX - startX) * project.settings.width) / bounds.width,
        dy =
          ((event.clientY - startY) * project.settings.height) / bounds.height;
      return {
        dx: basis[0] * dx + basis[2] * dy,
        dy: basis[1] * dx + basis[3] * dy,
      };
    };
    target.setPointerCapture(e.pointerId);
    const update = (event: PointerEvent) => {
      const { dx, dy } = offset(event);
      target.setAttribute(
        "data-moving",
        `${Math.round(dx)}, ${Math.round(dy)}`,
      );
    };
    const done = (event: PointerEvent) => {
      target.removeEventListener("pointermove", update as EventListener);
      target.removeEventListener("pointerup", done as EventListener);
      target.removeEventListener("pointercancel", cancel as EventListener);
      target.removeAttribute("data-moving");
      const { dx, dy } = offset(event);
      if (Math.abs(dx) + Math.abs(dy) > 1)
        useEditor.getState().executeScoped("Move layer on canvas", (p) => {
          setTransform(
            c.id,
            "x",
            Math.max(-32768, Math.min(32768, t.x + dx)),
            frame,
          )(p);
          setTransform(
            c.id,
            "y",
            Math.max(-32768, Math.min(32768, t.y + dy)),
            frame,
          )(p);
        });
    };
    const cancel = () => {
      target.removeEventListener("pointermove", update as EventListener);
      target.removeEventListener("pointerup", done as EventListener);
      target.removeEventListener("pointercancel", cancel as EventListener);
      target.removeAttribute("data-moving");
    };
    target.addEventListener("pointermove", update as EventListener);
    target.addEventListener("pointerup", done as EventListener, { once: true });
    target.addEventListener("pointercancel", cancel as EventListener, {
      once: true,
    });
  }
  return (
    <section className="monitor panel">
      <div className="panel-heading">
        <span>
          <span className="tiny-dot" /> Program
        </span>
        <span className="monitor-sequence">{project.name}</span>
        <span className="badge">
          {project.settings.width} × {project.settings.height}
        </span>
      </div>
      <div className="monitor-stage" ref={container}>
        <div
          className="canvas-wrap"
          style={{
            width: fit.width,
            height: fit.height,
            aspectRatio: `${project.settings.width}/${project.settings.height}`,
          }}
          onPointerDown={move}
        >
          <canvas ref={canvas} aria-label="Program monitor" />
          <ControllerOverlay />
          <MaskOverlay />
          {safe && <div className="safe-guides" />}
          {!project.clips.length && (
            <div className="monitor-empty">
              <div className="frame-corners">
                <Film size={34} />
              </div>
              <h2>
                A blank canvas.
                <br />
                <span>Endless possibilities.</span>
              </h2>
              <p>Your story starts with a single frame.</p>
              <button className="primary" onClick={onImport}>
                <Upload size={14} /> Import your media
              </button>
              <small>or add a title or shape from the timeline</small>
            </div>
          )}
        </div>
        {renderError && (
          <div className="monitor-error" role="alert">
            {renderError}
          </div>
        )}
        <div className="monitor-label">
          {project.settings.colorSpace.toUpperCase()}
          <RendererLabel />
        </div>
      </div>
      <div className="monitor-bottom">
        <select
          aria-label="Playback resolution"
          value={resolution}
          onChange={(e) =>
            usePlayback.getState().configure({ scale: Number(e.target.value) })
          }
        >
          <option value={1}>Full</option>
          <option value={0.5}>Half</option>
          <option value={0.25}>Quarter</option>
        </select>
        <Transport />
        <div className="monitor-actions">
          <IconButton
            label="Safe margins"
            aria-pressed={safe}
            onClick={() => setSafe(!safe)}
          >
            <Scan size={15} />
          </IconButton>
          <IconButton
            label="Fullscreen monitor"
            onClick={() => {
              const promise = document.fullscreenElement
                ? document.exitFullscreen()
                : container.current?.requestFullscreen();
              promise?.catch(useEditor.getState().report);
            }}
          >
            <Maximize size={15} />
          </IconButton>
        </div>
      </div>
    </section>
  );
}
function ControllerOverlay() {
  const project = useEditor(editorProject),
    selected = useEditor((s) => s.selected),
    workspace = useEditor((s) => s.workspace),
    { frame } = useClock();
  const clip = project.clips.find((c) => c.id === selected);
  if (workspace !== "Composite" || !clip) return null;
  try {
    const transforms = layerTransforms(project, frame),
      matrix = canvasMatrix(project, transforms.world(clip.id));
    const t = animated(clip, frame);
    const origin = point(matrix, t.anchorX, t.anchorY);
    const parent = clip.parentId
      ? point(canvasMatrix(project, transforms.world(clip.parentId)), 0, 0)
      : null;
    return (
      <svg
        aria-label="Layer controller overlay"
        viewBox={`0 0 ${project.settings.width} ${project.settings.height}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        {parent && (
          <line
            x1={origin.x}
            y1={origin.y}
            x2={parent.x}
            y2={parent.y}
            stroke="#c3f96b"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {clip.kind === "null" && (
          <g
            transform={`matrix(${matrix.join(" ")})`}
            stroke="#c3f96b"
            fill="none"
            strokeWidth="1.5"
          >
            <rect
              x="-25"
              y="-25"
              width="50"
              height="50"
              vectorEffect="non-scaling-stroke"
            />
            <path d="M-35 0H35M0 -35V35" vectorEffect="non-scaling-stroke" />
          </g>
        )}
        <circle
          cx={origin.x}
          cy={origin.y}
          r={Math.max(project.settings.width / 200, 2)}
          fill="none"
          stroke="#c3f96b"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  } catch {
    return null;
  }
}
function RendererLabel() {
  const renderer = usePlayback((s) => s.renderer),
    dropped = usePlayback((s) => s.dropped);
  return (
    <span>
      {renderer} · {dropped} dropped
    </span>
  );
}
function Transport() {
  const s = useClock(),
    p = useEditor(editorProject),
    rate = fps(p);
  return (
    <div className="transport">
      <span className="timecode">{timecode(s.frame, rate)}</span>
      <IconButton
        label="Previous edit"
        onClick={() => {
          clock.pause();
          clock.seek(
            editPoints(p)
              .filter((f) => f < s.frame)
              .at(-1) ?? 0,
          );
        }}
      >
        │‹
      </IconButton>
      <IconButton
        label="Previous frame"
        onClick={() => {
          clock.pause();
          clock.seek(s.frame - 1);
        }}
      >
        <SkipBack size={15} />
      </IconButton>
      <IconButton
        label={s.playing ? "Pause" : "Play"}
        onClick={() => clock.toggle()}
      >
        {s.playing ? (
          <Pause size={17} fill="currentColor" />
        ) : (
          <Play size={17} fill="currentColor" />
        )}
      </IconButton>
      <IconButton
        label="Next frame"
        onClick={() => {
          clock.pause();
          clock.seek(Math.min(duration(p) - 1, s.frame + 1));
        }}
      >
        <SkipForward size={15} />
      </IconButton>
      <IconButton
        label="Loop playback"
        aria-pressed={s.loop}
        onClick={() => clock.loop()}
      >
        <Repeat2 size={15} />
      </IconButton>
      <IconButton
        label="Next edit"
        onClick={() => {
          clock.pause();
          clock.seek(editPoints(p).find((f) => f > s.frame) ?? duration(p));
        }}
      >
        ›│
      </IconButton>
      <span className="timecode muted">{timecode(duration(p), rate)}</span>
    </div>
  );
}
export function SourceViewer() {
  const source = useEditor((s) => s.source),
    project = useEditor(editorProject),
    asset = useEditor((s) => s.project.assets.find((a) => a.id === source)),
    [url, setUrl] = useState(""),
    [error, setError] = useState("");
  const media = useRef<HTMLMediaElement | null>(null),
    [markIn, setMarkIn] = useState(0),
    [markOut, setMarkOut] = useState(1),
    [target, setTarget] = useState("");
  const rate = fps(project),
    maximum =
      asset?.kind === "image"
        ? Math.round(rate * 5)
        : Math.max(1, Math.floor((asset?.duration ?? 0) * rate));
  const tracks = project.tracks.filter(
    (t) =>
      !t.locked &&
      (asset?.kind === "audio" ? t.kind === "audio" : t.kind === "video"),
  );
  const targetId = tracks.some((t) => t.id === target)
    ? target
    : (tracks[0]?.id ?? "");
  useEffect(() => {
    setMarkIn(0);
    setMarkOut(maximum);
  }, [source, maximum, asset?.fingerprint]);
  function insert(mode: "insert" | "overwrite") {
    if (!asset || !targetId) return;
    const state = useEditor.getState(),
      before = editorProject(state);
    state.executeScoped(
      `${mode === "insert" ? "Insert" : "Overwrite"} source range`,
      sourceEdit(
        asset.id,
        targetId,
        clock.get().frame,
        mode,
        markIn,
        markOut - markIn,
      ),
    );
    const after = editorProject(useEditor.getState());
    if (after !== before) {
      state.select(after.clips.at(-1)!.id);
      state.setSource(null);
    }
  }
  useEffect(() => {
    setUrl("");
    setError("");
    if (!asset) return;
    let active = true;
    sourceUrl(asset)
      .then((url) => {
        if (active) setUrl(url);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [asset]);
  if (!asset) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) useEditor.getState().setSource(null);
      }}
    >
      <section
        className="modal source-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Source monitor"
      >
        <div className="panel-heading">
          <span>Source · {asset.name}</span>
          <IconButton
            label="Close source monitor"
            onClick={() => useEditor.getState().setSource(null)}
          >
            <X size={18} />
          </IconButton>
        </div>
        <div className="source-preview">
          {error ? (
            <p role="alert">{error}</p>
          ) : url ? (
            asset.kind === "image" ? (
              <img src={url} alt={asset.name} />
            ) : asset.kind === "video" ? (
              <video
                ref={(el) => {
                  media.current = el;
                }}
                src={url}
                controls
                onError={() =>
                  setError(
                    "This codec cannot be decoded by the system webview. Transcode to H.264/AAC MP4.",
                  )
                }
              />
            ) : (
              <>
                <Volume2 size={64} />
                <audio
                  ref={(el) => {
                    media.current = el;
                  }}
                  src={url}
                  controls
                  onError={() =>
                    setError("Audio decode failed. Try WAV or AAC.")
                  }
                />
              </>
            )
          ) : (
            <p>Loading source…</p>
          )}
        </div>
        <div className="source-metadata">
          <span>{asset.codec}</span>
          <span>
            {asset.width} × {asset.height}
          </span>
          <span>{asset.duration.toFixed(3)} seconds</span>
          <span>
            {asset.fps
              ? `${asset.fps.toFixed(3)} fps`
              : "Frame rate not reported"}
          </span>
        </div>
        <div className="source-edit-controls">
          <label>
            In (frame)
            <input
              aria-label="Source In frame"
              type="number"
              min="0"
              max={markOut - 1}
              value={markIn}
              onChange={(e) =>
                setMarkIn(
                  Math.max(
                    0,
                    Math.min(markOut - 1, Math.round(+e.target.value)),
                  ),
                )
              }
            />
          </label>
          <button
            disabled={asset.kind === "image" || !url}
            onClick={() =>
              setMarkIn(
                Math.min(
                  markOut - 1,
                  Math.max(
                    0,
                    Math.floor((media.current?.currentTime ?? 0) * rate),
                  ),
                ),
              )
            }
          >
            Set In
          </button>
          <label>
            Out (exclusive)
            <input
              aria-label="Source Out frame"
              type="number"
              min={markIn + 1}
              max={maximum}
              value={markOut}
              onChange={(e) =>
                setMarkOut(
                  Math.min(
                    maximum,
                    Math.max(markIn + 1, Math.round(+e.target.value)),
                  ),
                )
              }
            />
          </label>
          <button
            disabled={asset.kind === "image" || !url}
            onClick={() =>
              setMarkOut(
                Math.min(
                  maximum,
                  Math.max(
                    markIn + 1,
                    Math.floor((media.current?.currentTime ?? 0) * rate) + 1,
                  ),
                ),
              )
            }
          >
            Set Out
          </button>
          <label>
            Target track
            <select
              aria-label="Source target track"
              value={targetId}
              onChange={(e) => setTarget(e.target.value)}
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!targetId || !!error || !url}
            onClick={() => insert("insert")}
          >
            Insert range
          </button>
          <button
            disabled={!targetId || !!error || !url}
            onClick={() => insert("overwrite")}
          >
            Overwrite range
          </button>
        </div>
      </section>
    </div>
  );
}
