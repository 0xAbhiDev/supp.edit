import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { produce } from "immer";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Film,
  GitBranch,
  Layers,
  Lock,
  Magnet,
  Minus,
  Plus,
  Scissors,
  Square,
  Trash2,
  Type,
  Unlock,
} from "lucide-react";
import { editorProject, useEditor } from "../../../packages/editor-state";
import { clock, useClock } from "../../../packages/engine/clock";
import { properties, propertyNames } from "../../../packages/animation";
import {
  deleteClip,
  duplicateClip,
  moveClip,
  splitClip,
  trimClip,
  type Edit,
} from "../../../packages/commands";
import {
  duration,
  fps,
  newTrack,
  timecode,
  type Clip,
  type Project,
  type Track,
} from "../../../packages/project-schema";
import { IconButton } from "./Controls";
import "./layer-timeline.css";

type Edge = "move" | "in" | "out";
type Row = { clip: Clip; track: Track };
type KeySummary = { frame: number; labels: string[] };
type Gesture = {
  pointer: number;
  root: Project;
  scope: string | null;
  origin: number;
  scroll: number;
  clip: Clip;
  edge: Edge;
  project: Project;
  operation?: Edit;
  moved: boolean;
};

// Within a track the renderer paints later clips on top of earlier clips.
function visualRows(project: Project): Row[] {
  const clips = new Map<string, Clip[]>();
  for (const clip of project.clips) {
    if (!clips.has(clip.trackId)) clips.set(clip.trackId, []);
    clips.get(clip.trackId)!.push(clip);
  }
  return project.tracks
    .filter((t) => t.kind === "video")
    .flatMap((track) =>
      (clips.get(track.id) ?? [])
        .slice()
        .reverse()
        .map((clip) => ({ clip, track })),
    );
}

function summary(clip: Clip): KeySummary[] {
  const frames = new Map<number, string[]>();
  for (const property of propertyNames)
    for (const key of clip.keyframes[property]) {
      if (key.frame < 0 || key.frame >= clip.duration) continue;
      if (!frames.has(key.frame)) frames.set(key.frame, []);
      frames
        .get(key.frame)!
        .push(`${properties[property].label}: ${Number(key.value.toFixed(3))}`);
    }
  return [...frames]
    .sort(([a], [b]) => a - b)
    .map(([frame, labels]) => ({ frame, labels }));
}

function visibleKeys(keys: KeySummary[], from: number, to: number) {
  let low = 0,
    high = keys.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (keys[mid].frame < from) low = mid + 1;
    else high = mid;
  }
  const result: KeySummary[] = [];
  for (let i = low; i < keys.length && keys[i].frame <= to; i++)
    result.push(keys[i]);
  return result;
}

// Lift only this clip out of a shared track. Never move a track containing
// other clips, or change the relative stacking of any unrelated clips.
function reorderLayer(id: string, direction: -1 | 1): Edit {
  return (p) => {
    const clip = p.clips.find((c) => c.id === id);
    const track = p.tracks.find((t) => t.id === clip?.trackId);
    if (!clip || !track || track.locked || track.kind !== "video") return;
    const index = p.tracks.indexOf(track);
    if (p.clips.filter((c) => c.trackId === track.id).length > 1) {
      const next = {
        ...track,
        id: newTrack("video", 1).id,
        name: clip.name.slice(0, 256),
      };
      p.tracks.splice(index + (direction > 0 ? 1 : 0), 0, next);
      clip.trackId = next.id;
      return;
    }
    const occupied = p.tracks.filter(
      (t) => t.kind === "video" && p.clips.some((c) => c.trackId === t.id),
    );
    const neighbor = occupied[occupied.indexOf(track) + direction];
    if (!neighbor) return;
    p.tracks.splice(index, 1);
    p.tracks.splice(
      p.tracks.indexOf(neighbor) + (direction > 0 ? 1 : 0),
      0,
      track,
    );
  };
}

export function LayerTimeline({ onGraph }: { onGraph: () => void }) {
  const projectId = useEditor((s) => s.project.id);
  const scope = useEditor((s) => s.activeComposition);
  return (
    <LayerTimelineScope
      key={`${projectId}/${scope ?? "sequence"}`}
      onGraph={onGraph}
    />
  );
}

