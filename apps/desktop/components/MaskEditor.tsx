import { useEffect, useRef, useState } from "react";
import { insertVertex, smoothVertex } from "../../../packages/masks/geometry";
import { create } from "zustand";
import { useEditor, editorProject } from "../../../packages/editor-state";
import { clock, useClock } from "../../../packages/engine/clock";
import { type Clip } from "../../../packages/project-schema";
import {
  newMask,
  vertex,
  maskRanges,
  type MaskVertex,
  type BezierMask,
} from "../../../packages/masks/model";
import { resolveMask, maskPath } from "../../../packages/masks/evaluate";
import {
  addMask,
  editMask,
  deleteMask,
  reorderMask,
  setMaskProperty,
  toggleMaskKey,
  setMaskVertices,
  clearMaskAnimation,
} from "../../../packages/commands/masks";
import {
  canvasMatrix,
  inverse,
  layerTransforms,
  point,
} from "../../../packages/animation/affine";
import { Section, NumberField } from "./Controls";
import "./mask-editor.css";

const useMaskTool = create<{
  owner: string;
  maskId: string;
  pen: boolean;
  draft: MaskVertex[];
  vertex: number;
}>(() => ({ owner: "", maskId: "", pen: false, draft: [], vertex: 0 }));
const clone = (v: MaskVertex[]) =>
  v.map((v) => ({ ...v, in: { ...v.in }, out: { ...v.out } }));
