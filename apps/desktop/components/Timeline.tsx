import { useEffect, useRef, useState, useMemo } from "react";
import { produce } from "immer";
import { projectIndex } from "../../../packages/engine/project-index";
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
import { useEditor, editorProject } from "../../../packages/editor-state";
import { SequencePicker } from "./SequencePicker";
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
  rippleTrim,
  rollEdit,
  slipEdit,
  slideEdit,
  type Edit,
} from "../../../packages/commands";
import {
  thumbnails,
  waveforms,
  useDerivedRevision,
} from "../../../packages/platform";
import { IconButton } from "./Controls";
import { moveEvent } from "../../../packages/commands/reference-events";
export function Timeline() {
  useDerivedRevision();
  const project = useEditor(editorProject),
    selected = useEditor((s) => s.selected),
    execute = useEditor((s) => s.executeScoped),
    executeProject = useEditor((s) => s.execute),
    activeComposition = useEditor((s) => s.activeComposition),
    referenceEvents = useEditor((s) => s.project.compositions.find((c) => c.id === s.activeComposition)?.ai?.referenceEvents),
    audioEventFrames = useEditor((s) => s.project.compositions.find((c) => c.id === s.activeComposition)?.ai?.audioEventFrames),
    [markerDrag, setMarkerDrag] = useState<{ id: string; x: number; frames: number; moved: boolean } | null>(null),
    dragEnded = useRef(false),
    select = useEditor((s) => s.select);
  const [zoom, setZoom] = useState(45),
    [snap, setSnap] = useState(true),
    [ripple, setRipple] = useState(false),
    [tool, setTool] = useState<"move" | "ripple" | "roll" | "slip" | "slide">(
      "move",
    ),
    [viewport, setViewport] = useState({ left: 0, width: 1000 }),
    [drag, setDrag] = useState<{
      id: string;
      start: number;
      duration: number;
      neighbors?: Map<string, Clip>;
      shift?: number;
      boundary?: number;
      trackId?: string;
    } | null>(null);
  const scroller = useRef<HTMLDivElement>(null),
    playhead = useRef<HTMLDivElement>(null),
    rate = fps(project),
    px = zoom / rate,
    total = Math.max(duration(project) + rate * 10, rate * 30),
    width = Math.max(800, total * px),
    interval = zoom >= 80 ? 1 : zoom >= 30 ? 5 : 10;
  const clipIndex = projectIndex(project);
  const snapPoints = useMemo(
    () =>
      [
        { frame: 0, owner: "" },
        ...project.markers.map((m) => ({ frame: m.frame, owner: "" })),
        ...project.clips.flatMap((c) => [
          { frame: c.start, owner: c.id },
          { frame: c.start + c.duration, owner: c.id },
        ]),
      ].sort((a, b) => a.frame - b.frame),
    [project.clips, project.markers],
  );
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
    let lo = 0,
      hi = snapPoints.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (snapPoints[mid].frame < frame - 8 / px) lo = mid + 1;
      else hi = mid;
    }
    const points = [clock.get().frame];
    for (
      let i = lo;
      i < snapPoints.length && snapPoints[i].frame <= frame + 8 / px;
      i++
    )
      if (snapPoints[i].owner !== id) points.push(snapPoints[i].frame);
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
    let operation: Edit | undefined;
    const specialized =
      tool === "slip" || tool === "slide"
        ? edge === "move"
        : (tool === "ripple" || tool === "roll") && edge !== "move";
    // Preview only the local edit neighborhood. Full-track ripple commits once on release.
    const local = {
      ...project,
      clips: clipIndex.tracks
        .get(c.trackId)!
        .range(c.start - 1, c.start + c.duration + 1),
    };
    const update = (event: PointerEvent) => {
      didMove = true;
      const delta = Math.round((event.clientX - origin) / px);
      if (specialized) {
        operation =
          tool === "slip"
            ? slipEdit(c.id, delta)
            : tool === "slide"
              ? slideEdit(c.id, delta)
              : tool === "roll"
                ? rollEdit(
                    c.id,
                    edge as "in" | "out",
                    snapped(
                      (edge === "in" ? c.start : c.start + c.duration) + delta,
                      c.id,
                    ),
                  )
                : rippleTrim(
                    c.id,
                    edge as "in" | "out",
                    snapped(
                      (edge === "in" ? c.start : c.start + c.duration) + delta,
                      c.id,
                    ),
                  );
        try {
          const preview = produce(local, operation),
            edited = preview.clips.find((x) => x.id === c.id)!;
          setDrag({
            id: c.id,
            start: edited.start,
            duration: edited.duration,
            neighbors: new Map(preview.clips.map((x) => [x.id, x])),
            shift: tool === "ripple" ? edited.duration - c.duration : 0,
            boundary: c.start + c.duration,
            trackId: c.trackId,
          });
        } catch {
          setDrag(null);
        }
        return;
      }
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
      target.removeEventListener("pointercancel", cancel as EventListener);
      setDrag(null);
      if (!didMove) return;
      if (specialized && operation) {
        execute(`${tool[0].toUpperCase() + tool.slice(1)} edit`, operation);
        return;
      }
      const under = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;
      if (edge === "move") execute("Move clip", moveClip(c.id, start, under));
      else
        execute("Trim clip", trimClip(c.id, edge, edge === "in" ? start : end));
    };
    const cancel = () => {
      target.removeEventListener("pointermove", update as EventListener);
      target.removeEventListener("pointerup", done as EventListener);
      target.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    target.addEventListener("pointermove", update as EventListener);
    target.addEventListener("pointerup", done as EventListener, { once: true });
    target.addEventListener("pointercancel", cancel, { once: true });
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
        <span className="timeline-hint">
          {tool === "move"
            ? "Drag to move · edges to trim"
            : tool === "ripple" || tool === "roll"
              ? `${tool} · drag an edge`
              : `${tool} · drag the clip`}
        </span>
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
        <SequencePicker />
        <span className="active-tool">
          <MousePointer2 size={15} />
        </span>
        <select
          aria-label="Timeline edit tool"
          value={tool}
          onChange={(e) => setTool(e.target.value as typeof tool)}
        >
          <option value="move">Selection / trim</option>
          <option value="ripple">Ripple trim</option>
          <option value="roll">Roll</option>
          <option value="slip">Slip</option>
          <option value="slide">Slide</option>
        </select>
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
                {
                  length: Math.max(
                    0,
                    Math.ceil(
                      (viewport.width + zoom * interval * 2) /
                        (zoom * interval),
                    ),
                  ),
                },
                (_, i) =>
                  (Math.max(
                    0,
                    Math.floor(viewport.left / (zoom * interval)) - 1,
                  ) +
                    i) *
                  interval,
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
              {project.markers.map((m) => {
                const event = referenceEvents?.find((e) => e.markerId === m.id);
                return (
                <button
                  className={event ? "marker audio-event" : "marker"}
                  key={m.id}
                  style={{ left: (m.frame + (markerDrag?.id === m.id ? markerDrag.frames : 0)) * px }}
                  aria-label={event ? `Audio event ${m.name}` : undefined}
                  title={
                    event
                      ? `${m.name} · drives ${event.links.length} layer${event.links.length === 1 ? "" : "s"} · drag or ← → to move with linked layers (snaps to detected audio events), Alt to move the marker alone, Shift+← → moves 10 frames · double-click to delete`
                      : `${m.name} · double-click to delete`
                  }
                  onPointerMove={(e) => {
                    if (!markerDrag || markerDrag.id !== m.id) return;
                    const frames = Math.round((e.clientX - markerDrag.x) / px);
                    if (frames !== markerDrag.frames) setMarkerDrag({ ...markerDrag, frames, moved: true });
                  }}
                  onPointerUp={(e) => {
                    if (!markerDrag || markerDrag.id !== m.id) return;
                    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                    const drag = markerDrag;
                    setMarkerDrag(null);
                    if (!drag.moved || !event || !activeComposition) return;
                    dragEnded.current = true;
                    // Snap to the nearest detected audio event within about 8 px of the drop point.
                    let to = m.frame + drag.frames;
                    const near = (audioEventFrames ?? []).reduce<number | undefined>((best, f) => (Math.abs(f - to) <= 8 / px && (best === undefined || Math.abs(f - to) < Math.abs(best - to)) ? f : best), undefined);
                    if (near !== undefined) to = near;
                    if (to === m.frame) return;
                    executeProject(
                      e.altKey ? "Move audio event marker" : "Move audio event with linked layers",
                      moveEvent({ tool: "sequence.moveEvent", sequenceId: activeComposition, markerId: m.id, frames: to - m.frame, linked: !e.altKey }),
                    );
                  }}
                  onKeyDown={(e) => {
                    if (!event || !activeComposition || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                    e.preventDefault();
                    e.stopPropagation();
                    executeProject(
                      e.altKey ? "Move audio event marker" : "Move audio event with linked layers",
                      moveEvent({
                        tool: "sequence.moveEvent",
                        sequenceId: activeComposition,
                        markerId: m.id,
                        frames: (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1),
                        linked: !e.altKey,
                      }),
                    );
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!event || e.button !== 0) return;
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                    setMarkerDrag({ id: m.id, x: e.clientX, frames: 0, moved: false });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragEnded.current) {
                      dragEnded.current = false;
                      return;
                    }
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
                );
              })}
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
                    const added = editorProject(useEditor.getState()).clips.at(-1);
                    if (added?.assetId === id) select(added.id);
                  }
                }}
                onDoubleClick={(e) => {
                  if (e.target === e.currentTarget)
                    clock.seek(frameAt(e.clientX));
                }}
              >
                {(
                  clipIndex.tracks
                    .get(track.id)
                    ?.range(
                      (viewport.left - 200) / px,
                      (viewport.left + viewport.width + 200) / px,
                    ) ?? []
                ).map((c) => {
                  const position =
                    drag?.id === c.id
                      ? drag
                      : (drag?.neighbors?.get(c.id) ??
                        (drag?.shift &&
                        c.trackId === drag.trackId &&
                        c.start >= (drag.boundary ?? Infinity)
                          ? { ...c, start: c.start + drag.shift }
                          : c));
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
                          viewBox={`${project.assets.find((a) => a.id === c.assetId)?.kind === "image" ? 0 : (c.sourceIn / (rate * (project.assets.find((a) => a.id === c.assetId)?.duration || 1))) * 400} 0 ${(c.duration / (rate * (project.assets.find((a) => a.id === c.assetId)?.duration || 1))) * 400} 28`}
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
