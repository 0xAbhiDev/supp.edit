import { type Clip, fps } from "../../../packages/project-schema";
import { editorProject, useEditor } from "../../../packages/editor-state";
import { useClock } from "../../../packages/engine/clock";
import { sourceFrameAt, speedAt } from "../../../packages/time-remap/model";
import {
  removeSpeedKey,
  setSpeedKey,
  setTimeRemap,
} from "../../../packages/commands/time-remap";
import { NumberField, Section } from "./Controls";
export function SpeedEditor({ clip }: { clip: Clip }) {
  const project = useEditor(editorProject),
    execute = useEditor((s) => s.executeScoped),
    { frame } = useClock();
  const asset = project.assets.find((a) => a.id === clip.assetId);
  if (clip.kind !== "media" || !asset || asset.kind === "image") return null;
  const local = Math.max(
      0,
      Math.min(clip.duration, Math.round(frame - clip.start)),
    ),
    rate = fps(project);
  const points = Array.from(
    { length: 101 },
    (_, i) => `${i * 3},${90 - speedAt(clip, (clip.duration * i) / 100) * 20}`,
  ).join(" ");
  return (
    <Section title="Speed / time remap">
      <p>
        {(
          (sourceFrameAt(clip, clip.duration) - sourceFrameAt(clip, 0)) /
          rate
        ).toFixed(2)}
        s source → {(clip.duration / rate).toFixed(2)}s timeline
      </p>
      <NumberField
        label="Speed at playhead"
        value={speedAt(clip, local)}
        min={0.25}
        max={4}
        step={0.05}
        onChange={(v) =>
          execute("Set speed key", setSpeedKey(clip.id, local, v))
        }
      />
      <svg
        viewBox="0 0 300 90"
        role="img"
        aria-label="Editable speed curve"
        style={{ width: "100%", height: 75 }}
      >
        <line x1="0" y1="70" x2="300" y2="70" stroke="#666" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
      <button
        onClick={() =>
          execute(
            "Add speed key",
            setSpeedKey(clip.id, local, speedAt(clip, local)),
          )
        }
      >
        Add speed key at playhead
      </button>
      {clip.timeRemap?.keys.map((key, i) => (
        <div key={key.frame} className="speed-key">
          <span>{(key.frame / rate).toFixed(2)}s</span>
          <NumberField
            label={`Speed key ${i + 1}`}
            value={key.speed}
            min={0.25}
            max={4}
            step={0.05}
            onChange={(v) =>
              execute(
                "Edit speed key",
                setSpeedKey(clip.id, key.frame, v, key.easing),
              )
            }
          />
          <select
            aria-label={`Speed easing ${i + 1}`}
            value={key.easing}
            onChange={(e) =>
              execute(
                "Change speed easing",
                setSpeedKey(
                  clip.id,
                  key.frame,
                  key.speed,
                  e.target.value as "smooth" | "linear",
                ),
              )
            }
          >
            <option value="smooth">Smooth</option>
            <option value="linear">Linear</option>
          </select>
          <button
            aria-label={`Remove speed key ${i + 1}`}
            onClick={() =>
              execute("Remove speed key", removeSpeedKey(clip.id, key.frame))
            }
          >
            Remove
          </button>
        </div>
      ))}
      {clip.timeRemap && (
        <button
          onClick={() =>
            execute("Restore normal speed", setTimeRemap(clip.id, undefined))
          }
        >
          Restore normal speed
        </button>
      )}
      <p className="field-hint">
        Cuts keep their timeline positions. Speed changes source consumption and
        audio pitch. Slow motion repeats source frames; optical flow and pitch
        preservation are not applied.
      </p>
    </Section>
  );
}
