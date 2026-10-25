import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { produce } from "immer";
import { useEditor, editorProject } from "../../../packages/editor-state";
import { clock, useClock } from "../../../packages/engine/clock";
import {
  properties,
  propertyNames,
  baseValue,
  evaluate,
  speed,
  sortedKeys,
  segmentHandles,
} from "../../../packages/animation";
import {
  addKey,
  enableAnimation,
  removeKeys,
  moveKeys,
  copyKeys,
  pasteKeys,
  setInterpolation,
  setHandle,
  type KeyRef,
  type CopiedKey,
  type Edit,
} from "../../../packages/commands";
import {
  interpolationModes,
  fps,
  type AnimatedProperty,
  type Clip,
  type Keyframe,
} from "../../../packages/project-schema";

const W = 1000,
  H = 180,
  L = 62,
  R = 18,
  T = 18,
  B = 26;
const colors = ["#c3f96b", "#7fb3ff", "#ffa98c", "#db9cff", "#75ded2"];
const same = (a: KeyRef, b: KeyRef) =>
  a.property === b.property && a.frame === b.frame;
type View = { from: number; to: number; min: number; max: number };
type Drag =
  | { kind: "keys"; refs: KeyRef[]; frame: number; value: number }
  | { kind: "handle"; ref: KeyRef; side: "inHandle" | "outHandle" }
  | { kind: "pan"; x: number; y: number; view: View };

