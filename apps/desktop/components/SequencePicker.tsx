import { useEditor } from "../../../packages/editor-state";
import { clock } from "../../../packages/engine/clock";
export function SequencePicker() {
  const project = useEditor((s) => s.project),
    scope = useEditor((s) => s.activeComposition);
  return (
    <label className="sequence-picker">
      Sequence{" "}
      <select
        aria-label="Active sequence"
        value={scope ?? ""}
        onChange={(e) => {
          clock.pause();
          useEditor.getState().setComposition(e.target.value || null);
          clock.seek(0);
        }}
      >
        <option value="">{project.name} · Main</option>
        {project.compositions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
