import { useState } from "react";
import { editorProject, useEditor } from "../../../packages/editor-state";
import {
  createComposition,
  addCompositionLayer,
  precompose,
  deleteComposition,
} from "../../../packages/commands/compositions";
import {
  deleteClip,
  duplicateClip,
  splitClip,
  type Edit,
} from "../../../packages/commands";
import { newClip, newTrack, uid } from "../../../packages/project-schema";
import { clock } from "../../../packages/engine/clock";
import "./compositions.css";

export function CompositionsPanel() {
  const project = useEditor(editorProject),
    root = useEditor((s) => s.project),
    active = useEditor((s) => s.activeComposition),
    selected = useEditor((s) => s.selected);
  const [name, setName] = useState("Composition"),
    [source, setSource] = useState(""),
    [selection, setSelection] = useState<string[]>([]);
  const execute = (label: string, edit: Edit) =>
    useEditor.getState().executeScoped(label, edit);
  const open = (id: string | null) => {
    clock.pause();
    clock.seek(0);
    useEditor.getState().setComposition(id);
    setSelection([]);
  };
  const selectedIds = selection.filter((id) =>
    project.clips.some((c) => c.id === id),
  );
  function add(kind: "text" | "shape" | "null") {
    execute(`Add ${kind} layer`, (p) => {
      const track = newTrack("video", p.tracks.length + 1);
      track.name =
        kind === "text" ? "Title" : kind === "shape" ? "Shape" : "Null";
      const length = active
        ? root.compositions.find((c) => c.id === active)!.duration
        : 150;
      const clip = newClip(track.id, 0, length, kind);
      clip.name = track.name;
      p.tracks.unshift(track);
      p.clips.push(clip);
      useEditor.getState().select(clip.id);
    });
  }
  return (
    <aside className="compositions panel" aria-label="Composition layers">
      <div className="panel-heading">
        <strong>Compositions</strong>
        <span>{root.compositions.length}</span>
      </div>
      <div className="composition-controls">
        <label>
          Editing
          <select
            aria-label="Active composition"
            value={active ?? ""}
            onChange={(e) => open(e.target.value || null)}
          >
            <option value="">Main sequence</option>
            {root.compositions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="composition-inline">
          <input
            aria-label="New composition name"
            value={name}
            maxLength={256}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            disabled={!name.trim()}
            onClick={() => {
              const id = uid();
              execute(
                "Create composition",
                createComposition(name.trim(), 150, id),
              );
              if (
                useEditor
                  .getState()
                  .project.compositions.some((c) => c.id === id)
              )
                open(id);
            }}
          >
            New
          </button>
        </div>
        {active && (
          <label>
            Composition duration (frames)
            <input
              type="number"
              min={1}
              max={2_000_000_000}
              aria-label="Composition duration"
              value={
                root.compositions.find((c) => c.id === active)?.duration ?? 150
              }
              onChange={(e) =>
                useEditor
                  .getState()
                  .executeScoped("Set composition duration", (p) => {
                    p.compositions.find((c) => c.id === active)!.duration =
                      Number(e.target.value);
                  })
              }
            />
          </label>
        )}
        <div className="composition-inline">
          <select
            aria-label="Composition source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Choose source</option>
            {root.compositions
              .filter((c) => c.id !== active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <button
            disabled={
              !root.compositions.some((c) => c.id === source && c.id !== active)
            }
            onClick={() =>
              execute(
                "Add composition layer",
                addCompositionLayer(source, clock.get().frame),
              )
            }
          >
            Add instance
          </button>
        </div>
        <div className="composition-inline">
          <button onClick={() => add("text")}>Text layer</button>
          <button onClick={() => add("shape")}>Shape layer</button>
          <button onClick={() => add("null")}>Null layer</button>
        </div>
        <button
          disabled={!selectedIds.length && !selected}
          onClick={() =>
            execute(
              "Precompose layers",
              precompose(
                selectedIds.length ? selectedIds : selected ? [selected] : [],
                name.trim() || "Precomposition",
              ),
            )
          }
        >
          Precompose selection
        </button>
        {active && (
          <button
            onClick={() => {
              useEditor
                .getState()
                .execute("Delete composition", deleteComposition(active));
              if (
                !useEditor
                  .getState()
                  .project.compositions.some((c) => c.id === active)
              )
                open(null);
            }}
          >
            Delete unused composition
          </button>
        )}
      </div>
      <div className="composition-layer-list">
        {project.tracks.map((track, index) => (
          <div key={track.id}>
            {project.clips
              .filter((c) => c.trackId === track.id)
              .map((c) => (
                <article
                  key={c.id}
                  className={selected === c.id ? "selected" : ""}
                >
                  <div className="composition-inline">
                    <input
                      type="checkbox"
                      aria-label={`Include ${c.name} in precomp`}
                      checked={selectedIds.includes(c.id)}
                      onChange={(e) =>
                        setSelection(
                          e.target.checked
                            ? [...selectedIds, c.id]
                            : selectedIds.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <button
                      className="layer-name"
                      onClick={() => useEditor.getState().select(c.id)}
                    >
                      {c.name}
                    </button>
                    <small>
                      {c.kind === "media"
                        ? root.assets.find((a) => a.id === c.assetId)?.kind
                        : c.kind}
                    </small>
                  </div>
                  <div className="composition-inline">
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Visible ${c.name}`}
                        checked={!track.hidden}
                        onChange={() =>
                          execute("Layer visibility", (p) => {
                            p.tracks.find((t) => t.id === track.id)!.hidden =
                              !track.hidden;
                          })
                        }
                      />
                      Visible
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Lock ${c.name}`}
                        checked={track.locked}
                        onChange={() =>
                          execute("Layer lock", (p) => {
                            p.tracks.find((t) => t.id === track.id)!.locked =
                              !track.locked;
                          })
                        }
                      />
                      Lock
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Solo ${c.name}`}
                        checked={track.solo}
                        onChange={() =>
                          execute("Layer solo", (p) => {
                            p.tracks.find((t) => t.id === track.id)!.solo =
                              !track.solo;
                          })
                        }
                      />
                      Solo
                    </label>
                  </div>
                  <div className="composition-inline">
                    <span>
                      {c.start}–{c.start + c.duration}f · in {c.sourceIn}
                    </span>
                    <button
                      disabled={track.locked || index === 0}
                      aria-label={`Raise ${c.name}`}
                      onClick={() =>
                        execute("Raise layer", (p) => {
                          const [t] = p.tracks.splice(index, 1);
                          p.tracks.splice(index - 1, 0, t);
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      disabled={
                        track.locked || index === project.tracks.length - 1
                      }
                      aria-label={`Lower ${c.name}`}
                      onClick={() =>
                        execute("Lower layer", (p) => {
                          const [t] = p.tracks.splice(index, 1);
                          p.tracks.splice(index + 1, 0, t);
                        })
                      }
                    >
                      ↓
                    </button>
                  </div>
                  {c.kind === "composition" && (
                    <button onClick={() => open(c.compositionId!)}>
                      Open composition
                    </button>
                  )}
                  {selected === c.id && (
                    <div className="composition-inline">
                      <button
                        disabled={track.locked}
                        onClick={() =>
                          execute("Duplicate layer", duplicateClip(c.id))
                        }
                      >
                        Duplicate
                      </button>
                      <button
                        disabled={track.locked}
                        onClick={() =>
                          execute(
                            "Split layer",
                            splitClip(c.id, clock.get().frame),
                          )
                        }
                      >
                        Split
                      </button>
                      <button
                        disabled={track.locked}
                        onClick={() =>
                          execute("Delete layer", deleteClip(c.id, false))
                        }
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </article>
              ))}
          </div>
        ))}
      </div>
      <p className="muted">
        Select a layer to edit its transform and animation. Track controls
        affect clips sharing that track.
      </p>
    </aside>
  );
}
