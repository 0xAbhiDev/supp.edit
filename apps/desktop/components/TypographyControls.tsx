import { useState } from "react";
import { type Clip } from "../../../packages/project-schema";
import { useEditor } from "../../../packages/editor-state";
import {
  editable,
  setProperty,
  toggleKeyframe,
} from "../../../packages/commands";
import { useClock } from "../../../packages/engine/clock";
import { propertyValue } from "../../../packages/animation";
import {
  typographyStyles,
  textTreatments,
  socialSafeArea,
  type TypographyStyle,
  type TextTreatment,
} from "../../../packages/typography/model";
import {
  applyTextPreset,
  profiles,
} from "../../../packages/typography/commands";
import { layoutText } from "../../../packages/typography/render";
import { NumberField } from "./Controls";
export function TypographyControls({ clip }: { clip: Clip }) {
  const execute = useEditor((s) => s.executeScoped),
    { frame } = useClock();
  const [style, setStyle] = useState<TypographyStyle>("Minimal"),
    [treatment, setTreatment] = useState<TextTreatment>("Fade"),
    [word, setWord] = useState(0);
  const edit = (name: string, fn: (c: Clip) => void) =>
    execute(name, (p) => {
      const c = editable(p, clip.id);
      if (c) fn(c);
    });
  const emphasis = clip.text.emphasis.find((e) => e.word === word);
  return (
    <>
      <label>
        Typography preset
        <select
          aria-label="Typography preset"
          value={style}
          onChange={(e) => {
            const v = e.target.value as TypographyStyle;
            setStyle(v);
            setTreatment(profiles[v].treatment);
          }}
        >
          {typographyStyles.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Animation treatment
        <select
          aria-label="Text animation treatment"
          value={treatment}
          onChange={(e) => setTreatment(e.target.value as TextTreatment)}
        >
          {textTreatments.map((t) => (
            <option
              key={t}
              disabled={
                t === "Karaoke Highlight" && !clip.text.wordStarts?.length
              }
            >
              {t}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={
          treatment === "Karaoke Highlight" && !clip.text.wordStarts?.length
        }
        onClick={() =>
          execute(
            "Replace text treatment",
            applyTextPreset(clip.id, style, treatment),
          )
        }
      >
        Apply text treatment
      </button>
      <p className="field-hint">
        Creates editable curves, replacing this layer's entrance. Karaoke uses
        existing word timestamps.
      </p>
      {(
        [
          ["Tracking", "tracking", -10, 100, 0.5],
          ["Text reveal", "reveal", 0, 1, 0.01],
          ["Highlighted word", "highlight", -1, 10000, 1],
        ] as const
      ).map(([label, key, min, max, step]) => (
        <NumberField
          key={key}
          label={label}
          value={propertyValue(clip, key, frame)}
          min={min}
          max={max}
          step={step}
          onChange={(v) =>
            execute(`Set ${label}`, setProperty(clip.id, key, v, frame))
          }
        >
          <button
            aria-label={`Toggle ${label} keyframe`}
            onClick={() =>
              execute(`Keyframe ${label}`, toggleKeyframe(clip.id, key, frame))
            }
          >
            ◇
          </button>
        </NumberField>
      ))}
      {(
        [
          ["Line spacing", "lineSpacing", 0.5, 3, 0.05],
          ["Active word scale", "highlightScale", 1, 1.5, 0.05],
          ["Text wrap width", "maxWidth", 0, 8192, 1],
          ["Text stroke width", "strokeWidth", 0, 40, 0.5],
          ["Text shadow blur", "shadowBlur", 0, 100, 1],
          ["Text shadow X", "shadowX", -100, 100, 1],
          ["Text shadow Y", "shadowY", -100, 100, 1],
          ["Text background opacity", "backgroundOpacity", 0, 1, 0.05],
          ["Text background radius", "backgroundRadius", 0, 1000, 1],
          ["Text padding", "padding", 0, 100, 1],
        ] as const
      ).map(([label, key, min, max, step]) => (
        <NumberField
          key={key}
          label={label}
          value={clip.text[key]}
          min={min}
          max={max}
          step={step}
          onChange={(v) =>
            edit(`Set ${label}`, (c) => {
              c.text[key] = v;
            })
          }
        />
      ))}
      {(
        [
          ["Highlight color", "highlightColor"],
          ["Text stroke color", "strokeColor"],
          ["Text shadow color", "shadowColor"],
          ["Text background color", "backgroundColor"],
        ] as const
      ).map(([label, key]) => (
        <label key={key}>
          {label}
          <input
            type="color"
            aria-label={label}
            value={clip.text[key]}
            onChange={(e) =>
              edit(`Set ${label}`, (c) => {
                c.text[key] = e.target.value;
              })
            }
          />
        </label>
      ))}
      <label>
        Reveal units
        <select
          aria-label="Reveal units"
          value={clip.text.revealUnit}
          onChange={(e) =>
            edit("Set reveal units", (c) => {
              c.text.revealUnit = e.target.value as Clip["text"]["revealUnit"];
            })
          }
        >
          <option value="words">Words</option>
          <option value="characters">Characters</option>
          <option value="phrases">Phrases</option>
        </select>
      </label>
      <label>
        Motion direction
        <select
          aria-label="Text motion direction"
          value={clip.text.direction}
          onChange={(e) =>
            edit("Set text motion direction", (c) => {
              c.text.direction = e.target.value as Clip["text"]["direction"];
            })
          }
        >
          {["left", "right", "up", "down"].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label>
        Emphasized word
        <select
          aria-label="Emphasized word"
          value={word}
          onChange={(e) => setWord(Number(e.target.value))}
        >
          {clip.text.content
            .trim()
            .split(/\s+/)
            .map((s, i) => (
              <option key={i} value={i}>
                {i + 1}: {s}
              </option>
            ))}
        </select>
      </label>
      <NumberField
        label="Word emphasis scale"
        min={0.5}
        max={2}
        step={0.05}
        value={emphasis?.scale ?? 1}
        onChange={(v) =>
          edit("Set word emphasis", (c) => {
            const old = c.text.emphasis.find((e) => e.word === word);
            if (old) old.scale = v;
            else
              c.text.emphasis.push({
                word,
                scale: v,
                color: c.text.color,
                weight: "bold",
              });
          })
        }
      />
      <label>
        Word emphasis color
        <input
          type="color"
          aria-label="Word emphasis color"
          value={emphasis?.color ?? clip.text.color}
          onChange={(e) =>
            edit("Set word emphasis color", (c) => {
              const old = c.text.emphasis.find((x) => x.word === word);
              if (old) old.color = e.target.value;
              else
                c.text.emphasis.push({
                  word,
                  scale: 1,
                  color: e.target.value,
                  weight: "bold",
                });
            })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          aria-label="Social safe area"
          checked={clip.text.safeZone}
          onChange={(e) =>
            edit("Set social safe-area preference", (c) => {
              c.text.safeZone = e.target.checked;
            })
          }
        />
        Social safe area
      </label>
      <button
        disabled={!clip.text.safeZone}
        onClick={() =>
          execute("Fit text to social safe area", (p) => {
            const c = editable(p, clip.id);
            if (!c) return;
            const s = socialSafeArea(p.settings.width, p.settings.height),
              ctx = document.createElement("canvas").getContext("2d")!;
            c.text.maxWidth = s.right - s.left;
            let l = layoutText(ctx, c.text);
            const factor = Math.min(
              1,
              (s.right - s.left) / l.width,
              (s.bottom - s.top) / l.height,
            );
            c.text.size = Math.max(6, c.text.size * factor);
            l = layoutText(ctx, c.text);
            const x = (s.left + s.right - p.settings.width) / 2,
              y =
                Math.max(
                  s.top + l.height / 2,
                  Math.min(
                    s.bottom - l.height / 2,
                    c.transform.y + p.settings.height / 2,
                  ),
                ) -
                p.settings.height / 2;
            for (const [key, value] of [
              ["x", x],
              ["y", y],
            ] as const) {
              const delta = value - c.transform[key];
              c.transform[key] = value;
              for (const k of c.keyframes[key]) k.value += delta;
            }
          })
        }
      >
        Fit text to safe area
      </button>
      <p className="field-hint">
        Top 14%, bottom 25%, right 18% reserved. Transform controls allow
        intentional overrides. Background words are decorative layers; no
        subject mask is implied.
      </p>
    </>
  );
}