function owner(clipId: string) {
  const s = useEditor.getState();
  return [s.project.id, s.activeComposition, clipId].join("/");
}
export function MaskEditor({ clip }: { clip: Clip }) {
  const tool = useMaskTool(),
    { frame } = useClock(),
    execute = useEditor((s) => s.executeScoped);
  const id = owner(clip.id),
    active = tool.owner === id;
  const m =
    clip.masks.find((m) => active && m.id === tool.maskId) ?? clip.masks[0];
  const value = m && resolveMask(m, frame - clip.start),
    v =
      value?.vertices[
        active ? Math.min(tool.vertex, value.vertices.length - 1) : 0
      ];
  const index = active ? tool.vertex : 0;
  const select = (maskId: string) =>
    useMaskTool.setState({
      owner: id,
      maskId,
      pen: false,
      draft: [],
      vertex: 0,
    });
  const update = (fn: (m: BezierMask) => void) =>
    m && execute("Edit mask", editMask(clip.id, m.id, fn));
  const add = (shape: "rectangle" | "ellipse" | MaskVertex[]) => {
    const mask = newMask(shape);
    execute("Add Bezier mask", addMask(clip.id, mask));
    select(mask.id);
  };
  const editVertex = (fn: (v: MaskVertex) => void) => {
    if (!m || !value) return;
    const vertices = clone(value.vertices);
    fn(vertices[Math.min(index, vertices.length - 1)]);
    execute(
      "Edit mask vertex",
      setMaskVertices(clip.id, m.id, vertices, frame),
    );
  };
  return (
    <Section title="Bezier masks">
      <div className="mask-toolbar">
        <button
          disabled={clip.masks.length >= 32}
          onClick={() => add("rectangle")}
        >
          Rectangle mask
        </button>
        <button
          disabled={clip.masks.length >= 32}
          onClick={() => add("ellipse")}
        >
          Ellipse mask
        </button>
        <button
          disabled={clip.masks.length >= 32}
          aria-pressed={active && tool.pen}
          onClick={() => {
            clock.pause();
            useMaskTool.setState({
              owner: id,
              pen: true,
              draft: [],
              maskId: "",
              vertex: 0,
            });
          }}
        >
          Draw mask
        </button>
      </div>
      {active && tool.pen && (
        <div role="status">
          <p>Click the monitor to place vertices. Finish closes the path.</p>
          <button
            disabled={tool.draft.length < 3}
            onClick={() => add(tool.draft)}
          >
            Finish mask ({tool.draft.length})
          </button>
          <button
            onClick={() => useMaskTool.setState({ pen: false, draft: [] })}
          >
            Cancel drawing
          </button>
        </div>
      )}
      {clip.masks.length > 0 && (
        <select
          aria-label="Selected mask"
          value={m?.id}
          onChange={(e) => select(e.target.value)}
        >
          {clip.masks.map((m, i) => (
            <option key={m.id} value={m.id}>
              {i + 1}. {m.name}
            </option>
          ))}
        </select>
      )}
      {m && value && (
        <>
          <input
            aria-label="Mask name"
            value={m.name}
            onChange={(e) =>
              update((m) => {
                m.name = e.target.value;
              })
            }
          />
          <div className="mask-toolbar">
            <label>
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={(e) =>
                  update((m) => {
                    m.enabled = e.target.checked;
                  })
                }
              />
              Enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={m.inverted}
                onChange={(e) =>
                  update((m) => {
                    m.inverted = e.target.checked;
                  })
                }
              />
              Invert mask
            </label>
          </div>
          <label>
            Combine
            <select
              aria-label="Mask combine"
              value={m.mode}
              onChange={(e) =>
                update((m) => {
                  m.mode = e.target.value as BezierMask["mode"];
                })
              }
            >
              {["add", "subtract", "intersect", "difference"].map((mode) => (
                <option key={mode}>{mode}</option>
              ))}
            </select>
          </label>
          {(["opacity", "feather", "expansion"] as const).map((key) => (
            <NumberField
              key={key}
              label={"Mask " + key}
              value={value[key]}
              min={maskRanges[key][0]}
              max={maskRanges[key][1]}
              step={key === "opacity" ? 0.01 : 1}
              onChange={(v) =>
                execute(
                  "Set mask " + key,
                  setMaskProperty(clip.id, m.id, key, v, frame),
                )
              }
            >
              <button
                aria-label={"Toggle mask " + key + " keyframe"}
                className="key-button"
                onClick={() =>
                  execute(
                    "Keyframe mask " + key,
                    toggleMaskKey(clip.id, m.id, key, frame),
                  )
                }
              >
                {m.keyframes[key].some((k) => k.frame === frame - clip.start)
                  ? "◆"
                  : "◇"}
              </button>
            </NumberField>
          ))}
          <div className="mask-toolbar">
            <button
              aria-label="Toggle mask path keyframe"
              onClick={() =>
                execute(
                  "Keyframe mask path",
                  toggleMaskKey(clip.id, m.id, "path", frame),
                )
              }
            >
              {m.pathKeys.some((k) => k.frame === frame - clip.start)
                ? "◆"
                : "◇"}{" "}
              Path key
            </button>
            <button
              disabled={!m.pathKeys.length}
              onClick={() =>
                execute(
                  "Clear mask path animation",
                  clearMaskAnimation(clip.id, m.id, frame),
                )
              }
            >
              Clear path animation
            </button>
          </div>
          {m.pathKeys.length > 0 && (
            <div className="mask-key-list">
              {[...m.pathKeys]
                .sort((a, b) => a.frame - b.frame)
                .map((k) => (
                  <span key={k.frame}>
                    <button
                      onClick={() =>
                        clock.seek(Math.max(0, clip.start + k.frame))
                      }
                    >
                      Frame {clip.start + k.frame}
                    </button>
                    <select
                      aria-label={"Path easing at " + k.frame}
                      value={k.easing}
                      onChange={(e) =>
                        update((m) => {
                          m.pathKeys.find((x) => x.frame === k.frame)!.easing =
                            e.target.value as "linear" | "hold";
                        })
                      }
                    >
                      <option>linear</option>
                      <option>hold</option>
                    </select>
                  </span>
                ))}
            </div>
          )}
          <label>
            Vertex
            <select
              aria-label="Mask vertex"
              value={Math.min(index, value.vertices.length - 1)}
              onChange={(e) =>
                useMaskTool.setState({
                  owner: id,
                  maskId: m.id,
                  vertex: +e.target.value,
                })
              }
            >
              {value.vertices.map((v, i) => (
                <option key={v.id} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          {v && (
            <>
              <NumberField
                label="Vertex X"
                value={v.x}
                min={-4}
                max={5}
                step={0.01}
                onChange={(x) =>
                  editVertex((v) => {
                    v.x = x;
                  })
                }
              />
              <NumberField
                label="Vertex Y"
                value={v.y}
                min={-4}
                max={5}
                step={0.01}
                onChange={(y) =>
                  editVertex((v) => {
                    v.y = y;
                  })
                }
              />
              {(["in", "out"] as const).map((side) => (
                <div key={side}>
                  {(["x", "y"] as const).map((axis) => (
                    <NumberField
                      key={axis}
                      label={side + " tangent " + axis.toUpperCase()}
                      value={v[side][axis]}
                      min={-8}
                      max={8}
                      step={0.01}
                      onChange={(n) =>
                        editVertex((v) => {
                          v[side][axis] = n;
                        })
                      }
                    />
                  ))}
                </div>
              ))}
              <div className="mask-toolbar">
                <button
                  onClick={() =>
                    editVertex((v) => {
                      v.in = { x: 0, y: 0 };
                      v.out = { x: 0, y: 0 };
                    })
                  }
                >
                  Corner vertex
                </button>
                <button
                  onClick={() =>
                    execute(
                      "Smooth mask vertex",
                      setMaskVertices(
                        clip.id,
                        m.id,
                        smoothVertex(
                          value.vertices,
                          Math.min(index, value.vertices.length - 1),
                        ),
                        frame,
                      ),
                    )
                  }
                >
                  Smooth vertex
                </button>
                <button
                  disabled={!!m.pathKeys.length || value.vertices.length >= 128}
                  onClick={() =>
                    execute(
                      "Subdivide mask curve",
                      setMaskVertices(
                        clip.id,
                        m.id,
                        insertVertex(
                          value.vertices,
                          Math.min(index, value.vertices.length - 1),
                        ),
                        frame,
                      ),
                    )
                  }
                >
                  Insert vertex after
                </button>
                <button
                  disabled={value.vertices.length <= 3 || !!m.pathKeys.length}
                  onClick={() =>
                    execute(
                      "Delete mask vertex",
                      setMaskVertices(
                        clip.id,
                        m.id,
                        value.vertices.filter((x) => x.id !== v.id),
                        frame,
                      ),
                    )
                  }
                >
                  Delete vertex
                </button>
              </div>
            </>
          )}
          <p className="field-hint">
            Drag points and tangent handles on the Composite monitor.
            Coordinates are relative to the composition. Path keys interpolate
            matching vertices; clear path animation before deleting vertices.
          </p>
          <div className="mask-toolbar">
            <button
              disabled={clip.masks.indexOf(m) === 0}
              onClick={() =>
                execute("Raise mask", reorderMask(clip.id, m.id, -1))
              }
            >
              Mask up
            </button>
            <button
              disabled={clip.masks.indexOf(m) === clip.masks.length - 1}
              onClick={() =>
                execute("Lower mask", reorderMask(clip.id, m.id, 1))
              }
            >
              Mask down
            </button>
            <button
              onClick={() => execute("Delete mask", deleteMask(clip.id, m.id))}
            >
              Delete mask
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

export function MaskOverlay() {
  const project = useEditor(editorProject),
    selected = useEditor((s) => s.selected),
    workspace = useEditor((s) => s.workspace),
    tool = useMaskTool(),
    { frame } = useClock();
  const [drag, setDrag] = useState<MaskVertex[] | null>(null),
    svg = useRef<SVGSVGElement>(null),
    dragCleanup = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      dragCleanup.current?.();
    },
    [project, selected, frame, workspace],
  );
  const clip = project.clips.find((c) => c.id === selected);
  if (
    workspace !== "Composite" ||
    !clip ||
    clip.kind === "null" ||
    project.tracks.find((t) => t.id === clip.trackId)?.kind !== "video"
  )
    return null;
  const id = owner(clip.id),
    active = tool.owner === id,
    pen = active && tool.pen;
  const mask =
    clip.masks.find((m) => active && m.id === tool.maskId) ?? clip.masks[0];
  if (!mask && !pen) return null;
  const locked = project.tracks.find((t) => t.id === clip.trackId)?.locked,
    { width, height } = project.settings;
  const matrix = canvasMatrix(
    project,
    layerTransforms(project, frame).world(clip.id),
  );
  let inverseMatrix: ReturnType<typeof inverse>;
  try {
    inverseMatrix = inverse(matrix);
  } catch {
    return null;
  }
  const vertices = pen
    ? tool.draft
    : (drag ?? resolveMask(mask!, frame - clip.start).vertices);
  const screen = (v: { x: number; y: number }) =>
    point(matrix, (v.x - 0.5) * width, (v.y - 0.5) * height);
  function local(e: { clientX: number; clientY: number }) {
    const box = svg.current!.getBoundingClientRect();
    const p = point(
      inverseMatrix,
      ((e.clientX - box.left) * width) / box.width,
      ((e.clientY - box.top) * height) / box.height,
    );
    return {
      x: p.x / width + 0.5,
      y: p.y / height + 0.5,
    };
  }
  function start(
    e: React.PointerEvent<SVGCircleElement>,
    i: number,
    handle?: "in" | "out",
  ) {
    e.stopPropagation();
    if (locked || !mask) return;
    clock.pause();
    const target = e.currentTarget,
      initial = project,
      snapshot = clone(vertices),
      maskId = mask.id,
      clipId = clip!.id;
    useMaskTool.setState({ owner: id, maskId, vertex: i });
    let latest = snapshot;
    target.setPointerCapture(e.pointerId);
    const update = (event: PointerEvent) => {
      const p = local(event);
      latest = clone(snapshot);
      if (handle)
        latest[i][handle] = {
          x: Math.max(-8, Math.min(8, p.x - snapshot[i].x)),
          y: Math.max(-8, Math.min(8, p.y - snapshot[i].y)),
        };
      else {
        latest[i].x = Math.max(-4, Math.min(5, p.x));
        latest[i].y = Math.max(-4, Math.min(5, p.y));
      }
      setDrag(latest);
    };
    const clean = () => {
      target.removeEventListener("pointermove", update);
      target.removeEventListener("pointerup", done);
      target.removeEventListener("pointercancel", cancel);
      dragCleanup.current = null;
      setDrag(null);
    };
    const done = (event: PointerEvent) => {
      update(event);
      clean();
      if (
        editorProject(useEditor.getState()) === initial &&
        owner(clipId) === id
      )
        useEditor
          .getState()
          .executeScoped(
            "Move mask " + (handle ? "tangent" : "vertex"),
            setMaskVertices(clipId, maskId, latest, frame),
          );
    };
    const cancel = () => clean();
    dragCleanup.current = clean;
    target.addEventListener("pointermove", update);
    target.addEventListener("pointerup", done, { once: true });
    target.addEventListener("pointercancel", cancel, { once: true });
  }
  const radius =
    (5 * width) /
    Math.max(1, svg.current?.getBoundingClientRect().width ?? 640);
  return (
    <svg
      ref={svg}
      className={"mask-overlay" + (pen ? " drawing" : "")}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Mask path editor"
      onPointerDown={(e) => {
        if (!pen) return;
        e.stopPropagation();
        if (locked || tool.draft.length >= 128) return;
        const p = local(e);
        useMaskTool.setState({
          draft: [
            ...tool.draft,
            vertex(
              Math.max(-4, Math.min(5, p.x)),
              Math.max(-4, Math.min(5, p.y)),
            ),
          ],
        });
      }}
    >
      <g transform={`matrix(${matrix.join(" ")})`}>
        <path
          d={maskPath(vertices, width, height, true)}
          fill="none"
          stroke="#ffc85b"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      {vertices.map((v, i) => {
        const p = screen(v);
        return (
          <g key={v.id}>
            {!pen &&
              (["in", "out"] as const).map((side) => {
                const h = screen({ x: v.x + v[side].x, y: v.y + v[side].y });
                return (
                  <g key={side}>
                    <line
                      x1={p.x}
                      y1={p.y}
                      x2={h.x}
                      y2={h.y}
                      stroke="#ffc85b"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      role="button"
                      aria-label={`Mask vertex ${i + 1} ${side} handle`}
                      className="mask-handle"
                      cx={h.x}
                      cy={h.y}
                      r={radius * 0.65}
                      fill="#181b1e"
                      stroke="#ffc85b"
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={(e) => start(e, i, side)}
                    />
                  </g>
                );
              })}
            <circle
              role="button"
              aria-label={`Mask vertex ${i + 1}`}
              className="mask-handle"
              cx={p.x}
              cy={p.y}
              r={radius}
              fill={active && tool.vertex === i ? "#fff" : "#ffc85b"}
              stroke="#17191b"
              vectorEffect="non-scaling-stroke"
              onPointerDown={(e) => (pen ? undefined : start(e, i))}
            />
          </g>
        );
      })}
    </svg>
  );
}
