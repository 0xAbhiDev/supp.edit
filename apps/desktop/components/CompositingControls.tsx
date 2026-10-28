import { useEditor, editorProject } from "../../../packages/editor-state";
import type { Clip } from "../../../packages/project-schema";
import {
  blendModes,
  matteModes,
  type BlendMode,
  type Matte,
} from "../../../packages/compositing/model";
import {
  matteCandidates,
  setMatte,
  setBlendMode,
} from "../../../packages/commands/compositing";
import { Section } from "./Controls";
import "./compositing-controls.css";
export function CompositingControls({ clip }: { clip: Clip }) {
  const project = useEditor(editorProject),
    execute = useEditor((s) => s.executeScoped);
  const users = project.clips.filter((c) => c.matte?.layerId === clip.id);
  return (
    <Section title="Matte & blend">
      <div className="compositing-controls">
        <label>
          <span>Blend mode</span>
          <select
            aria-label="Layer blend mode"
            value={clip.blendMode}
            onChange={(e) =>
              execute(
                "Set layer blend mode",
                setBlendMode(clip.id, e.target.value as BlendMode),
              )
            }
          >
            {blendModes.map((m) => (
              <option key={m} value={m}>
                {m === "add" ? "Add (clamped plus)" : m}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Matte source</span>
          <select
            aria-label="Matte source"
            value={clip.matte?.layerId ?? ""}
            onChange={(e) =>
              execute(
                "Set track matte",
                setMatte(
                  clip.id,
                  e.target.value
                    ? {
                        layerId: e.target.value,
                        mode: clip.matte?.mode ?? "alpha",
                      }
                    : undefined,
                ),
              )
            }
          >
            <option value="">None</option>
            {matteCandidates(project, clip.id).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.kind}
              </option>
            ))}
          </select>
        </label>
        {clip.matte && (
          <>
            <label>
              <span>Use</span>
              <select
                aria-label="Matte mode"
                value={clip.matte.mode}
                onChange={(e) =>
                  execute(
                    "Set matte mode",
                    setMatte(clip.id, {
                      ...clip.matte!,
                      mode: e.target.value as Matte["mode"],
                    }),
                  )
                }
              >
                {matteModes.map((m) => (
                  <option key={m} value={m}>
                    {m.replace("-", " ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => useEditor.getState().select(clip.matte!.layerId)}
            >
              Select matte source
            </button>
            <p className="field-hint">
              The source supplies coverage in composition space, including its
              masks, effects and opacity. Its track visibility does not disable
              the matte. Outside its time range it is transparent.
            </p>
          </>
        )}
        {users.length > 0 && (
          <p role="status" className="field-hint">
            Used as a matte by {users.map((c) => c.name).join(", ")}. This layer
            is excluded from direct image output while referenced; its audio
            follows track controls.
          </p>
        )}
      </div>
    </Section>
  );
}
