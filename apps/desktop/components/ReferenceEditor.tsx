import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useMemo,
} from "react";
import { useEditor } from "../../../packages/editor-state";
import { type Asset, fps } from "../../../packages/project-schema";
import {
  desktop,
  sourceUrl,
  importBrowser,
  importNative,
} from "../../../packages/platform";
import { readLocal, writeLocal } from "../../../packages/platform/storage";
import { compositionView } from "../../../packages/commands/compositions";
import { backgroundJobs } from "../../../packages/jobs";
import {
  applyEditPreview,
  isEditPreviewCurrent,
} from "../../../packages/ai/editor-agent/execution";
import {
  defaults,
  type Controls,
} from "../../../packages/ai/reference/planner";
import {
  modes,
  dnaSchema,
  type StyleDNA,
} from "../../../packages/ai/reference/dna";
import { recreate } from "../../../packages/ai/reference/service";
import { SequencePreview } from "./SequencePreview";
import "./reference-editor.css";
type Result = Extract<
  Awaited<ReturnType<typeof recreate>["finished"]>,
  { state: "Completed" }
>["result"];
function useMediaUrl(asset?: Asset) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    setUrl("");
    if (asset)
      void sourceUrl(asset)
        .then((s) => {
          if (active) setUrl(s);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [asset?.id, asset?.fingerprint]);
  return url;
}
function SourceThumb({ asset }: { asset: Asset }) {
  const url = useMediaUrl(asset);
  return url ? (
    <video aria-label={asset.name} muted preload="metadata" src={url} />
  ) : null;
}
export function ReferenceEditor() {
  const project = useEditor((s) => s.project),
    revision = useEditor((s) => s.revision),
    state = useEditor.getState;
  const [reference, setReference] = useState(""),
    [raw, setRaw] = useState<string[]>([]),
    [music, setMusic] = useState(""),
    [voice, setVoice] = useState(""),
    [controls, setControls] = useState<Controls>(defaults),
    [result, setResult] = useState<Result | null>(null),
    [jobId, setJob] = useState(""),
    [error, setError] = useState(""),
    [profiles, setProfiles] = useState<StyleDNA[]>([]),
    [saved, setSaved] = useState(""),
    [profileIndex, setProfile] = useState(-1);
  const chosen = project.assets.find((a) => a.id === reference),
    url = useMediaUrl(chosen),
    refVideo = useRef<HTMLVideoElement>(null),
    videos = project.assets.filter((a) => a.kind === "video"),
    sounds = project.assets.filter((a) => a.kind === "audio");
  const jobs = useSyncExternalStore(
      backgroundJobs.subscribe,
      backgroundJobs.getSnapshot,
    ),
    job = jobs.find((j) => j.id === jobId),
    busy = job?.state === "Running" || job?.state === "Queued",
    canApply =
      result && isEditPreviewCurrent(result.preview, project, revision);
  const filePicker = useRef<HTMLInputElement>(null),
    target = useRef<"reference" | "raw">("raw"),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void readLocal<unknown[]>("state", "style-dna-v1")
      .then((xs) => {
        if (mounted.current)
          setProfiles(
            (xs ?? []).flatMap((x) => {
              const a = dnaSchema.safeParse(x);
              return a.success ? [a.data] : [];
            }),
          );
      })
      .catch((e) => setError(String(e)));
    return () => {
      mounted.current = false;
    };
  }, []);
  const view = useMemo(
    () =>
      result
        ? compositionView(
            result.preview.project,
            result.preview.plan.resultCompositionId!,
          )
        : null,
    [result],
  );
  function invalidate() {
    setResult(null);
    setSaved("");
    setError("");
  }
  function pick(role: "reference" | "raw", ids: string[]) {
    invalidate();
    if (role === "reference") {
      setReference(ids[0] ?? "");
      setRaw((a) => a.filter((id) => id !== ids[0]));
      setProfile(-1);
    } else
      setRaw((a) => [
        ...new Set([...a, ...ids.filter((id) => id && id !== reference)]),
      ]);
  }
  async function ingest(role: "reference" | "raw", files?: File[]) {
    setError("");
    const projectId = project.id;
    try {
      const res = files ? await importBrowser(files) : await importNative();
      if (!mounted.current || state().project.id !== projectId) return;
      const valid = res.imported
        .map((x) => x.asset)
        .filter(
          (a) => a.kind === "video" || (role === "raw" && a.kind === "audio"),
        );
      if (!valid.length) {
        if (res.errors.length || res.imported.length)
          setError(res.errors.join("\n") || "Select video footage");
        return;
      }
      const incoming = role === "reference" ? valid.slice(0, 1) : valid;
      state().execute("Import recreation inputs", (p) => {
        for (const a of incoming)
          if (
            !p.assets.some((existing) => existing.fingerprint === a.fingerprint)
          )
            p.assets.push(a);
      });
      const imported = incoming.map((a) =>
        state().project.assets.find((b) => a.fingerprint === b.fingerprint)!,
      );
      pick(
        role,
        imported.filter((a) => a.kind === "video").map((a) => a.id),
      );
      const sound = imported.find((a) => a.kind === "audio");
      if (sound) setMusic(sound.id);
      if (res.errors.length) setError(res.errors.join("\n"));
    } catch (e) {
      setError(String(e));
    }
  }
  const importTo = (role: "reference" | "raw") => {
    target.current = role;
    if (desktop) void ingest(role);
    else filePicker.current?.click();
  };
  function drop(e: React.DragEvent, role: "reference" | "raw") {
    e.preventDefault();
    if (busy) return;
    const id = e.dataTransfer.getData("application/x-supp-asset");
    if (videos.some((a) => a.id === id)) {
      pick(role, [id]);
      return;
    }
    if (e.dataTransfer.files.length) {
      if (desktop) importTo(role);
      else void ingest(role, Array.from(e.dataTransfer.files));
    }
  }
  async function generate() {
    invalidate();
    try {
      const task = recreate(
        project,
        revision,
        {
          reference,
          raw,
          music: music || undefined,
          voice: voice || undefined,
        },
        controls,
        profiles[profileIndex],
      );
      setJob(task.id);
      const out = await task.finished;
      if (!mounted.current) return;
      if (out.state === "Completed") setResult(out.result);
      else if (out.state === "Failed") setError(out.error);
    } catch (e) {
      setError(String(e));
    }
  }
  async function saveDNA() {
    if (!result) return;
    try {
      const next = [
        {
          ...result.dna,
          text:
            result.dna.text?.map(
              ({ content: _content, ...geometry }) => geometry,
            ) ?? null,
        },
        ...profiles.filter((p) => p.name !== result.dna.name),
      ].slice(0, 24);
      await writeLocal("state", "style-dna-v1", next);
      setProfiles(next);
      setSaved("Profile saved on this device");
    } catch (e) {
      setError(String(e));
    }
  }
  const update = (v: Partial<Controls>) => {
    invalidate();
    setControls((c) => ({ ...c, ...v }));
  };
  return (
    <section className="reference-editor" aria-label="Recreate an edit">
      <h2>Recreate an edit</h2>
      <fieldset disabled={busy}>
        <div className="reference-inputs">
          {(["reference", "raw"] as const).map((role) => (
            <div
              key={role}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, role)}
            >
              <h3>
                {role === "reference" ? "Reference video" : "My raw footage"}
              </h3>
              <button onClick={() => importTo(role)}>
                {role === "reference"
                  ? "Import reference"
                  : "Import footage or audio"}
              </button>
              <select
                aria-label={
                  role === "reference" ? "Reference video" : "Add raw video"
                }
                value={role === "reference" ? reference : ""}
                onChange={(e) => pick(role, [e.target.value])}
              >
                <option value="">
                  {role === "reference"
                    ? "Choose finished video"
                    : "Choose footage"}
                </option>
                {videos
                  .filter(
                    (a) =>
                      role === "reference" ||
                      (a.id !== reference && !raw.includes(a.id)),
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              {role === "reference" && chosen && <SourceThumb asset={chosen} />}
              {role === "raw" &&
                raw.map((id, i) => {
                  const a = videos.find((a) => a.id === id);
                  return (
                    a && (
                      <div className="raw-row" key={id}>
                        <SourceThumb asset={a} />
                        <span>{a.name}</span>
                        <button
                          aria-label={"Move up " + a.name}
                          disabled={!i}
                          onClick={() => {
                            invalidate();
                            setRaw((old) => {
                              const next = [...old];
                              [next[i - 1], next[i]] = [next[i], next[i - 1]];
                              return next;
                            });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={"Remove " + a.name}
                          onClick={() => {
                            invalidate();
                            setRaw((old) => old.filter((id) => id !== a.id));
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )
                  );
                })}
            </div>
          ))}
        </div>
        <input
          type="file"
          hidden
          ref={filePicker}
          multiple
          accept="video/*,audio/*"
          onChange={(e) => {
            void ingest(target.current, Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <div className="reference-options">
          {(["Music", "Voiceover"] as const).map((label) => (
            <label key={label}>
              {label}
              <select
                value={label === "Music" ? music : voice}
                onChange={(e) => {
                  invalidate();
                  (label === "Music" ? setMusic : setVoice)(e.target.value);
                }}
              >
                <option value="">None</option>
                {sounds.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Recreation mode
            <select
              value={controls.mode}
              onChange={(e) =>
                update({ mode: e.target.value as Controls["mode"] })
              }
            >
              {modes.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Reference text
            <select
              aria-label="Reference text"
              value={controls.wording}
              onChange={(e) =>
                update({ wording: e.target.value as Controls["wording"] })
              }
            >
              <option value="adapt">Adapt to my footage</option>
              <option value="original">Preserve original words</option>
              <option value="omit">Omit reference titles</option>
            </select>
          </label>
          {controls.wording === "original" && (
            <p>
              Review the locally recognized words in Preview before applying.
            </p>
          )}
          {profiles.length > 0 && controls.wording !== "original" && (
            <label>
              Style profile
              <select
                value={profileIndex}
                onChange={(e) => {
                  invalidate();
                  setProfile(Number(e.target.value));
                }}
              >
                <option value={-1}>Analyze reference</option>
                {profiles.map((p, i) => (
                  <option value={i} key={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label>
          Optional instructions
          <textarea
            maxLength={4000}
            value={controls.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </label>
        <details>
          <summary>Style controls</summary>
          {(["pace", "color", "beat"] as const).map((k) => (
            <label key={k}>
              {k} · {controls[k].toFixed(2)}
              <input
                aria-label={"Reference " + k}
                type="range"
                min={k === "pace" ? 0.5 : 0}
                max={k === "pace" ? 2 : 1}
                step=".05"
                value={controls[k]}
                onChange={(e) => update({ [k]: Number(e.target.value) })}
              />
            </label>
          ))}
        </details>
        <button
          disabled={!chosen || !raw.length}
          onClick={() => void generate()}
        >
          Recreate This Style
        </button>
      </fieldset>
      {busy && (
        <p role="status">
          {job?.progress?.detail ?? job?.state}{" "}
          <button onClick={() => backgroundJobs.cancel(jobId)}>Cancel</button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && view && (
        <>
          <h3>Style DNA</h3>
          <p>
            {result.dna.shots.length} measured shots ·{" "}
            {result.dna.shots
              .map((s) => ((s.endMs - s.startMs) / 1000).toFixed(1) + "s")
              .slice(0, 18)
              .join(" / ")}
            {result.dna.bpm ? " · " + Math.round(result.dna.bpm) + " BPM" : ""}
          </p>
          <p>
            {result.dna.color
              ? "Measured luma " +
                result.dna.color.luma.toFixed(2) +
                " · saturation " +
                result.dna.color.saturation.toFixed(2)
              : "Color measurements unavailable"}{" "}
            · {result.matches.length} matched source ranges
          </p>
          <details>
            <summary>Compare shot timing</summary>
            <table>
              <thead>
                <tr>
                  <th>Shot</th>
                  <th>Reference</th>
                  <th>Generated</th>
                  <th>Raw source</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => (
                  <tr key={m.start}>
                    <td>{i + 1}</td>
                    <td>{(m.referenceMs / 1000).toFixed(2)}s</td>
                    <td>{(m.start / fps(view)).toFixed(2)}s</td>
                    <td>
                      {project.assets.find((a) => a.id === m.source)?.name} ·{" "}
                      {(m.sourceIn / fps(view)).toFixed(2)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {view.clips.some((c) => c.kind === "text") && (
            <details>
              <summary>Review title wording</summary>
              <ol>
                {view.clips
                  .filter((c) => c.kind === "text")
                  .map((c) => (
                    <li key={c.id}>{c.text.content}</li>
                  ))}
              </ol>
            </details>
          )}
          <button onClick={() => void saveDNA()}>Save Style DNA</button> {saved}
          <div className="reference-compare">
            <figure>
              <figcaption>Reference</figcaption>
              <video ref={refVideo} muted src={url} />
            </figure>
            <div>
              Generated result
              <SequencePreview
                project={view}
                onFrame={(f) => {
                  const video = refVideo.current;
                  if (video && Number.isFinite(video.duration)) {
                    const cut = result.matches.find(
                      (m) => f >= m.start && f < m.start + m.duration,
                    );
                    const t = cut
                      ? (cut.referenceMs +
                          ((cut.referenceEndMs - cut.referenceMs) *
                            (f - cut.start)) /
                            cut.duration) /
                        1000
                      : f / fps(view);
                    if (Math.abs(video.currentTime - t) > 0.06)
                      video.currentTime = Math.min(video.duration, t);
                  }
                }}
              />
            </div>
          </div>
          <p>
            {result.dna.text === null
              ? "Text measurement unavailable"
              : result.dna.text.length + " transient text intervals"}{" "}
            · {view.clips.filter((c) => c.timeRemap).length} editable motion
            accents · {view.clips.filter((c) => c.kind === "text").length}{" "}
            editable text layers.
          </p>
          <p>
            Reference fades and bounded camera moves can be transferred. Exact
            source speed curves, composited transitions and typefaces require
            additional evidence.
          </p>
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <button
            disabled={!canApply}
            onClick={() => {
              try {
                const s = state();
                s.execute(
                  "Apply reference recreation",
                  applyEditPreview(result.preview, s.project, s.revision),
                );
                s.setComposition(result.preview.plan.resultCompositionId!);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Apply recreation
          </button>
        </>
      )}
    </section>
  );
}
