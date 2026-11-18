import { useState } from "react";
import { useEditor } from "../../../packages/editor-state";
import { useClock } from "../../../packages/engine/clock";
import {
  interpolationModes,
  type Clip,
} from "../../../packages/project-schema";
import {
  effectTypes,
  effectInfo,
  grainOf,
  curvesOf,
  type EffectType,
} from "../../../packages/effects/model";
import { CURVE_CHANNELS } from "../../../packages/effects/curves";
import { effectValue } from "../../../packages/effects/evaluate";
import {
  addEffect,
  deleteEffect,
  editEffect,
  reorderEffect,
  setEffectValue,
  toggleEffectKey,
} from "../../../packages/commands/effects";
import { Section, NumberField } from "./Controls";
import "./effect-stack.css";
export function EffectStack({ clip }: { clip: Clip }) {
  const execute = useEditor((s) => s.executeScoped),
    { frame } = useClock();
  const [type, setType] = useState<EffectType>("blur");
  const local = Math.round(frame - clip.start);
  return (
    <Section title="Ordered effects">
      <p className="field-hint">
        Runs from top to bottom after masks, before opacity and matte blending.
      </p>
      <div className="effect-add">
        <select
          aria-label="Effect to add"
          value={type}
          onChange={(e) => setType(e.target.value as EffectType)}
        >
          {effectTypes.map((t) => (
            <option key={t} value={t}>
              {effectInfo[t].label}
            </option>
          ))}
        </select>
        <button
          disabled={clip.effectStack.length >= 32}
          onClick={() => execute("Add effect", addEffect(clip.id, type))}
        >
          Add effect
        </button>
      </div>
      <ol className="effect-stack">
        {clip.effectStack.map((e, i) => {
          const info = effectInfo[e.type],
            key = e.keys.find((k) => k.frame === local);
          return (
            <li key={e.id} data-testid="effect-entry">
              <header>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Enable ${info.label} ${i + 1}`}
                    checked={e.enabled}
                    onChange={(v) =>
                      execute(
                        "Toggle effect",
                        editEffect(clip.id, e.id, (e) => {
                          e.enabled = v.target.checked;
                        }),
                      )
                    }
                  />
                  {info.label}
                </label>
                <button
                  aria-label={`Move effect ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() =>
                    execute("Reorder effects", reorderEffect(clip.id, e.id, -1))
                  }
                >
                  ↑
                </button>
                <button
                  aria-label={`Move effect ${i + 1} down`}
                  disabled={i === clip.effectStack.length - 1}
                  onClick={() =>
                    execute("Reorder effects", reorderEffect(clip.id, e.id, 1))
                  }
                >
                  ↓
                </button>
                <button
                  aria-label={`Remove effect ${i + 1}`}
                  onClick={() =>
                    execute("Remove effect", deleteEffect(clip.id, e.id))
                  }
                >
                  ×
                </button>
              </header>
              <NumberField
                label={`${info.label} amount ${i + 1}`}
                value={effectValue(e, local)}
                min={info.min}
                max={info.max}
                step={info.step}
                onChange={(v) =>
                  execute(
                    "Change effect value",
                    setEffectValue(clip.id, e.id, v, frame),
                  )
                }
              >
                <button
                  type="button"
                  aria-label={`Toggle effect ${i + 1} keyframe`}
                  aria-pressed={!!key}
                  onClick={() =>
                    execute(
                      "Toggle effect key",
                      toggleEffectKey(clip.id, e.id, frame),
                    )
                  }
                >
                  {key ? "◆" : "◇"}
                </button>
              </NumberField>
              {e.type === "grain" && (
                <div className="two-fields">
                  <NumberField
                    label={`Grain size ${i + 1}`}
                    min={0.5}
                    max={8}
                    step={0.1}
                    value={grainOf(e).size ?? 1.2}
                    onChange={(v) =>
                      execute(
                        "Change grain size",
                        editEffect(clip.id, e.id, (e) => {
                          e.parameters = {
                            size: v,
                            softness: grainOf(e).softness ?? 0.6,
                          };
                        }),
                      )
                    }
                  />
                  <NumberField
                    label={`Grain softness ${i + 1}`}
                    min={0}
                    max={1}
                    step={0.05}
                    value={grainOf(e).softness ?? 0.6}
                    onChange={(v) =>
                      execute(
                        "Change grain softness",
                        editEffect(clip.id, e.id, (e) => {
                          e.parameters = {
                            size: grainOf(e).size ?? 1.2,
                            softness: v,
                          };
                        }),
                      )
                    }
                  />
                </div>
              )}
              {curvesOf(e) && (
                <div className="effect-curves">
                  {CURVE_CHANNELS.map((channel) => (
                    <div key={channel} className="effect-curve-row">
                      <span>{channel}</span>
                      {curvesOf(e)![channel].map(([x, y], p) => (
                        <NumberField
                          key={p}
                          label={`${channel} output at ${Math.round(x * 255)} · effect ${i + 1}`}
                          min={0}
                          max={255}
                          step={1}
                          value={Math.round(y * 255)}
                          onChange={(v) =>
                            execute(
                              "Change tone curve",
                              editEffect(clip.id, e.id, (e) => {
                                const curves = curvesOf(e);
                                if (!curves) return;
                                const points = curves[channel];
                                points[p] = [points[p][0], Math.max(0, Math.min(255, v)) / 255];
                              }),
                            )
                          }
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {e.keys.length > 0 && (
                <div className="effect-animation">
                  <span>
                    {e.keys.length} keys · frame {local}
                  </span>
                  {key && (
                    <select
                      aria-label={`Effect ${i + 1} interpolation`}
                      value={key.easing}
                      onChange={(v) =>
                        execute(
                          "Effect key interpolation",
                          editEffect(clip.id, e.id, (e) => {
                            e.keys.find((k) => k.frame === local)!.easing = v
                              .target.value as typeof key.easing;
                          }),
                        )
                      }
                    >
                      {interpolationModes.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() =>
                      execute(
                        "Clear effect animation",
                        editEffect(clip.id, e.id, (e) => {
                          e.value = effectValue(e, local);
                          e.keys = [];
                        }),
                      )
                    }
                  >
                    Clear animation
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
