import { useEffect, useRef, useState } from "react";
import { type Project, fps, duration } from "../../../packages/project-schema";
import { Compositor } from "../../../packages/engine/compositor";
import { clock } from "../../../packages/engine/clock";
export function SequencePreview({ project }: { project: Project }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    position = useRef(0);
  const [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState("");
  const seek = playing ? null : frame,
    rate = fps(project),
    end = duration(project);
  position.current = frame;
  useEffect(() => {
    if (!canvas.current || !end) return;
    let disposed = false;
    const renderer = new Compositor(canvas.current, false, {
      scale: Math.min(0.5, 480 / project.settings.width),
    });
    const startFrame =
        playing && position.current >= end - 1 ? 0 : position.current,
      start = performance.now();
    const pending = (async () => {
      let next = startFrame;
      do {
        const failure = await renderer.render(project, next, playing);
        if (failure) throw failure;
        if (disposed) return;
        setFrame(next);
        if (!playing) return;
        if (next >= end - 1) {
          setPlaying(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000 / rate));
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
  }, [project, playing, seek, end, rate]);
  return (
    <figure className="sequence-preview">
      <canvas ref={canvas} aria-label="Revision sequence preview" />
      <button
        onClick={() => {
          clock.pause();
          setPlaying((v) => !v);
        }}
      >
        {playing ? "Pause revision preview" : "Preview revision"}
      </button>
      <input
        aria-label="Revision preview frame"
        type="range"
        min={0}
        max={Math.max(0, end - 1)}
        value={frame}
        onChange={(e) => {
          setPlaying(false);
          setFrame(Number(e.target.value));
        }}
      />
      <figcaption>
        {(frame / rate).toFixed(2)} / {(end / rate).toFixed(2)} seconds ·
        proposed sequence
      </figcaption>
      {error && <p role="alert">{error}</p>}
    </figure>
  );
}
