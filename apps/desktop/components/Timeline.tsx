import { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  Scissors,
  Magnet,
  Plus,
  Type,
  Square,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Trash2,
  Flag,
  Minus,
} from "lucide-react";
import { useEditor } from "../../../packages/editor-state";
import {
  fps,
  duration,
  newTrack,
  newClip,
  uid,
  type Clip,
} from "../../../packages/project-schema";
import { clock } from "../../../packages/engine/clock";
import {
  moveClip,
  trimClip,
  splitClip,
  deleteClip,
  insertAsset,
} from "../../../packages/commands";
import { thumbnails, waveforms } from "../../../packages/platform";
import { IconButton } from "./Controls";
export function Timeline() {
  const project = useEditor((s) => s.project),
    selected = useEditor((s) => s.selected),
    execute = useEditor((s) => s.execute),
    select = useEditor((s) => s.select);
  const [zoom, setZoom] = useState(45),
    [snap, setSnap] = useState(true),
    [ripple, setRipple] = useState(false),
    [viewport, setViewport] = useState({ left: 0, width: 1000 }),
    [drag, setDrag] = useState<{
      id: string;
      start: number;
      duration: number;
    } | null>(null);
  const scroller = useRef<HTMLDivElement>(null),
    playhead = useRef<HTMLDivElement>(null),
    rate = fps(project),
    px = zoom / rate,
    total = Math.max(duration(project) + rate * 10, rate * 30),
    width = Math.max(800, total * px),
    interval = zoom >= 80 ? 1 : zoom >= 30 ? 5 : 10;
  useEffect(() => {
    const update = () => {
      if (playhead.current)
        playhead.current.style.transform = `translateX(${clock.get().frame * px}px)`;
    };
    const unsub = clock.subscribe(update);
    update();
    return unsub;
  }, [px]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const resize = new ResizeObserver(() =>
      setViewport({ left: el.scrollLeft, width: el.clientWidth }),
    );
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  function addTrack(kind: "video" | "audio") {
    execute("Add track", (p) => {
      const t = newTrack(
        kind,
        p.tracks.filter((t) => t.kind === kind).length + 1,
      );
      kind === "video" ? p.tracks.unshift(t) : p.tracks.push(t);
    });
  }
  function generated(kind: "text" | "shape") {
    const track = newTrack(
        "video",
        project.tracks.filter((t) => t.kind === "video").length + 1,
      ),
      c = newClip(track.id, clock.get().frame, Math.round(rate * 5), kind);
    execute(`Add ${kind} layer`, (p) => {
      p.tracks.unshift(track);
      p.clips.push(c);
    });
    select(c.id);
  }
  function frameAt(clientX: number) {
    const bounds = scroller.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.round(
        (clientX - bounds.left + scroller.current!.scrollLeft - 164) / px,
      ),
    );
  }
  function snapped(frame: number, id: string) {
    if (!snap) return Math.max(0, frame);
    const points = [
      0,
      clock.get().frame,
      ...project.markers.map((m) => m.frame),
      ...project.clips
        .filter((c) => c.id !== id)
        .flatMap((c) => [c.start, c.start + c.duration]),
    ];
    const near = points.reduce(
      (best, p) => (Math.abs(p - frame) < Math.abs(best - frame) ? p : best),
      frame + 10 / px,
    );
    return Math.max(0, Math.abs(near - frame) * px < 8 ? near : frame);
  }
  function pointer(
    e: React.PointerEvent,
    c: Clip,
    edge: "move" | "in" | "out",
  ) {
    e.stopPropagation();
    select(c.id);
    if (
      project.tracks.find((t) => t.id === c.trackId)?.locked ||
      e.button !== 0
    )
      return;
    clock.pause();
    e.currentTarget.setPointerCapture(e.pointerId);
    const origin = e.clientX,
      target = e.currentTarget;
    let start = c.start,
      end = c.start + c.duration,
      didMove = false;
    const update = (event: PointerEvent) => {
      didMove = true;
      const delta = Math.round((event.clientX - origin) / px);
      if (edge === "move") {
        start = snapped(c.start + delta, c.id);
        end = start + c.duration;
      } else if (edge === "in") {
        start = Math.max(
          c.start - c.sourceIn,
          Math.min(end - 1, snapped(c.start + delta, c.id)),
        );
      } else {
        const asset = project.assets.find((a) => a.id === c.assetId),
          max =
            asset && asset.kind !== "image"
              ? c.start + Math.floor(asset.duration * rate) - c.sourceIn
              : 2e9;
        end = Math.min(
          max,
          Math.max(start + 1, snapped(c.start + c.duration + delta, c.id)),
        );
      }
      setDrag({ id: c.id, start, duration: end - start });
    };
    const done = (event: PointerEvent) => {
      target.removeEventListener("pointermove", update as EventListener);
      target.removeEventListener("pointerup", done as EventListener);
      setDrag(null);
      if (!didMove) return;
      const under = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;
      if (edge === "move") execute("Move clip", moveClip(c.id, start, under));
      else
        execute("Trim clip", trimClip(c.id, edge, edge === "in" ? start : end));
    };
    target.addEventListener("pointermove", update as EventListener);
    target.addEventListener("pointerup", done as EventListener, { once: true });
  }
  return (
    <section className="timeline panel">
      <div className="timeline-toolbar">
        <div className="sequence-tab">
          <span className="tiny-dot" />
          {project.name}
          <span className="badge">Sequence 01</span>
        </div>
        <span className="grow" />
        <span className="timeline-hint">Drag to move · edges to trim</span>
        <IconButton
          label="Zoom out timeline"
          onClick={() => setZoom(Math.max(10, zoom / 1.3))}
        >
          <Minus size={14} />
        </IconButton>
        <input
          aria-label="Timeline zoom"
          type="range"
          min="10"
          max="180"
          value={zoom}
          onChange={(e) => setZoom(+e.target.value)}
        />
        <IconButton
          label="Zoom in timeline"
          onClick={() => setZoom(Math.min(180, zoom * 1.3))}
        >
          <Plus size={14} />
        </IconButton>
      </div>
      <div className="timeline-tools">
        <span className="active-tool">
          <MousePointer2 size={15} />
        </span>
        <IconButton
          label="Split selected clip (S)"
          disabled={!selected}
          onClick={() =>
            selected &&
            execute("Split clip", splitClip(selected, clock.get().frame))
          }
        >
          <Scissors size={15} />
        </IconButton>
        <IconButton
          label="Delete selected clip"
          disabled={!selected}
          onClick={() =>
            selected &&
            execute(
              ripple ? "Ripple delete" : "Delete clip",
              deleteClip(selected, ripple),
            )
          }
        >
          <Trash2 size={15} />
        </IconButton>
        <span className="divider" />
        <IconButton
          label="Snapping"
          aria-pressed={snap}
          onClick={() => setSnap(!snap)}
        >
          <Magnet size={15} />
        </IconButton>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={ripple}
            onChange={(e) => setRipple(e.target.checked)}
          />
          Ripple delete
        </label>
        <span className="divider" />
        <button onClick={() => generated("text")}>
          <Type size={14} />
          Title
        </button>
        <button onClick={() => generated("shape")}>
          <Square size={13} />
          Shape
        </button>
        <button
          onClick={() =>
            execute("Add marker", (p) => {
              p.markers.push({
                id: uid(),
                frame: clock.get().frame,
                name: `Marker ${p.markers.length + 1}`,
              });
            })
          }
        >
          <Flag size={13} />
          Marker
        </button>
        <span className="grow" />
        <button onClick={() => addTrack("video")}>
          <Plus size={13} />
          Video
        </button>
        <button onClick={() => addTrack("audio")}>
          <Plus size={13} />
          Audio
        </button>
      </div>
      <div
        className="timeline-scroll"
        ref={scroller}
        onScroll={(e) =>
          setViewport({
            left: e.currentTarget.scrollLeft,
            width: e.currentTarget.clientWidth,
          })
        }
      >
        <div className="timeline-content" style={{ width: width + 164 }}>
          <div className="timeline-ruler">
            <div className="ruler-label">
              TRACKS <span>{project.tracks.length}</span>
            </div>
            <div
              className="ruler-ticks"
              style={{ width }}
              onPointerDown={(e) => {
                clock.pause();
                clock.seek(frameAt(e.clientX));
                const target = e.currentTarget;
                target.setPointerCapture(e.pointerId);
                const move = (ev: PointerEvent) =>
                  clock.seek(frameAt(ev.clientX));
                target.addEventListener("pointermove", move);
                target.addEventListener(
                  "pointerup",
                  () => target.removeEventListener("pointermove", move),
                  { once: true },
                );
              }}
            >
              {Array.from(
                { length: Math.ceil(total / rate / interval) },
                (_, i) => i * interval,
              )
                .filter(
                  (sec) =>
                    sec * zoom >= viewport.left - zoom * interval &&
                    sec * zoom < viewport.left + viewport.width,
                )
                .map((sec) => (
                  <span key={sec} style={{ left: sec * zoom }}>
                    {Math.floor(sec / 60)
                      .toString()
                      .padStart(2, "0")}
                    :{(sec % 60).toString().padStart(2, "0")}
                  </span>
                ))}
              {project.markers.map((m) => (
                <button
                  className="marker"
                  key={m.id}
                  style={{ left: m.frame * px }}
                  title={`${m.name} · double-click to delete`}
                  onClick={(e) => {
                    e.stopPropagation();
                    clock.seek(m.frame);
                  }}
                  onDoubleClick={() =>
                    execute("Delete marker", (p) => {
                      p.markers = p.markers.filter((v) => v.id !== m.id);
                    })
                  }
                >
                  <Flag size={12} />
                </button>
              ))}
            </div>
          </div>
          {project.tracks.map((track, index) => (
            <div
              className={`track-row ${track.kind} ${track.locked ? "locked" : ""}`}
              key={track.id}
              data-track-id={track.id}
            >
              <div className="track-label">
                <span className="track-index">
                  {track.kind === "video" ? "V" : "A"}
                  {project.tracks
                    .filter((t) => t.kind === track.kind)
                    .indexOf(track) + 1}
                </span>
                <div>
                  <input
                    aria-label={`Rename ${track.name}`}
                    value={track.name}
                    onChange={(e) =>
                      execute("Rename track", (p) => {
                        p.tracks[index].name = e.target.value;
                      })
                    }
                  />
                  <div className="track-controls">
                    <IconButton
                      label={`${track.locked ? "Unlock" : "Lock"} ${track.name}`}
                      onClick={() =>
                        execute("Toggle track lock", (p) => {
                          p.tracks[index].locked = !track.locked;
                        })
                      }
                    >
                      {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </IconButton>
                    {track.kind === "video" && (
                      <IconButton
                        label={`${track.hidden ? "Show" : "Hide"} ${track.name}`}
                        onClick={() =>
                          execute("Toggle track visibility", (p) => {
                            p.tracks[index].hidden = !track.hidden;
                          })
                        }
                      >
                        {track.hidden ? (
                          <EyeOff size={12} />
                        ) : (
                          <Eye size={12} />
                        )}
                      </IconButton>
                    )}
                    <IconButton
                      label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
                      aria-pressed={track.muted}
                      onClick={() =>
                        execute("Toggle track mute", (p) => {
                          p.tracks[index].muted = !track.muted;
                        })
                      }
                    >
                      {track.muted ? (
                        <VolumeX size={12} />
                      ) : (
                        <Volume2 size={12} />
                      )}
                    </IconButton>
                    <button
                      className="solo"
                      aria-label={`Solo ${track.name}`}
                      aria-pressed={track.solo}
                      onClick={() =>
                        execute("Toggle solo", (p) => {
                          p.tracks[index].solo = !track.solo;
                        })
                      }
                    >
                      S
                    </button>
                  </div>
                </div>
              </div>
              <div
                className="track-lane"
                data-track-id={track.id}
                style={{ width, backgroundSize: `${zoom * interval}px 100%` }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("application/x-supp-asset");
                  if (id) {
                    execute(
                      "Insert media",
                      insertAsset(id, track.id, frameAt(e.clientX)),
                    );
                    const added = useEditor.getState().project.clips.at(-1);
                    if (added?.assetId === id) select(added.id);
                  }
                }}
                onDoubleClick={(e) => {
                  if (e.target === e.currentTarget)
                    clock.seek(frameAt(e.clientX));
                }}
              >
                {project.clips
                  .filter(
                    (c) =>
                      c.trackId === track.id &&
                      (c.start + c.duration) * px > viewport.left - 200 &&
                      c.start * px < viewport.left + viewport.width + 200,
                  )
                  .map((c) => {
                    const position = drag?.id === c.id ? drag : c;
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`Clip ${c.name}`}
                        key={c.id}
                        className={`timeline-clip ${c.kind} ${track.kind} ${selected === c.id ? "selected" : ""}`}
                        style={{
                          left: position.start * px,
                          width: Math.max(6, position.duration * px),
                          opacity: track.hidden ? 0.35 : 1,
                        }}
                        onPointerDown={(e) => pointer(e, c, "move")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") select(c.id);
                        }}
                        onDoubleClick={() => {
                          if (c.assetId)
                            useEditor.getState().setSource(c.assetId);
                        }}
                      >
                        {c.assetId && thumbnails.has(c.assetId) && (
                          <div
                            className="clip-filmstrip"
                            style={{
                              backgroundImage: `url("${thumbnails.get(c.assetId)}")`,
                            }}
                          />
                        )}
                        <span className="clip-title">
                          {c.kind === "text" ? (
                            <Type size={11} />
                          ) : c.kind === "shape" ? (
                            <Square size={11} />
                          ) : null}
                          {c.name}
                        </span>
                        {c.assetId && waveforms.has(c.assetId) && (
                          <svg
                            className="waveform"
                            viewBox="0 0 400 28"
                            preserveAspectRatio="none"
                          >
                            {waveforms.get(c.assetId)!.map((v, i) => (
                              <line
                                key={i}
                                x1={i}
                                x2={i}
                                y1={14 - v * 12}
                                y2={14 + v * 12}
                              />
                            ))}
                          </svg>
                        )}
                        <span
                          className="clip-trim in"
                          aria-label="Trim start"
                          onPointerDown={(e) => pointer(e, c, "in")}
                        />
                        <span
                          className="clip-trim out"
                          aria-label="Trim end"
                          onPointerDown={(e) => pointer(e, c, "out")}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          <div className="playhead" ref={playhead}>
            <span />
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>
          {project.clips.length} clips · {project.markers.length} markers
        </span>
        <span>S split · Delete remove · J K L shuttle · ← → frame step</span>
        <span>{rate.toFixed(2).replace(".00", "")} fps / non-drop</span>
      </div>
    </section>
  );
}
