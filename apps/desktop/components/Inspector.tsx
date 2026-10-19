import {
  Diamond,
  SlidersHorizontal,
  RotateCcw,
  Layers,
  Lock,
  Trash2,
} from "lucide-react";
import { useEditor } from "../../../packages/editor-state";
import {
  animated,
  setTransform,
  toggleKeyframe,
  editable,
} from "../../../packages/commands";
import {
  type AnimatedProperty,
  type Clip,
  fps,
  timecode,
} from "../../../packages/project-schema";
import { useClock } from "../../../packages/engine/clock";
import { Section, NumberField, IconButton } from "./Controls";
export function Inspector() {
  const project = useEditor((s) => s.project),
    id = useEditor((s) => s.selected),
    execute = useEditor((s) => s.execute),
    workspace = useEditor((s) => s.workspace),
    history = useEditor((s) => s.historyNames),
    { frame } = useClock();
  const clip = project.clips.find((c) => c.id === id),
    locked = clip && project.tracks.find((t) => t.id === clip.trackId)?.locked;
  function edit(name: string, fn: (c: Clip) => void) {
    if (clip)
      execute(name, (p) => {
        const c = editable(p, clip.id);
        if (c) fn(c);
      });
  }
  if (!clip)
    return (
      <aside className="inspector panel">
        <div className="panel-heading">
          <span>Inspector</span>
          <SlidersHorizontal size={15} />
        </div>
        <div className="inspector-empty">
          <div className="empty-symbol">
            <Layers size={23} />
          </div>
          <strong>Every detail, considered.</strong>
          <p>
            Select a clip or layer to shape its appearance, motion, and sound.
          </p>
        </div>
        <div className="project-info">
          <span className="eyebrow">PROJECT SETTINGS</span>
          <dl>
            <dt>Canvas</dt>
            <dd>
              {project.settings.width} × {project.settings.height}
            </dd>
            <dt>Frame rate</dt>
            <dd>{fps(project).toFixed(3)} fps</dd>
            <dt>Working space</dt>
            <dd>sRGB · 8-bit</dd>
            <dt>Sources</dt>
            <dd>{project.assets.length} linked assets</dd>
          </dl>
          <p>
            Core editing works locally. No account or cloud service required.
          </p>
        </div>
        <History entries={history} />
      </aside>
    );
  const t = animated(clip, frame);
  const number = (
    label: string,
    key: keyof Clip["transform"],
    min: number,
    max: number,
    step = 1,
  ) => (
    <NumberField
      label={label}
      value={t[key]}
      min={min}
      max={max}
      step={step}
      onChange={(v) =>
        execute(`Set ${label}`, setTransform(clip.id, key, v, frame))
      }
    >
      {key in clip.keyframes && (
        <button
          className={`key-button ${clip.keyframes[key as AnimatedProperty].length ? "has-keys" : ""}`}
          aria-label={`Toggle ${label} keyframe`}
          title={`Add/remove ${label} keyframe`}
          onClick={(e) => {
            e.preventDefault();
            execute(
              `Keyframe ${label}`,
              toggleKeyframe(clip.id, key as AnimatedProperty, frame),
            );
          }}
        >
          <Diamond
            size={11}
            fill={
              clip.keyframes[key as AnimatedProperty].some(
                (k) => k.frame === frame - clip.start,
              )
                ? "currentColor"
                : "none"
            }
          />
        </button>
      )}
    </NumberField>
  );
  return (
    <aside className="inspector panel">
      <div className="panel-heading">
        <span>Inspector</span>
        <span className="badge">{clip.kind}</span>
        <SlidersHorizontal size={15} />
      </div>
      <div className="inspector-scroll">
        <div className="selected-name">
          <span className={`tiny-dot ${clip.kind}`} />
          <input
            aria-label="Clip name"
            value={clip.name}
            onChange={(e) =>
              edit("Rename clip", (c) => {
                c.name = e.target.value;
              })
            }
          />
          {locked && <Lock size={14} />}
        </div>
        <div className="clip-timing">
          {timecode(clip.start, fps(project))}
          <span>→</span>
          {timecode(clip.start + clip.duration, fps(project))}
        </div>
        <fieldset disabled={!!locked}>
          {clip.kind === "text" && (
            <Section title="Typography">
              <textarea
                aria-label="Title text"
                value={clip.text.content}
                onChange={(e) =>
                  edit("Edit title", (c) => {
                    c.text.content = e.target.value;
                    c.name = e.target.value.split("\n")[0] || "Title";
                  })
                }
              />
              <div className="two-fields">
                <label>
                  Typeface
                  <select
                    aria-label="Font family"
                    value={clip.text.font}
                    onChange={(e) =>
                      edit("Set font", (c) => {
                        c.text.font = e.target.value as Clip["text"]["font"];
                      })
                    }
                  >
                    <option value="sans-serif">Sans serif</option>
                    <option value="serif">Serif</option>
                    <option value="monospace">Monospace</option>
                  </select>
                </label>
                <label>
                  Weight
                  <select
                    aria-label="Font weight"
                    value={clip.text.weight}
                    onChange={(e) =>
                      edit("Set weight", (c) => {
                        c.text.weight = e.target.value as "normal" | "bold";
                      })
                    }
                  >
                    <option value="bold">Bold</option>
                    <option value="normal">Regular</option>
                  </select>
                </label>
              </div>
              <NumberField
                label="Font size"
                value={clip.text.size}
                min={6}
                max={1000}
                onChange={(v) =>
                  edit("Set text size", (c) => {
                    c.text.size = v;
                  })
                }
              />
              <label className="number-field">
                <span>Text color</span>
                <input
                  aria-label="Text color"
                  type="color"
                  value={clip.text.color}
                  onChange={(e) =>
                    edit("Set text color", (c) => {
                      c.text.color = e.target.value;
                    })
                  }
                />
              </label>
              <label className="number-field">
                <span>Alignment</span>
                <select
                  aria-label="Text alignment"
                  value={clip.text.align}
                  onChange={(e) =>
                    edit("Set text alignment", (c) => {
                      c.text.align = e.target.value as Clip["text"]["align"];
                    })
                  }
                >
                  <option>left</option>
                  <option>center</option>
                  <option>right</option>
                </select>
              </label>
            </Section>
          )}
          {clip.kind === "shape" && (
            <Section title="Shape">
              <label className="number-field">
                <span>Geometry</span>
                <select
                  aria-label="Shape type"
                  value={clip.shape.type}
                  onChange={(e) =>
                    edit("Set shape", (c) => {
                      c.shape.type = e.target.value as "rectangle" | "ellipse";
                    })
                  }
                >
                  <option>rectangle</option>
                  <option>ellipse</option>
                </select>
              </label>
              <label className="number-field">
                <span>Fill</span>
                <input
                  aria-label="Shape color"
                  type="color"
                  value={clip.shape.color}
                  onChange={(e) =>
                    edit("Set fill", (c) => {
                      c.shape.color = e.target.value;
                    })
                  }
                />
              </label>
              <NumberField
                label="Shape width"
                value={clip.shape.width}
                min={1}
                max={8192}
                onChange={(v) =>
                  edit("Resize shape", (c) => {
                    c.shape.width = v;
                  })
                }
              />
              <NumberField
                label="Shape height"
                value={clip.shape.height}
                min={1}
                max={8192}
                onChange={(v) =>
                  edit("Resize shape", (c) => {
                    c.shape.height = v;
                  })
                }
              />
            </Section>
          )}
          {workspace !== "Audio" && (
            <>
              <Section title="Transform">
                {number("Position X", "x", -32768, 32768)}
                {number("Position Y", "y", -32768, 32768)}
                {number("Scale", "scale", 0.01, 10, 0.01)}
                {number("Rotation", "rotation", -36000, 36000)}
                {number("Opacity", "opacity", 0, 1, 0.01)}
                <p className="field-hint">
                  Drag the selected layer in the monitor. ◇ animates a property
                  at the playhead.
                </p>
              </Section>
              <Section title="Color & effects">
                <NumberField
                  label="Gaussian blur"
                  value={clip.effects.blur}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(v) =>
                    edit("Set blur", (c) => {
                      c.effects.blur = v;
                    })
                  }
                />
                {(["brightness", "contrast", "saturation"] as const).map(
                  (key) => (
                    <NumberField
                      key={key}
                      label={key[0].toUpperCase() + key.slice(1)}
                      value={clip.effects[key]}
                      min={0}
                      max={3}
                      step={0.05}
                      onChange={(v) =>
                        edit(`Set ${key}`, (c) => {
                          c.effects[key] = v;
                        })
                      }
                    />
                  ),
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    edit("Reset effects", (c) => {
                      c.effects = {
                        blur: 0,
                        brightness: 1,
                        contrast: 1,
                        saturation: 1,
                      };
                    })
                  }
                >
                  <RotateCcw size={12} /> Reset effects
                </button>
              </Section>
              <Section title="Layer mask" open={!!clip.mask}>
                <label className="number-field">
                  <span>Mask</span>
                  <select
                    aria-label="Mask type"
                    value={clip.mask?.type ?? "none"}
                    onChange={(e) =>
                      edit("Set mask", (c) => {
                        c.mask =
                          e.target.value === "none"
                            ? null
                            : {
                                type: e.target.value as "ellipse" | "rectangle",
                                x: 0.1,
                                y: 0.1,
                                width: 0.8,
                                height: 0.8,
                              };
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="rectangle">Rectangle</option>
                    <option value="ellipse">Ellipse</option>
                  </select>
                </label>
                {clip.mask &&
                  (["x", "y", "width", "height"] as const).map((key) => (
                    <NumberField
                      key={key}
                      label={`Mask ${key}`}
                      value={clip.mask![key]}
                      min={key === "width" || key === "height" ? 0.001 : 0}
                      max={1}
                      step={0.01}
                      onChange={(v) =>
                        edit("Adjust mask", (c) => {
                          if (c.mask) c.mask[key] = v;
                        })
                      }
                    />
                  ))}
              </Section>
            </>
          )}
          <Section title="Audio">
            <NumberField
              label="Clip gain (dB)"
              value={clip.gain}
              min={-60}
              max={12}
              step={0.5}
              onChange={(v) =>
                edit("Set clip gain", (c) => {
                  c.gain = v;
                })
              }
            />
            <p className="field-hint">
              Applies to source audio in playback and MP4 export.
            </p>
          </Section>
          <Section
            title="Keyframes"
            open={Object.values(clip.keyframes).some((k) => k.length > 0)}
          >
            {(Object.keys(clip.keyframes) as AnimatedProperty[]).flatMap(
              (key) =>
                clip.keyframes[key]
                  .filter((k) => k.frame >= 0 && k.frame < clip.duration)
                  .map((k) => (
                    <div className="key-row" key={`${key}-${k.frame}`}>
                      <span>
                        {key} · f{k.frame}
                      </span>
                      <select
                        aria-label={`${key} frame ${k.frame} easing`}
                        value={k.easing}
                        onChange={(e) =>
                          edit("Set keyframe interpolation", (c) => {
                            c.keyframes[key].find(
                              (v) => v.frame === k.frame,
                            )!.easing = e.target.value as typeof k.easing;
                          })
                        }
                      >
                        <option value="linear">Linear</option>
                        <option value="hold">Hold</option>
                        <option value="ease-in-out">Ease in/out</option>
                      </select>
                      <IconButton
                        label={`Delete ${key} frame ${k.frame}`}
                        onClick={() =>
                          edit("Delete keyframe", (c) => {
                            c.keyframes[key] = c.keyframes[key].filter(
                              (v) => v.frame !== k.frame,
                            );
                          })
                        }
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  )),
            )}
            <p className="field-hint">
              Keyframe times are relative to the clip. Move the playhead, then
              change an animated value to add a key.
            </p>
          </Section>
        </fieldset>
        <History entries={history} />
      </div>
    </aside>
  );
}
function History({ entries }: { entries: string[] }) {
  return (
    <div className="history">
      <span className="eyebrow">RECENT HISTORY</span>
      {entries.length ? (
        entries
          .slice(-5)
          .reverse()
          .map((name, i) => (
            <div key={`${entries.length - i}`}>
              <span>{String(entries.length - i).padStart(2, "0")}</span>
              {name}
            </div>
          ))
      ) : (
        <p>Your edits will appear here.</p>
      )}
    </div>
  );
}
