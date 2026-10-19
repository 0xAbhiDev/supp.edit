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
import { useEditor } from "../../../packages/editor-state";
import { fps, duration, timecode } from "../../../packages/project-schema";
import { Compositor } from "../../../packages/engine/compositor";
import { clock, useClock } from "../../../packages/engine/clock";
import { sourceUrl } from "../../../packages/platform";
import { animated, setTransform } from "../../../packages/commands";
import { IconButton } from "./Controls";
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
    project = useEditor((s) => s.project),
    selected = useEditor((s) => s.selected);
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
    const renderer = new Compositor(canvas.current);
    renderRef.current = renderer;
    onCanvas(canvas.current);
    let disposed = false,
      running = false,
      pending = true;
    async function render() {
      if (running || disposed) return;
      running = true;
      while (pending && !disposed) {
        pending = false;
        const p = useEditor.getState().project,
          s = clock.get();
        try {
          const error = await renderer.render(p, s.frame, s.playing, s.speed);
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
        if (s.project !== old.project) request();
      });
    request();
    return () => {
      disposed = true;
      u1();
      u2();
      void renderer.dispose();
      onCanvas(null);
    };
  }, [onCanvas]);
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
    target.setPointerCapture(e.pointerId);
    const update = (event: PointerEvent) => {
      const dx =
          ((event.clientX - startX) * project.settings.width) / bounds.width,
        dy =
          ((event.clientY - startY) * project.settings.height) / bounds.height;
      target.setAttribute(
        "data-moving",
        `${Math.round(dx)}, ${Math.round(dy)}`,
      );
    };
    const done = (event: PointerEvent) => {
      target.removeEventListener("pointermove", update as EventListener);
      target.removeEventListener("pointerup", done as EventListener);
      target.removeAttribute("data-moving");
      const dx =
          ((event.clientX - startX) * project.settings.width) / bounds.width,
        dy =
          ((event.clientY - startY) * project.settings.height) / bounds.height;
      if (Math.abs(dx) + Math.abs(dy) > 1)
        useEditor.getState().execute("Move layer on canvas", (p) => {
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
    target.addEventListener("pointermove", update as EventListener);
    target.addEventListener("pointerup", done as EventListener, { once: true });
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
          <span>CPU COMPOSITOR</span>
        </div>
      </div>
      <div className="monitor-bottom">
        <span className="muted">Fit</span>
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
function Transport() {
  const s = useClock(),
    p = useEditor((s) => s.project),
    rate = fps(p);
  return (
    <div className="transport">
      <span className="timecode">{timecode(s.frame, rate)}</span>
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
      <span className="timecode muted">{timecode(duration(p), rate)}</span>
    </div>
  );
}
export function SourceViewer() {
  const source = useEditor((s) => s.source),
    asset = useEditor((s) => s.project.assets.find((a) => a.id === source)),
    [url, setUrl] = useState(""),
    [error, setError] = useState("");
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
      </section>
    </div>
  );
}