export function GraphEditor() {
  const project = useEditor(editorProject),
    selected = useEditor((s) => s.selected);
  const clip = project.clips.find((c) => c.id === selected);
  return (
    <section className="animation panel" aria-label="Animation editor">
      <div className="panel-heading">
        <strong>Animation</strong>
        <span className="muted">Curve editor</span>
        <select
          aria-label="Animated layer"
          value={clip?.id ?? ""}
          onChange={(e) => useEditor.getState().select(e.target.value)}
        >
          <option value="" disabled>
            Select a layer
          </option>
          {project.clips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="field-hint">
          Shift-click adds keys · drag keys/tangents · middle-drag pans
        </span>
      </div>
      {clip ? (
        <Curves key={clip.id} clip={clip} />
      ) : (
        <p className="animation-empty">
          Select a layer to animate its transform, crop and effects.
        </p>
      )}
    </section>
  );
}
function Curves({ clip }: { clip: Clip }) {
  const project = useEditor(editorProject),
    execute = useEditor((s) => s.executeScoped);
  const locked = !!project.tracks.find((t) => t.id === clip.trackId)?.locked;
  const [visible, setVisible] = useState<AnimatedProperty[]>(["x"]),
    [primary, setPrimary] = useState<AnimatedProperty>("x");
  const [selected, setSelected] = useState<KeyRef[]>([]),
    [clipboard, setClipboard] = useState<CopiedKey[]>([]);
  const [mode, setMode] = useState<"value" | "speed">("value"),
    [snap, setSnap] = useState(true);
  const [view, setView] = useState<View>({
    from: -3,
    to: Math.max(30, clip.duration),
    min: -100,
    max: 100,
  });
  const [preview, setPreview] = useState<Clip | null>(null),
    [message, setMessage] = useState("");
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null),
    pending = useRef<Edit | null>(null),
    movedRefs = useRef<KeyRef[]>([]);
  const shown = preview ?? clip,
    rate = fps(project);
  const selection = selected.filter((r) =>
    clip.keyframes[r.property].some((k) => k.frame === r.frame),
  );
  const selectedKey =
    selection.length === 1
      ? clip.keyframes[selection[0].property].find(
          (k) => k.frame === selection[0].frame,
        )
      : undefined;
  const x = (f: number) =>
    L + ((f - view.from) / (view.to - view.from)) * (W - L - R);
  const y = (v: number) =>
    H - B - ((v - view.min) / (view.max - view.min)) * (H - T - B);
  function coordinates(e: PointerEvent<SVGSVGElement>) {
    const rect = svg.current!.getBoundingClientRect();
    return {
      frame:
        view.from +
        ((((e.clientX - rect.left) / rect.width) * W - L) / (W - L - R)) *
          (view.to - view.from),
      value:
        view.min +
        ((H - B - ((e.clientY - rect.top) / rect.height) * H) / (H - T - B)) *
          (view.max - view.min),
    };
  }
  const paths = useMemo(() => {
    const started = performance.now();
    const result = visible.map((property) => {
      const keys = shown.keyframes[property],
        base = baseValue(shown, property);
      const points = Array.from({ length: 241 }, (_, i) => {
        const frame = view.from + (i / 240) * (view.to - view.from);
        return {
          frame,
          value:
            mode === "value"
              ? evaluate(keys, frame, base)
              : speed(keys, frame, base, rate),
        };
      });
      // Include both sides of discontinuities so Hold renders as a step, not a ramp.
      if (mode === "value")
        for (const k of keys)
          if (k.frame >= view.from && k.frame <= view.to) {
            points.push(
              {
                frame: k.frame - 0.0001,
                value: evaluate(keys, k.frame - 0.0001, base),
              },
              { frame: k.frame, value: k.value },
            );
          }
      points.sort((a, b) => a.frame - b.frame);
      return { property, points };
    });
    return { result, ms: performance.now() - started };
  }, [shown, visible, view, mode, rate]);
  function fit(onlySelection = false, nextMode = mode) {
    if (!visible.length) {
      setMessage("Select a property to fit its curve");
      return;
    }
    const refs = onlySelection
      ? selection
      : visible.flatMap((property) =>
          clip.keyframes[property].map((k) => ({ property, frame: k.frame })),
        );
    const from = refs.length ? Math.min(...refs.map((r) => r.frame)) : 0,
      to = refs.length ? Math.max(...refs.map((r) => r.frame)) : clip.duration;
    const values = visible.flatMap((property) =>
      Array.from({ length: 241 }, (_, i) => {
        const frame = from + ((to - from) * i) / 240;
        return nextMode === "value"
          ? evaluate(clip.keyframes[property], frame, baseValue(clip, property))
          : speed(
              clip.keyframes[property],
              frame,
              baseValue(clip, property),
              rate,
            );
      }),
    );
    const min = Math.min(...values),
      max = Math.max(...values),
      pad = Math.max((max - min) * 0.15, properties[primary].step * 5),
      timePad = Math.max(3, (to - from) * 0.08);
    setView({
      from: from - timePad,
      to: Math.max(from + 1, to) + timePad,
      min: min - pad,
      max: max + pad,
    });
  }
  function run(name: string, command: Edit) {
    if (locked) return;
    execute(name, command);
    setMessage("");
  }
  function zoom(factor: number) {
    setView((v) => {
      const cx = (v.from + v.to) / 2,
        cy = (v.min + v.max) / 2;
      return {
        from: cx - ((v.to - v.from) * factor) / 2,
        to: cx + ((v.to - v.from) * factor) / 2,
        min: cy - ((v.max - v.min) * factor) / 2,
        max: cy + ((v.max - v.min) * factor) / 2,
      };
    });
  }
  function previewEdit(edit: Edit) {
    pending.current = edit;
    try {
      setPreview(produce(project, edit).clips.find((c) => c.id === clip.id)!);
      setMessage("");
    } catch (e) {
      pending.current = null;
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }
  function beginKey(e: PointerEvent<SVGCircleElement>, ref: KeyRef) {
    e.stopPropagation();
    if (locked) return;
    const refs = e.shiftKey
      ? selection.some((r) => same(r, ref))
        ? selection
        : [...selection, ref]
      : selection.some((r) => same(r, ref))
        ? selection
        : [ref];
    setSelected(refs);
    setPrimary(ref.property);
    if (mode === "value" && refs.some((r) => same(r, ref))) {
      const k = clip.keyframes[ref.property].find(
        (k) => k.frame === ref.frame,
      )!;
      drag.current = { kind: "keys", refs, frame: ref.frame, value: k.value };
      svg.current!.setPointerCapture(e.pointerId);
    }
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const rect = svg.current!.getBoundingClientRect(),
        dx =
          ((((e.clientX - d.x) / rect.width) * W) / (W - L - R)) *
          (d.view.to - d.view.from),
        dy =
          ((((e.clientY - d.y) / rect.height) * H) / (H - T - B)) *
          (d.view.max - d.view.min);
      setView({
        ...d.view,
        from: d.view.from - dx,
        to: d.view.to - dx,
        min: d.view.min + dy,
        max: d.view.max + dy,
      });
      return;
    }
    const at = coordinates(e);
    if (d.kind === "keys") {
      let f = Math.round(at.frame);
      if (snap) {
        const candidates = [
          clock.get().frame - clip.start,
          ...visible.flatMap((p) =>
            clip.keyframes[p]
              .filter(
                (k) =>
                  !d.refs.some((r) => same(r, { property: p, frame: k.frame })),
              )
              .map((k) => k.frame),
          ),
        ];
        const threshold = (view.to - view.from) * 0.012;
        const nearest = candidates.sort(
          (a, b) => Math.abs(a - f) - Math.abs(b - f),
        )[0];
        if (nearest !== undefined && Math.abs(nearest - f) < threshold)
          f = nearest;
      }
      const step = properties[primary].step,
        dy = e.shiftKey ? 0 : Math.round((at.value - d.value) / step) * step;
      movedRefs.current = d.refs.map((r) => ({
        ...r,
        frame: r.frame + f - d.frame,
      }));
      previewEdit(moveKeys(clip.id, d.refs, f - d.frame, dy));
    } else {
      const keys = sortedKeys(clip.keyframes[d.ref.property]),
        i = keys.findIndex((k) => k.frame === d.ref.frame),
        k = keys[i],
        next = keys[i + (d.side === "inHandle" ? -1 : 1)];
      if (!next) return;
      previewEdit(
        setHandle(clip.id, d.ref, d.side, {
          x: (at.frame - k.frame) / (next.frame - k.frame),
          y: at.value - k.value,
        }),
      );
    }
  }
  function end(e: PointerEvent<SVGSVGElement>, cancel = false) {
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
    if (!cancel && pending.current) {
      run("Edit animation curve", pending.current);
      if (drag.current?.kind === "keys") setSelected(movedRefs.current);
    }
    pending.current = null;
    drag.current = null;
    setPreview(null);
  }
  function duplicate() {
    const keys = copyKeys(clip, selection);
    if (!keys.length) return;
    const end = Math.max(...keys.map((k) => k.frame)) + 1;
    run("Duplicate keyframes", pasteKeys(clip.id, keys, end));
    setSelected(
      keys.map((k) => ({
        property: k.property,
        frame: end + k.frame - Math.min(...keys.map((v) => v.frame)),
      })),
    );
  }
  return (
    <div
      className="animation-body"
      onKeyDown={(e) => {
        // Keep graph keys from deleting the selected video clip in global shortcuts.
        e.stopPropagation();
        if ((e.target as HTMLElement).closest("input,select")) return;
        if (
          (e.ctrlKey || e.metaKey) &&
          ["z", "y"].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          if (e.shiftKey || e.key.toLowerCase() === "y")
            useEditor.getState().redo();
          else useEditor.getState().undo();
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          run("Delete keyframes", removeKeys(clip.id, selection));
          setSelected([]);
        }
        if (e.key === "Escape") {
          drag.current = null;
          pending.current = null;
          setPreview(null);
        }
      }}
    >
      <div className="animation-properties">
        {(["transform", "effects", "crop"] as const).map((group) => (
          <details key={group} open={group === "transform"}>
            <summary>{group}</summary>
            {propertyNames
              .filter((p) => properties[p].group === group)
              .map((p) => (
                <div key={p} className={primary === p ? "active-property" : ""}>
                  <input
                    type="checkbox"
                    aria-label={`Show ${properties[p].label} curve`}
                    checked={visible.includes(p)}
                    onChange={(e) =>
                      setVisible(
                        e.target.checked
                          ? [...visible, p]
                          : visible.filter((v) => v !== p),
                      )
                    }
                  />
                  <button
                    className="text-button"
                    onClick={() => {
                      setPrimary(p);
                      if (!visible.includes(p)) setVisible([...visible, p]);
                    }}
                  >
                    {properties[p].label}
                  </button>
                  <span>{clip.keyframes[p].length || "—"}</span>
                </div>
              ))}
          </details>
        ))}
      </div>
      <div className="animation-main">
        <div className="animation-tools">
          <select
            aria-label="Graph type"
            value={mode}
            onChange={(e) => {
              const m = e.target.value as typeof mode;
              setMode(m);
              fit(false, m);
            }}
          >
            <option value="value">Value graph</option>
            <option value="speed">Speed graph · units/s</option>
          </select>
          <button onClick={() => fit()}>Fit all</button>
          <button disabled={!selection.length} onClick={() => fit(true)}>
            Fit selection
          </button>
          <button aria-label="Zoom graph in" onClick={() => zoom(0.8)}>
            +
          </button>
          <button aria-label="Zoom graph out" onClick={() => zoom(1.25)}>
            −
          </button>
          <label>
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />
            Snap
          </label>
          <GraphTime clip={clip} visible={visible} />
        </div>
        <svg
          ref={svg}
          className="curve-canvas"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="application"
          aria-label="Keyframe graph"
          tabIndex={0}
          onPointerDown={(e) => {
            svg.current?.focus();
            if (e.button === 1 || e.altKey) {
              e.preventDefault();
              drag.current = { kind: "pan", x: e.clientX, y: e.clientY, view };
              svg.current!.setPointerCapture(e.pointerId);
            } else if (e.target === svg.current) {
              clock.seek(clip.start + coordinates(e).frame);
              setSelected([]);
            }
          }}
          onPointerMove={move}
          onPointerUp={(e) => end(e)}
          onPointerCancel={(e) => end(e, true)}
          onWheel={(e) => zoom(e.deltaY > 0 ? 1.12 : 0.89)}
        >
          <defs>
            <clipPath id="curve-area">
              <rect x={L} y={T} width={W - L - R} height={H - T - B} />
            </clipPath>
          </defs>
          {Array.from({ length: 6 }, (_, i) => {
            const f = view.from + ((view.to - view.from) * i) / 5,
              v = view.min + ((view.max - view.min) * i) / 5;
            return (
              <g key={i} className="graph-grid" pointerEvents="none">
                <line x1={x(f)} x2={x(f)} y1={T} y2={H - B} />
                <text x={x(f)} y={H - 6}>
                  {Math.round(f)}f
                </text>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
                <text x={L - 8} y={y(v) + 4} textAnchor="end">
                  {Number(v.toFixed(2))}
                </text>
              </g>
            );
          })}
          <g clipPath="url(#curve-area)">
            {paths.result.map(({ property, points }, i) => (
              <path
                key={property}
                data-testid={`curve-${property}`}
                d={points
                  .map((p, i) => `${i ? "L" : "M"}${x(p.frame)},${y(p.value)}`)
                  .join(" ")}
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth={1.8}
                pointerEvents="none"
              />
            ))}
            {visible.flatMap((property, pi) => {
              const keys = sortedKeys(shown.keyframes[property]);
              return keys.flatMap((k, ki) => {
                const ref = { property, frame: k.frame },
                  isSelected = selection.some((r) => same(r, ref));
                const value =
                  mode === "value"
                    ? k.value
                    : speed(keys, k.frame, baseValue(shown, property), rate);
                const handles: React.ReactNode[] = [];
                if (mode === "value" && isSelected)
                  for (const side of ["inHandle", "outHandle"] as const) {
                    const left = side === "outHandle" ? ki : ki - 1;
                    if (
                      left < 0 ||
                      left >= keys.length - 1 ||
                      !keys[left].easing.includes("bezier")
                    )
                      continue;
                    const hs = segmentHandles(keys, left),
                      h = side === "outHandle" ? hs.out : hs.in,
                      dt = keys[left + 1].frame - keys[left].frame,
                      hf = k.frame + (side === "outHandle" ? 1 : -1) * h.x * dt,
                      hv = k.value + h.y;
                    handles.push(
                      <g key={side}>
                        <line
                          x1={x(k.frame)}
                          y1={y(k.value)}
                          x2={x(hf)}
                          y2={y(hv)}
                          stroke={colors[pi % colors.length]}
                          pointerEvents="none"
                        />
                        <circle
                          aria-label={`${property} ${k.frame} ${side}`}
                          cx={x(hf)}
                          cy={y(hv)}
                          r={4}
                          className="tangent"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            if (locked) return;
                            drag.current = { kind: "handle", ref, side };
                            svg.current!.setPointerCapture(e.pointerId);
                          }}
                        />
                      </g>,
                    );
                  }
                return [
                  <g key={`${property}-${ki}`}>
                    {handles}
                    <circle
                      aria-label={`${properties[property].label} key ${k.frame}`}
                      cx={x(k.frame)}
                      cy={y(value)}
                      r={isSelected ? 5.5 : 4}
                      fill={isSelected ? "#ffffff" : colors[pi % colors.length]}
                      className="graph-key"
                      onPointerDown={(e) => beginKey(e, ref)}
                    >
                      <title>
                        {properties[property].label} · frame {k.frame} ·{" "}
                        {k.value}
                      </title>
                    </circle>
                  </g>,
                ];
              });
            })}
            <GraphCursor start={clip.start} from={view.from} to={view.to} />
          </g>
        </svg>
        <fieldset disabled={locked} className="animation-edit-tools">
          <select
            aria-label="Animation property"
            value={primary}
            onChange={(e) => {
              const p = e.target.value as AnimatedProperty;
              setPrimary(p);
              if (!visible.includes(p)) setVisible([...visible, p]);
            }}
          >
            {propertyNames.map((p) => (
              <option key={p} value={p}>
                {properties[p].label}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              run(
                "Toggle animation",
                enableAnimation(
                  clip.id,
                  primary,
                  !clip.keyframes[primary].length,
                  clock.get().frame,
                ),
              )
            }
          >
            {clip.keyframes[primary].length
              ? "Disable animation"
              : "Enable animation"}
          </button>
          <button
            onClick={() =>
              run("Add keyframe", addKey(clip.id, primary, clock.get().frame))
            }
          >
            Add key
          </button>
          <button
            disabled={!selection.length}
            onClick={() => {
              setClipboard(copyKeys(clip, selection));
              setMessage(`${selection.length} keys copied`);
            }}
          >
            Copy
          </button>
          <button
            disabled={!clipboard.length}
            onClick={() =>
              run(
                "Paste keyframes",
                pasteKeys(clip.id, clipboard, clock.get().frame - clip.start),
              )
            }
          >
            Paste
          </button>
          <button disabled={!selection.length} onClick={duplicate}>
            Duplicate
          </button>
          <button
            disabled={!selection.length}
            onClick={() => {
              run("Delete keyframes", removeKeys(clip.id, selection));
              setSelected([]);
            }}
          >
            Delete keys
          </button>
          <select
            aria-label="Selected key interpolation"
            disabled={!selection.length}
            value={selectedKey?.easing ?? ""}
            onChange={(e) =>
              run(
                "Set interpolation",
                setInterpolation(
                  clip.id,
                  selection,
                  e.target.value as Keyframe["easing"],
                ),
              )
            }
          >
            <option value="" disabled>
              {selection.length > 1 ? "Mixed / set easing" : "Select keys"}
            </option>
            {interpolationModes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {selectedKey && (
            <>
              <label>
                Frame
                <input
                  aria-label="Key frame"
                  type="number"
                  value={selectedKey.frame}
                  onChange={(e) => {
                    const f = Number(e.target.value);
                    if (Number.isInteger(f)) {
                      run(
                        "Move keyframe",
                        moveKeys(clip.id, selection, f - selectedKey.frame),
                      );
                      if (editorProject(useEditor.getState()) !== project)
                        setSelected([{ ...selection[0], frame: f }]);
                    }
                  }}
                />
              </label>
              <label>
                Value
                <input
                  aria-label="Key value"
                  type="number"
                  step={properties[selection[0].property].step}
                  value={Number(selectedKey.value.toFixed(4))}
                  onChange={(e) =>
                    run(
                      "Set key value",
                      moveKeys(
                        clip.id,
                        selection,
                        0,
                        Number(e.target.value) - selectedKey.value,
                      ),
                    )
                  }
                />
              </label>
            </>
          )}
        </fieldset>
        <div className="animation-status">
          {message ||
            `${selection.length} keys selected · ${mode === "speed" ? "Signed velocity; edit tangents in Value graph" : "Shift-drag locks values; time snaps to whole frames"}`}
          <span>
            {paths.ms.toFixed(1)} ms curves {locked ? "· Layer locked" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
function GraphCursor({
  start,
  from,
  to,
}: {
  start: number;
  from: number;
  to: number;
}) {
  const line = useRef<SVGLineElement>(null);
  useEffect(() => {
    const update = () => {
      const x =
        L + ((clock.get().frame - start - from) / (to - from)) * (W - L - R);
      line.current?.setAttribute("x1", String(x));
      line.current?.setAttribute("x2", String(x));
    };
    update();
    return clock.subscribe(update);
  }, [start, from, to]);
  return (
    <line ref={line} y1={T} y2={H - B} stroke="#f2b46b" pointerEvents="none" />
  );
}
function GraphTime({
  clip,
  visible,
}: {
  clip: Clip;
  visible: AnimatedProperty[];
}) {
  const { frame } = useClock();
  function navigate(direction: number) {
    const keys = visible
      .flatMap((p) => clip.keyframes[p].map((k) => clip.start + k.frame))
      .filter((f) => (direction < 0 ? f < frame : f > frame));
    if (keys.length)
      clock.seek(direction < 0 ? Math.max(...keys) : Math.min(...keys));
  }
  return (
    <>
      <button aria-label="Previous keyframe" onClick={() => navigate(-1)}>
        ‹ Key
      </button>
      <button aria-label="Next keyframe" onClick={() => navigate(1)}>
        Key ›
      </button>
      <label>
        Local frame
        <input
          aria-label="Animation playhead"
          type="number"
          value={frame - clip.start}
          onChange={(e) => clock.seek(clip.start + Number(e.target.value))}
        />
      </label>
    </>
  );
}