function LayerTimelineScope({ onGraph }: { onGraph: () => void }) {
  const project = useEditor(editorProject);
  const selected = useEditor((s) => s.selected);
  const scope = useEditor((s) => s.activeComposition);
  const execute = useEditor((s) => s.executeScoped);
  const [zoom, setZoom] = useState(60);
  const [snap, setSnap] = useState(true);
  const [viewport, setViewport] = useState({
    left: 0,
    top: 0,
    height: 300,
    width: 1000,
    details: 620,
  });
  const [preview, setPreview] = useState<Clip | null>(null);
  const [keySelection, setKeySelection] = useState<{
    id: string;
    frame: number;
  } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const seeking = useRef<number | null>(null);
  const zoomAnchor = useRef<number | null>(null);
  const rows = useMemo(
    () => visualRows(project),
    [project.clips, project.tracks],
  );
  const firstRow = Math.max(0, Math.floor((viewport.top - 29) / 46) - 4),
    lastRow = Math.min(
      rows.length,
      Math.ceil((viewport.top + viewport.height) / 46) + 4,
    );
  const keyframes = useMemo(
    () => new Map(project.clips.map((c) => [c.id, summary(c)])),
    [project.clips],
  );
  const names = useMemo(
    () => new Map(project.clips.map((c) => [c.id, c.name])),
    [project.clips],
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const c of project.clips)
      result.set(c.trackId, (result.get(c.trackId) ?? 0) + 1);
    return result;
  }, [project.clips]);
  const rate = fps(project),
    px = zoom / rate;
  const composition = project.compositions.find((c) => c.id === scope);
  const end = Math.max(duration(project), composition?.duration ?? 0);
  const visibleWidth = Math.max(100, viewport.width - viewport.details);
  const total = Math.max(
    end + rate * 5,
    rate * 30,
    preview ? preview.start + preview.duration + rate * 5 : 0,
  );
  const width = Math.max(visibleWidth, total * px);
  const from = Math.max(0, (viewport.left - 80) / px);
  const to = (viewport.left + visibleWidth + 80) / px;
  const interval = Math.max(1, Math.ceil(80 / px));
  const tickStep =
    [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(
      (v) => v >= interval,
    ) ?? interval;
  const ticks = Array.from(
    { length: Math.ceil((to - from) / tickStep) + 1 },
    (_, i) => (Math.ceil(from / tickStep) + i) * tickStep,
  ).filter((f) => f * px <= width);
  const selectedRow = rows.find((r) => r.clip.id === selected);
  const selectedClip = selectedRow?.clip;
  const locked = !selectedRow || selectedRow.track.locked;
  const points = useMemo(
    () => [
      0,
      ...project.markers.map((m) => m.frame),
      ...rows.flatMap(({ clip }) => [
        { id: clip.id, frame: clip.start },
        { id: clip.id, frame: clip.start + clip.duration },
      ]),
    ],
    [project.markers, rows],
  );

  function release() {
    const pointer = gesture.current?.pointer ?? seeking.current;
    gesture.current = null;
    seeking.current = null;
    if (
      pointer !== null &&
      pointer !== undefined &&
      scroller.current?.hasPointerCapture(pointer)
    )
      scroller.current.releasePointerCapture(pointer);
  }
  function cancel() {
    release();
    setPreview(null);
  }
  useEffect(() => {
    const element = scroller.current!,
      label = details.current!;
    const measure = () =>
      setViewport({
        left: element.scrollLeft,
        top: element.scrollTop,
        height: element.clientHeight,
        width: element.clientWidth,
        details: label.offsetWidth,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(label);
    const unsubscribe = useEditor.subscribe((state) => {
      const current = gesture.current;
      if (
        current &&
        (state.project !== current.root ||
          state.activeComposition !== current.scope)
      )
        cancel();
    });
    const blur = () => cancel();
    window.addEventListener("blur", blur);
    return () => {
      observer.disconnect();
      unsubscribe();
      window.removeEventListener("blur", blur);
      // Capture belongs to the scroller, which stays mounted even if a bar is culled.
      const pointer = gesture.current?.pointer ?? seeking.current;
      gesture.current = null;
      seeking.current = null;
      if (
        pointer !== null &&
        pointer !== undefined &&
        element.hasPointerCapture(pointer)
      )
        element.releasePointerCapture(pointer);
    };
  }, []);
  useEffect(() => {
    if (zoomAnchor.current !== null && scroller.current) {
      scroller.current.scrollLeft = Math.max(
        0,
        zoomAnchor.current * px - visibleWidth / 2,
      );
      zoomAnchor.current = null;
    }
  }, [px, visibleWidth]);

  function changeZoom(value: number) {
    cancel();
    zoomAnchor.current = (viewport.left + visibleWidth / 2) / px;
    setZoom(Math.max(2, Math.min(600, value)));
  }
  function reveal(frame: number) {
    const element = scroller.current;
    if (
      element &&
      (frame * px < element.scrollLeft ||
        frame * px > element.scrollLeft + visibleWidth - 20)
    )
      element.scrollLeft = Math.max(0, frame * px - visibleWidth / 3);
  }
  function seek(frame: number) {
    clock.pause();
    clock.seek(frame);
  }
  function frameAt(clientX: number) {
    const element = scroller.current!;
    return Math.max(
      0,
      Math.round(
        (clientX -
          element.getBoundingClientRect().left -
          details.current!.offsetWidth +
          element.scrollLeft) /
          px,
      ),
    );
  }
  function startSeek(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    cancel();
    seeking.current = e.pointerId;
    scroller.current!.setPointerCapture(e.pointerId);
    seek(frameAt(e.clientX));
  }
  function begin(e: PointerEvent, clip: Clip, edge: Edge) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    cancel();
    useEditor.getState().select(clip.id);
    setKeySelection(null);
    scroller.current!.focus({ preventScroll: true });
    const state = useEditor.getState(),
      current = editorProject(state);
    const original = current.clips.find((c) => c.id === clip.id);
    if (
      !original ||
      current.tracks.find((t) => t.id === original.trackId)?.locked
    )
      return;
    clock.pause();
    gesture.current = {
      pointer: e.pointerId,
      root: state.project,
      scope: state.activeComposition,
      origin: e.clientX,
      scroll: scroller.current!.scrollLeft,
      clip: original,
      edge,
      project: current,
      moved: false,
    };
    scroller.current!.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (seeking.current === e.pointerId) {
      seek(frameAt(e.clientX));
      return;
    }
    const drag = gesture.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    const deltaPixels =
      e.clientX - drag.origin + scroller.current!.scrollLeft - drag.scroll;
    if (!drag.moved && Math.abs(deltaPixels) < 3) return;
    drag.moved = true;
    const clip = drag.clip,
      edge = drag.edge;
    let target = Math.round(
      (edge === "out" ? clip.start + clip.duration : clip.start) +
        deltaPixels / px,
    );
    if (snap && !e.altKey) {
      let correction = 8 / px;
      const candidates = [
        clock.get().frame,
        ...points
          .filter((p) => typeof p === "number" || p.id !== clip.id)
          .map((p) => (typeof p === "number" ? p : p.frame)),
      ];
      for (const point of candidates)
        for (const position of edge === "move"
          ? [target, target + clip.duration]
          : [target])
          if (Math.abs(point - position) < Math.abs(correction))
            correction = point - position;
      if (Math.abs(correction) < 8 / px) target += correction;
    }
    target = Math.max(0, Math.round(target));
    const operation =
      edge === "move"
        ? moveClip(clip.id, target)
        : trimClip(clip.id, edge, target);
    try {
      // The same ordinary command supplies both the preview and the history entry.
      const next = produce(drag.project, operation).clips.find(
        (c) => c.id === clip.id,
      )!;
      drag.operation = operation;
      setPreview(next);
    } catch (error) {
      cancel();
      useEditor.getState().report(error);
    }
  }
  function finish(e: PointerEvent) {
    if (seeking.current === e.pointerId) {
      cancel();
      return;
    }
    const drag = gesture.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    const state = useEditor.getState();
    cancel();
    if (
      drag.operation &&
      state.project === drag.root &&
      state.activeComposition === drag.scope
    )
      state.executeScoped(
        drag.edge === "move" ? "Move layer" : "Trim layer",
        drag.operation,
      );
  }
  function runSelected(kind: "duplicate" | "delete") {
    if (!selectedClip || locked) return;
    const before = editorProject(useEditor.getState());
    execute(
      kind === "duplicate" ? "Duplicate layer" : "Delete layer",
      kind === "duplicate"
        ? duplicateClip(selectedClip.id)
        : deleteClip(selectedClip.id),
    );
    const after = editorProject(useEditor.getState());
    if (after === before) return;
    if (kind === "duplicate") {
      const ids = new Set(before.clips.map((c) => c.id));
      useEditor
        .getState()
        .select(after.clips.find((c) => !ids.has(c.id))?.id ?? selectedClip.id);
    } else {
      const index = rows.findIndex((r) => r.clip.id === selectedClip.id);
      const remaining = visualRows(after);
      useEditor
        .getState()
        .select(
          remaining[Math.min(index, remaining.length - 1)]?.clip.id ?? null,
        );
    }
  }
  function toggleTrack(id: string, property: "hidden" | "locked") {
    execute(
      property === "locked" ? "Toggle track lock" : "Toggle track visibility",
      (p) => {
        const track = p.tracks.find((t) => t.id === id);
        if (track && (property === "locked" || !track.locked))
          track[property] = !track[property];
      },
    );
  }
  const shared = !!selectedRow && (counts.get(selectedRow.track.id) ?? 0) > 1;
  const occupied = project.tracks.filter(
    (t) => t.kind === "video" && counts.has(t.id),
  );
  const trackIndex = selectedRow
    ? occupied.findIndex((t) => t.id === selectedRow.track.id)
    : -1;
  return (
    <section className="layer-timeline panel" aria-label="Layer timeline">
      <div className="layer-toolbar">
        <Layers size={15} />
        <strong className="layer-scope" title={project.name}>
          {scope ? project.name : "Main sequence"}
        </strong>
        <LayerTime
          clip={selectedClip}
          locked={locked}
          onSeek={(frame) => {
            seek(frame);
            reveal(frame);
          }}
        />
        <IconButton
          label="Duplicate layer"
          disabled={locked}
          onClick={() => runSelected("duplicate")}
        >
          <Copy size={14} />
        </IconButton>
        <IconButton
          label="Delete layer"
          disabled={locked}
          onClick={() => runSelected("delete")}
        >
          <Trash2 size={14} />
        </IconButton>
        <IconButton
          label={
            shared
              ? `Move layer above track ${selectedRow!.track.name}`
              : "Raise layer"
          }
          disabled={locked || (!shared && trackIndex <= 0)}
          onClick={() => execute("Raise layer", reorderLayer(selected!, -1))}
        >
          <ArrowUp size={14} />
        </IconButton>
        <IconButton
          label={
            shared
              ? `Move layer below track ${selectedRow!.track.name}`
              : "Lower layer"
          }
          disabled={locked || (!shared && trackIndex >= occupied.length - 1)}
          onClick={() => execute("Lower layer", reorderLayer(selected!, 1))}
        >
          <ArrowDown size={14} />
        </IconButton>
        <button
          className="layer-graph-button"
          disabled={!selectedClip}
          onClick={onGraph}
        >
          <GitBranch size={13} />
          Edit graph
        </button>
        <span className="grow" />
        <IconButton
          label="Snap layer edits"
          aria-pressed={snap}
          onClick={() => setSnap(!snap)}
        >
          <Magnet size={14} />
        </IconButton>
        <IconButton
          label="Zoom layers out"
          disabled={zoom <= 2}
          onClick={() => changeZoom(zoom / 1.4)}
        >
          <Minus size={14} />
        </IconButton>
        <input
          type="range"
          aria-label="Layer timeline zoom"
          min={2}
          max={600}
          value={zoom}
          onChange={(e) => changeZoom(Number(e.target.value))}
        />
        <IconButton
          label="Zoom layers in"
          disabled={zoom >= 600}
          onClick={() => changeZoom(zoom * 1.4)}
        >
          <Plus size={14} />
        </IconButton>
        <button
          onClick={() => {
            cancel();
            zoomAnchor.current = null;
            setZoom(
              Math.max(
                2,
                Math.min(600, visibleWidth / Math.max(1, (end + rate) / rate)),
              ),
            );
            if (scroller.current) scroller.current.scrollLeft = 0;
          }}
        >
          Fit
        </button>
        <button onClick={() => reveal(clock.get().frame)}>Playhead</button>
      </div>
      <div
        className="layer-scroll"
        ref={scroller}
        tabIndex={0}
        aria-label="Layer timing and selection"
        onScroll={(e) => {
          const {
            scrollLeft: left,
            scrollTop: top,
            clientHeight: height,
            clientWidth: width,
          } = e.currentTarget;
          setViewport((v) => ({ ...v, left, top, height, width }));
        }}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (gesture.current || seeking.current !== null) cancel();
        }}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).matches("input, select, textarea"))
            return;
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
            e.preventDefault();
            e.stopPropagation();
            runSelected("duplicate");
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            const index = rows.findIndex((r) => r.clip.id === selected);
            const next =
              rows[
                Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    index + (e.key === "ArrowUp" ? -1 : 1),
                  ),
                )
              ];
            if (next) {
              useEditor.getState().select(next.clip.id);
              const row = scroller.current?.querySelector<HTMLElement>(
                `[data-layer-row="${CSS.escape(next.clip.id)}"]`,
              );
              if (row)
                row.scrollIntoView({ block: "nearest", inline: "nearest" });
              else if (scroller.current)
                scroller.current.scrollTop = rows.indexOf(next) * 46;
              reveal(next.clip.start);
            }
          }
        }}
      >
        <div
          className="layer-content"
          style={{ width: viewport.details + width }}
        >
          <div className="layer-ruler">
            <div className="layer-details layer-column-headings" ref={details}>
              <span>#</span>
              <span title="Visibility and lock affect every clip on the track">
                Track
              </span>
              <span>Layer</span>
              <span>Parent</span>
              <span title="First frame">In</span>
              <span title="Exclusive end frame">Out</span>
              <span title="Source offset in frames">Source</span>
            </div>
            <div
              className="layer-ruler-time"
              style={{ width }}
              onPointerDown={startSeek}
            >
              {ticks.map((frame) => (
                <span key={frame} style={{ left: frame * px }}>
                  {timecode(frame, rate)}
                </span>
              ))}
            </div>
          </div>
          <div aria-hidden="true" style={{ height: firstRow * 46 }} />
          {rows.slice(firstRow, lastRow).map(({ clip, track }, offset) => {
            const index = firstRow + offset;
            const shown = preview?.id === clip.id ? preview : clip;
            const parentId = clip.parentId;
            const parent = parentId
              ? (names.get(parentId) ?? "Missing parent")
              : "None";
            const count = counts.get(track.id) ?? 1;
            const type =
              clip.kind === "media"
                ? (project.assets.find((a) => a.id === clip.assetId)?.kind ??
                  "media")
                : clip.kind;
            const keys =
              preview?.id === clip.id
                ? summary(preview)
                : keyframes.get(clip.id)!;
            const barStart = Math.max(shown.start, from),
              barEnd = Math.min(shown.start + shown.duration, to);
            const isSelected = selected === clip.id;
            const suppressed =
              track.hidden ||
              (project.tracks.some((t) => t.kind === "video" && t.solo) &&
                !track.solo);
            const trackTitle = `${track.name} · ${count} ${count === 1 ? "layer" : "layers"}${track.solo ? " · Solo" : ""}`;
            return (
              <div
                key={clip.id}
                data-layer-row={clip.id}
                className={`layer-row ${isSelected ? "selected" : ""} ${track.locked ? "locked" : ""} ${suppressed ? "layer-hidden" : ""}`}
              >
                <div className="layer-details">
                  <span className="layer-index">{index + 1}</span>
                  <div className="layer-track-controls" title={trackTitle}>
                    <IconButton
                      label={`${track.hidden ? "Show" : "Hide"} track ${track.name} (${count} layers)`}
                      aria-pressed={!track.hidden}
                      disabled={track.locked}
                      onClick={() => toggleTrack(track.id, "hidden")}
                    >
                      {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </IconButton>
                    <IconButton
                      label={`${track.locked ? "Unlock" : "Lock"} track ${track.name} (${count} layers)`}
                      aria-pressed={track.locked}
                      onClick={() => toggleTrack(track.id, "locked")}
                    >
                      {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </IconButton>
                  </div>
                  <button
                    className="layer-name"
                    aria-label={`Select layer ${clip.name}`}
                    aria-pressed={isSelected}
                    title={`${clip.name} · ${type}\n${trackTitle}\nDouble-click to open graph`}
                    onClick={() => {
                      useEditor.getState().select(clip.id);
                      reveal(clip.start);
                    }}
                    onDoubleClick={onGraph}
                  >
                    {type === "text" ? (
                      <Type size={13} />
                    ) : type === "composition" ? (
                      <Layers size={13} />
                    ) : type === "null" ? (
                      <span className="layer-null-icon">◇</span>
                    ) : type === "shape" ? (
                      <Square size={13} />
                    ) : (
                      <Film size={13} />
                    )}
                    <span>
                      <strong>{clip.name}</strong>
                      <small>
                        {type} · {track.name}
                        {track.solo ? " · Solo" : ""}
                      </small>
                    </span>
                  </button>
                  <button
                    className="layer-parent"
                    disabled={!parentId || !names.has(parentId)}
                    title={`Parent: ${parent}`}
                    onClick={() => {
                      if (parentId) {
                        useEditor.getState().select(parentId);
                        const parentClip = project.clips.find(
                          (c) => c.id === parentId,
                        );
                        if (parentClip) reveal(parentClip.start);
                      }
                    }}
                  >
                    {parent}
                  </button>
                  <FrameField
                    label={`In frame for ${clip.name}`}
                    value={shown.start}
                    disabled={track.locked}
                    onCommit={(frame) =>
                      execute("Trim layer in", trimClip(clip.id, "in", frame))
                    }
                  />
                  <FrameField
                    label={`Out frame for ${clip.name}`}
                    value={shown.start + shown.duration}
                    disabled={track.locked}
                    onCommit={(frame) =>
                      execute("Trim layer out", trimClip(clip.id, "out", frame))
                    }
                  />
                  <span
                    className="layer-source"
                    title={`Source offset: ${shown.sourceIn} frames · ${timecode(shown.sourceIn, rate)}`}
                  >
                    {shown.sourceIn}
                  </span>
                </div>
                <div
                  className="layer-lane"
                  style={{ width, backgroundSize: `${tickStep * px}px 100%` }}
                  onPointerDown={startSeek}
                >
                  {barEnd > barStart && (
                    <div
                      className={`layer-bar ${clip.kind}`}
                      style={{
                        left: barStart * px,
                        width: Math.max(2, (barEnd - barStart) * px),
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Move layer ${clip.name}`}
                      aria-disabled={track.locked}
                      title={`${clip.name} · ${shown.start}–${shown.start + shown.duration}f · ${shown.duration} frames${track.locked ? " · Track locked" : " · Drag to move"}`}
                      onPointerDown={(e) => begin(e, clip, "move")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          useEditor.getState().select(clip.id);
                        }
                      }}
                      onDoubleClick={() => {
                        useEditor.getState().select(clip.id);
                        onGraph();
                      }}
                    >
                      <span className="layer-bar-label">{clip.name}</span>
                      {shown.start >= from && (
                        <span
                          role="button"
                          tabIndex={-1}
                          className="layer-trim in"
                          aria-label={`Trim in ${clip.name}`}
                          onPointerDown={(e) => begin(e, clip, "in")}
                        />
                      )}
                      {shown.start + shown.duration <= to && (
                        <span
                          role="button"
                          tabIndex={-1}
                          className="layer-trim out"
                          aria-label={`Trim out ${clip.name}`}
                          onPointerDown={(e) => begin(e, clip, "out")}
                        />
                      )}
                    </div>
                  )}
                  {visibleKeys(keys, from - shown.start, to - shown.start).map(
                    (key) => (
                      <button
                        key={key.frame}
                        className={`layer-key ${isSelected && keySelection?.id === clip.id && keySelection.frame === key.frame ? "selected" : ""}`}
                        style={{ left: (shown.start + key.frame) * px }}
                        aria-label={`${clip.name} keyframe at ${shown.start + key.frame}: ${key.labels.join(", ")}`}
                        title={`Frame ${shown.start + key.frame} · layer frame ${key.frame}\n${key.labels.join("\n")}\nClick to select layer and seek · double-click for graph`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          useEditor.getState().select(clip.id);
                          setKeySelection({ id: clip.id, frame: key.frame });
                          seek(shown.start + key.frame);
                        }}
                        onDoubleClick={onGraph}
                      >
                        <span />
                      </button>
                    ),
                  )}
                </div>
              </div>
            );
          })}
          <div
            aria-hidden="true"
            style={{ height: Math.max(0, rows.length - lastRow) * 46 }}
          />
          {!rows.length && (
            <div
              className="layer-empty"
              style={{ left: viewport.left, width: viewport.width }}
            >
              <Layers size={22} />
              <strong>No visual layers yet</strong>
              <span>
                Add a layer from the composition panel to start arranging it
                here.
              </span>
            </div>
          )}
          <LayerPlayhead
            px={px}
            details={viewport.details}
            from={viewport.left / px}
            to={(viewport.left + visibleWidth) / px}
          />
        </div>
      </div>
      <div className="layer-footer">
        <span>
          {rows.length} visual {rows.length === 1 ? "layer" : "layers"} ·{" "}
          {rate.toFixed(2).replace(".00", "")} fps
        </span>
        <span>
          {selectedRow?.track.locked
            ? `Track ${selectedRow.track.name} is locked`
            : "Drag to move · edges to trim · Alt bypasses snap · In / Out / Source in frames"}
        </span>
        <span>S split · Delete remove · Ctrl D duplicate</span>
      </div>
    </section>
  );
}

function FrameField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  function commit() {
    const frame = Number(text);
    if (
      text.trim() &&
      Number.isFinite(frame) &&
      !disabled &&
      Math.round(frame) !== value
    )
      onCommit(Math.max(0, Math.round(frame)));
    setText(String(value));
  }
  return (
    <input
      className="layer-frame"
      type="number"
      step={1}
      min={0}
      aria-label={label}
      title={`${label}: ${value}`}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setText(String(value));
        }
      }}
    />
  );
}

function LayerTime({
  clip,
  locked,
  onSeek,
}: {
  clip?: Clip;
  locked: boolean;
  onSeek: (frame: number) => void;
}) {
  const { frame } = useClock();
  return (
    <>
      <label className="layer-time">
        Frame
        <input
          aria-label="Layer playhead"
          type="number"
          min={0}
          step={1}
          value={frame}
          onChange={(e) => {
            if (e.target.value && Number.isFinite(e.target.valueAsNumber))
              onSeek(e.target.valueAsNumber);
          }}
        />
      </label>
      <IconButton
        label="Split layer at playhead"
        disabled={
          locked ||
          !clip ||
          frame <= clip.start ||
          frame >= clip.start + clip.duration
        }
        onClick={() => {
          if (clip)
            useEditor
              .getState()
              .executeScoped(
                "Split layer",
                splitClip(clip.id, clock.get().frame),
              );
        }}
      >
        <Scissors size={14} />
      </IconButton>
    </>
  );
}

function LayerPlayhead({
  px,
  details,
  from,
  to,
}: {
  px: number;
  details: number;
  from: number;
  to: number;
}) {
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      if (!line.current) return;
      const frame = clock.get().frame;
      line.current.style.transform = `translateX(${details + frame * px}px)`;
      line.current.style.display =
        frame >= from && frame <= to ? "block" : "none";
    };
    update();
    return clock.subscribe(update);
  }, [px, details, from, to]);
  return (
    <div ref={line} className="layer-playhead" aria-hidden="true">
      <span />
    </div>
  );
}
