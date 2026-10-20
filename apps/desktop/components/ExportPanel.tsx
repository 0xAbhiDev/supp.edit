import { useRef, useState } from "react";
import { Download, CheckCircle2, X, Image } from "lucide-react";
import { useEditor } from "../../../packages/editor-state";
import {
  type Capabilities,
  desktop,
  saveImage,
} from "../../../packages/platform";
import { duration, fps } from "../../../packages/project-schema";
import {
  exportMp4,
  type RenderProgress,
} from "../../../packages/engine/export";
import { Compositor } from "../../../packages/engine/compositor";
import { clock } from "../../../packages/engine/clock";
import { usePlayback } from "../../../packages/engine/diagnostics";
export function ExportPanel({
  capabilities,
}: {
  capabilities: Capabilities | null;
}) {
  const project = useEditor((s) => s.project),
    [progress, setProgress] = useState<RenderProgress | null>(null),
    [busy, setBusy] = useState(false),
    controller = useRef<AbortController | null>(null);
  async function render() {
    clock.pause();
    setBusy(true);
    setProgress(null);
    controller.current = new AbortController();
    try {
      await exportMp4(project, setProgress, controller.current.signal);
    } catch (e) {
      useEditor.getState().report(e);
    } finally {
      setBusy(false);
    }
  }
  async function frame() {
    clock.pause();
    const canvas = document.createElement("canvas"),
      renderer = new Compositor(canvas, true, {
        renderer: usePlayback.getState().mode,
      });
    try {
      await renderer.render(project, clock.get().frame, false, 1, true);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) =>
          b ? resolve(b) : reject(new Error("PNG encoding failed")),
        ),
      );
      await saveImage(blob, `${project.name}-frame-${clock.get().frame}.png`);
    } catch (e) {
      useEditor.getState().report(e);
    } finally {
      await renderer.dispose();
    }
  }
  const available =
    desktop &&
    capabilities?.ffmpeg &&
    capabilities.encoders.includes("libx264");
  return (
    <aside className="export-panel panel">
      <div className="panel-heading">
        <span>Deliver</span>
        <Download size={15} />
      </div>
      <div className="export-body">
        <span className="eyebrow">RENDER YOUR SEQUENCE</span>
        <h2>
          Ready for the
          <br />
          outside world.
        </h2>
        <p>
          Your layers, edits, color, animation, and source audio in one file.
        </p>
        <label>
          Format
          <select disabled aria-label="Export format">
            <option>MP4 · H.264 + AAC</option>
          </select>
        </label>
        <dl>
          <dt>Resolution</dt>
          <dd>
            {project.settings.width} × {project.settings.height}
          </dd>
          <dt>Frame rate</dt>
          <dd>{fps(project).toFixed(3)} fps</dd>
          <dt>Duration</dt>
          <dd>{(duration(project) / fps(project)).toFixed(2)} seconds</dd>
          <dt>Quality</dt>
          <dd>CRF 18 · 8-bit SDR</dd>
          <dt>Audio</dt>
          <dd>48 kHz · 192 kbps</dd>
        </dl>
        {!available && (
          <div className="setup-notice">
            {desktop
              ? "Install FFmpeg with libx264 and AAC support, then restart the app. Set SUPP_FFMPEG and SUPP_FFPROBE if the tools are not on PATH."
              : "MP4 rendering is available in the desktop app with FFmpeg. You can export the current frame here."}
          </div>
        )}
        <button
          className="primary wide"
          onClick={() => void render()}
          disabled={!available || !duration(project) || busy}
        >
          <Download size={15} />
          {busy ? "Rendering…" : "Export MP4"}
        </button>
        <button
          className="secondary wide"
          onClick={() => void frame()}
          disabled={busy || !duration(project)}
        >
          <Image size={14} />
          Export current frame · PNG
        </button>
        {busy && (
          <button
            className="text-button"
            onClick={() => controller.current?.abort()}
          >
            <X size={14} />
            Cancel render
          </button>
        )}
        {progress && (
          <div className="render-progress" role="status">
            <div>
              {progress.status === "complete" ? (
                <CheckCircle2 size={15} />
              ) : null}
              {progress.status === "encoding"
                ? "Finalizing container…"
                : progress.status === "complete"
                  ? "Export complete"
                  : progress.status === "cancelled"
                    ? "Render cancelled"
                    : `Frame ${progress.frame} / ${progress.total}`}
            </div>
            <progress value={progress.frame} max={progress.total} />
            <small>{progress.elapsed.toFixed(1)}s elapsed</small>
            {progress.status === "complete" && <p>{progress.path}</p>}
          </div>
        )}
        <p className="field-hint">
          Export uses a frozen project snapshot and the same compositor as
          preview. Rendering runs frame by frame. Keep this window open.
        </p>
      </div>
    </aside>
  );
}
