import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useMemo,
} from "react";
import { useEditor } from "../../../packages/editor-state";
import { AudioEvidence } from "./AudioEvidence";
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
  previewEditPlan,
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
import { termLabels } from "../../../packages/ai/reference/footage-index";
import { measureTitleInk } from "../../../packages/ai/reference/font-match";
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
    [titleChanges, setTitleChanges] = useState<Record<string, string>>({}),
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
      result && isEditPreviewCurrent(result.preview, project, revision),
    // After Apply, a take is swapped in the recreated sequence itself, as an undoable edit.
    appliedTakes = !canApply && !!result?.preview.plan.resultCompositionId && project.compositions.some((c) => c.id === result.preview.plan.resultCompositionId);
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
    setTitleChanges({});
    setSaved("");
    setError("");
  }
  function updateTitlePreview() {
    if (!result || !canApply) return;
    try {
      const plan = result.preview.plan;
      const commands = plan.commands.flatMap((call): typeof plan.commands => {
        if (
          call.tool !== "sequence.text" ||
          !Object.hasOwn(titleChanges, call.id)
        )
          return [call];
        const content = titleChanges[call.id].trim();
        if (!content) return [];
        const words = content.split(/\s+/).length;
        // Refit word animation for changed wording. Preserve measured onsets for equal word counts.
        const wordStarts =
          words === call.wordStarts?.length ? call.wordStarts : undefined;
        let measuredInk = call.measuredInk;
        if (measuredInk && call.face && content !== call.content) {
          const context = document.createElement("canvas").getContext("2d");
          const metrics =
            context &&
            measureTitleInk(
              context,
              content,
              call.face.family,
              call.face.weight,
            );
          measuredInk = metrics ? { ...measuredInk, ...metrics } : undefined;
        }
        return [{ ...call, content, wordStarts, measuredInk }];
      });
      const preview = previewEditPlan({ ...plan, commands }, project, revision);
      setResult({ ...result, preview });
      setTitleChanges({});
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  /** Swap one shot's source moment for an alternative; nothing is re-analysed. Before Apply the
   * preview is rebuilt; after Apply the recreated sequence's clip is edited (undoable). */
  function chooseTake(index: number, alt: NonNullable<Result["matches"][number]["alternatives"]>[number]) {
    if (!result || (!canApply && !appliedTakes)) return;
    try {
      const m = result.matches[index],
        asset = project.assets.find((a) => a.id === alt.sourceId);
      if (!asset) throw Error("That footage is no longer in the project.");
      const rate = fps(project),
        sourceIn = Math.round((alt.inMs * rate) / 1000);
      // A take from a slightly short cut-safe stretch plays mildly slowed: rescale this clip's
      // speed curve (or add a constant one) so the edit timing never changes.
      const was = m.speed ?? 1,
        speed = alt.speed ?? 1;
      let commands = result.preview.plan.commands.map((call) =>
        call.tool === "sequence.insert" && call.clipId === m.clipId ? { ...call, assetId: asset.id, fingerprint: asset.fingerprint, sourceIn } : call,
      );
      if (speed !== was) {
        const curve = commands.find((call) => call.tool === "sequence.speed" && call.clipId === m.clipId);
        if (curve && curve.tool === "sequence.speed") {
          const keys = curve.curve.keys.map((k) => ({ ...k, speed: (k.speed * speed) / was }));
          const constant = keys.every((k) => Math.abs(k.speed - 1) < 1e-6);
          commands = constant ? commands.filter((call) => call !== curve) : commands.map((call) => (call === curve ? { ...curve, curve: { ...curve.curve, keys } } : call));
        } else if (speed < 1) {
          const at = commands.findIndex((call) => call.tool === "sequence.insert" && call.clipId === m.clipId);
          const sequenceId = (commands[at] as { sequenceId: string }).sequenceId;
          commands.splice(at + 1, 0, { tool: "sequence.speed", sequenceId, clipId: m.clipId, curve: { sourceOffset: 0, keys: [{ frame: 0, speed, easing: "smooth" }, { frame: m.duration, speed, easing: "smooth" }] } });
        }
      }
      const previous = { sourceId: m.source, inMs: Math.round((m.sourceIn * 1000) / rate), outMs: Math.round(((m.sourceIn + m.duration * was) * 1000) / rate), speed: was, score: 0, match: m.match ?? {}, lostOn: "the take chosen before" };
      const matches = result.matches.map((x, k) =>
        k === index ? { ...x, source: asset.id, sourceIn, speed, match: alt.match, alternatives: [previous, ...(x.alternatives ?? []).filter((a) => a !== alt)] } : x,
      );
      if (canApply) setResult({ ...result, preview: previewEditPlan({ ...result.preview.plan, commands }, project, revision), matches });
      else {
        const s = state();
        s.setComposition(result.preview.plan.resultCompositionId!);
        s.executeScoped("Choose another take", (p) => {
          const clip = p.clips.find((c) => c.id === m.clipId);
          if (!clip) throw Error("That shot is no longer in the recreated sequence.");
          clip.assetId = asset.id;
          clip.sourceIn = sourceIn;
          if (speed !== was) {
            if (clip.timeRemap) {
              for (const k of clip.timeRemap.keys) k.speed = (k.speed * speed) / was;
              if (clip.timeRemap.keys.every((k) => Math.abs(k.speed - 1) < 1e-6)) clip.timeRemap = undefined;
            } else if (speed < 1)
              clip.timeRemap = { sourceOffset: 0, keys: [{ frame: 0, speed, easing: "smooth" }, { frame: clip.duration, speed, easing: "smooth" }] };
          }
        });
        setResult({ ...result, matches });
      }
      setError("");
    } catch (e) {
      setError(String(e));
    }
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
              ({
                content: _content,
                glyphRows: _glyphs,
                templateRows: _template,
                geometry: samples,
                ...style
              }) => ({
                ...style,
                geometry: samples?.map(({ rows: _rows, ...box }) => box),
              }),
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
      <header className="re-head">
        <div>
          <h2>Recreate an edit</h2>
          <p className="re-sub">Match a finished reel's cuts, titles, colour and sound with your own footage. Everything stays editable.</p>
        </div>
        <ol className="re-steps" aria-label="Progress">
          {[
            ["Sources", !!chosen && raw.length > 0],
            ["Style", !!chosen && raw.length > 0],
            ["Preview", !!result],
            ["Apply", false],
          ].map(([label, done], i, all) => {
            const current = all.findIndex(([, d]) => !d);
            return (
              <li key={String(label)} className={done ? "done" : i === current ? "current" : ""} aria-current={i === current ? "step" : undefined}>
                <span>{i + 1}</span>
                {label}
              </li>
            );
          })}
        </ol>
      </header>
      <fieldset disabled={busy}>
        <div className="re-grid">
        <div className="re-card">
        <h3 className="re-card-title">Sources</h3>
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
        </div>
        <div className="re-card">
        <h3 className="re-card-title">Style</h3>
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
                update({ mode: e.target.value as Controls["mode"], interval: undefined })
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
          <label>
            Output framing
            <select
              aria-label="Output framing"
              value={controls.format ?? "reference"}
              onChange={(e) =>
                update({ format: e.target.value as Controls["format"] })
              }
            >
              <option value="vertical">
                9:16 · protect subjects, fill background
              </option>
              <option value="reference">Reference aspect ratio</option>
            </select>
          </label>
          <label>
            Audio
            <select
              aria-label="Audio mode"
              value={controls.audio ?? "music"}
              onChange={(e) => update({ audio: e.target.value as Controls["audio"] })}
            >
              <option value="music">Supplied music</option>
              <option value="reference">Use reference audio · editable clip</option>
              <option value="recreate">Recreate audio structure with supplied music</option>
            </select>
          </label>
          <label>
            Text layering
            <select
              aria-label="Text layering"
              value={controls.subjectLayering ?? "flat"}
              onChange={(e) =>
                update({
                  subjectLayering: e.target
                    .value as Controls["subjectLayering"],
                })
              }
            >
              <option value="reference">Follow measured reference depth</option>
              <option value="flat">In front</option>
              <option value="behind-people">
                Behind people · local mask model
              </option>
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
          {controls.mode === "Close Match" && <label>
            <input type="checkbox" checked={!!controls.interval} onChange={e=>update({interval:e.target.checked?{startMs:0,endMs:Math.min(4000,Math.round((chosen?.duration??4)*1000))}:undefined})}/>
            Reconstruct a focused title interval
          </label>}
          {controls.interval && <>{(["startMs","endMs"] as const).map(k=><label key={k}>
            {k==="startMs"?"Reference in (seconds)":"Reference out (seconds)"}
            <input type="number" step="0.001" min="0" value={controls.interval![k]/1000}
              onChange={e=>update({interval:{...controls.interval!,[k]:Math.round(Number(e.target.value)*1000)}})}/>
          </label>)}<label>Visually reviewed words (optional, one time in seconds and word per line)
            <textarea value={controls.reviewedTitleCues??""} maxLength={1000} onChange={e=>update({reviewedTitleCues:e.target.value})}/></label></>}
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
        </div>
        </div>
        <div className="re-actionbar">
          <p className="re-summary">
            {chosen ? chosen.name : "No reference yet"} · {raw.length} raw clip{raw.length === 1 ? "" : "s"} · {controls.mode} ·{" "}
            {{ music: "supplied music", reference: "reference audio", recreate: "recreated audio structure" }[controls.audio ?? "music"]}
            {controls.interval ? ` · ${(controls.interval.startMs / 1000).toFixed(1)}–${(controls.interval.endMs / 1000).toFixed(1)} s` : ""}
          </p>
          <button className="re-primary" disabled={!chosen || !raw.length} onClick={() => void generate()}>
            Recreate This Style
          </button>
        </div>
      </fieldset>
      {busy && (
        <p role="status" className="re-status">
          {!!job?.progress?.total && (
            <progress className="re-progress" value={job.progress.completed} max={job.progress.total} aria-label="Recreation progress" />
          )}
          {job?.progress?.detail ?? job?.state}{" "}
          <button onClick={() => backgroundJobs.cancel(jobId)}>Cancel</button>
        </p>
      )}
      {error && (
        <p role="alert" className="re-alert">
          {error}
        </p>
      )}
      {result && view && (
        <div className="re-results">
          <h3>Style DNA</h3>
          <div className="re-stats">
            <p className="re-stat">
              <b>{result.dna.shots.length}</b> shots
            </p>
            <p className="re-stat">
              <b>{result.dna.bpm ? Math.round(result.dna.bpm) : "–"}</b> BPM
            </p>
            <p className="re-stat">
              <b>{result.matches.length}</b> matched ranges
            </p>
            <p className="re-stat">
              <b>{view.clips.filter((c) => c.kind === "text").length}</b> editable titles
            </p>
          </div>
          {result.coverage && (
            <p className="re-muted">
              Raw footage searched end to end: {(result.coverage.suppliedMs / 1000).toFixed(1)} s supplied across {result.coverage.clips} clip
              {result.coverage.clips === 1 ? "" : "s"}, {(result.coverage.analyzedMs / 1000).toFixed(1)} s analysed, {result.coverage.segments} cut-safe stretches (
              {result.coverage.cuts} frame-accurate cuts), {result.coverage.candidates} candidate moments, {result.coverage.used} used, final edit{" "}
              {(result.coverage.finalMs / 1000).toFixed(1)} s.
              {result.analysisProfile && (
                <>
                  {" "}
                  Analysis: {(result.analysisProfile.footageWallMs / 1000).toFixed(0)} s for {(result.analysisProfile.footageMs / 1000).toFixed(0)} s of footage,{" "}
                  {result.analysisProfile.clips.flatMap((c) => c.stages).filter((s) => s.reused).length} of {result.analysisProfile.clips.flatMap((c) => c.stages).length} stages
                  reused from cache.
                </>
              )}
            </p>
          )}
          <p className="re-muted">
            {result.dna.shots.length} measured shots ·{" "}
            {result.dna.shots
              .map((s) => ((s.endMs - s.startMs) / 1000).toFixed(1) + "s")
              .slice(0, 18)
              .join(" / ")}
            {result.dna.bpm ? " · " + Math.round(result.dna.bpm) + " BPM" : ""}
          </p>
          <p className="re-muted">
            {result.dna.color
              ? "Measured luma " +
                result.dna.color.luma.toFixed(2) +
                " · saturation " +
                result.dna.color.saturation.toFixed(2)
              : "Color measurements unavailable"}{" "}
            · {result.matches.length} matched source ranges
          </p>
          <AudioEvidence dna={result.dna} commands={result.preview.plan.commands} />
          {!!result.dna.transitions.length && (
            <details>
              <summary>Transition evidence</summary>
              <p>
                Evidence strength is a rule score, not a calibrated probability.
                Uncertain or unsupported effects retain a cut.
              </p>
              <ul>
                {result.dna.transitions.map((t) => (
                  <li key={t.cutMs}>
                    {(t.cutMs / 1000).toFixed(2)}s · {t.kind} · evidence{" "}
                    {Math.round(t.confidence * 100)}/100
                    {" · "}
                    {t.evidence.join(" ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details open>
            <summary>Why each source moment was chosen</summary>
            <p className="re-muted">
              Every raw clip is searched over its whole length, never across a cut. Each reference shot gets the moment that moves the same way (body trajectory, where
              the movement is, its curve over time) and plays the same role; its action peak is placed on the shot's strongest audio event, else on its own movement
              peak. Choose another take to swap one shot without rebuilding.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Shot</th>
                  <th>Source moment</th>
                  <th>Match</th>
                  <th>Alternatives</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m, i) => {
                  const name = (id: string) => project.assets.find((a) => a.id === id)?.name ?? id;
                  const rate = fps(view);
                  const match = m.match ?? {};
                  const overall = Object.keys(match).length ? Object.values(match).reduce((a, b) => a + b, 0) / Object.keys(match).length : undefined;
                  return (
                    <tr key={"why" + m.clipId}>
                      <td>
                        {i + 1}
                        <br />
                        <span className="re-muted">
                          {(m.referenceMs / 1000).toFixed(2)}–{(m.referenceEndMs / 1000).toFixed(2)} s
                        </span>
                        {m.role && (
                          <>
                            <br />
                            <span className="re-tag">{m.role}</span>
                          </>
                        )}
                        {m.confidence && (
                          <>
                            <br />
                            <span className={m.confidence === "low" ? "re-tag warn" : "re-tag"}>{m.confidence} confidence</span>
                          </>
                        )}
                      </td>
                      <td>
                        {name(m.source)} @ {(m.sourceIn / rate).toFixed(2)}–{((m.sourceIn + m.duration) / rate).toFixed(2)} s
                        {m.peak?.source === "audio event" && (
                          <>
                            <br />
                            <span className="re-tag">action peak on audio event at {Math.round(m.peak.fraction * 100)}%</span>
                          </>
                        )}
                        {m.peak?.source === "reference motion" && (
                          <>
                            <br />
                            <span className="re-tag">action peak on the reference's movement peak at {Math.round(m.peak.fraction * 100)}%</span>
                          </>
                        )}
                        {m.speed !== undefined && m.speed < 1 && (
                          <>
                            <br />
                            <span className="re-tag warn">slowed to {Math.round(m.speed * 100)}%: the cut-safe stretch is shorter than the shot</span>
                          </>
                        )}
                        {m.reuse?.intentional && (
                          <>
                            <br />
                            <span className="re-tag">reused: {m.reuse.reason}</span>
                          </>
                        )}
                        {m.shortfall && (
                          <>
                            <br />
                            <span className="re-tag warn">{m.shortfall}</span>
                          </>
                        )}
                        {!!m.reasons?.length && (
                          <ul className="re-reasons">
                            {m.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        {Object.entries(match)
                          .sort((a, b) => b[1] - a[1])
                          .map(([k, v]) => (
                            <span key={k} className="re-meter" style={{ marginRight: 8 }}>
                              {termLabels[k] ?? k}
                              <i>
                                <b style={{ width: `${v * 100}%` }} />
                              </i>
                              {Math.round(v * 100)}%
                            </span>
                          ))}
                        {overall !== undefined && <b> · overall {Math.round(overall * 100)}%</b>}
                        {m.selection === "local" && <span className="re-tag">local match</span>}
                      </td>
                      <td>
                        {(m.alternatives ?? []).map((alt, k) => (
                          <div key={k} className="re-alt">
                            <button disabled={(!canApply && !appliedTakes) || busy} title={Object.entries(alt.match).map(([x, v]) => `${termLabels[x] ?? x} ${Math.round(v * 100)}%`).join(" · ")} onClick={() => chooseTake(i, alt)}>
                              Choose another take: {name(alt.sourceId)} @ {(alt.inMs / 1000).toFixed(2)} s
                            </button>
                            <span className="re-muted">{alt.lostOn}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
          <details>
            <summary>Compare shot timing</summary>
            <table>
              <thead>
                <tr>
                  <th>Shot</th>
                  <th>Reference</th>
                  <th>Generated</th>
                  <th>Raw source</th>
                  <th>Chosen for</th>
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
                    <td>
                      {Object.entries(m.why ?? {})
                        .filter(([, v]) => v > 0.05)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4)
                        .map(([k, v]) => k + " " + v.toFixed(2))
                        .join(" · ")}
                      {Object.entries(m.why ?? {}).some(([, v]) => v < 0) ? " · penalty " + Object.entries(m.why ?? {}).filter(([, v]) => v < 0).map(([k]) => k).join(", ") : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {result.dna.text?.some((t) => t.evidence?.kind === "unresolved") && (
            <details>
              <summary>Uncertain reference wording</summary>
              <ul>
                {result.dna.text
                  .filter((t) => t.evidence?.kind === "unresolved")
                  .map((t, i) => (
                    <li key={i}>
                      {(t.startMs / 1000).toFixed(2)}–
                      {(t.endMs / 1000).toFixed(2)} s ·{" "}
                      {t.content ?? "Unreadable"} (omitted)
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {view.clips.some((c) => c.kind === "text") && (
            <details>
              <summary>Review title wording</summary>
              <ol>
                {view.clips
                  .filter((c) => c.kind === "text")
                  .map((c, i) => (
                    <li key={c.id}>
                      {result.preview.plan.commands.some(
                        (call) =>
                          call.tool === "sequence.text" && call.id === c.id,
                      ) ? (
                        <label>
                          Title {i + 1} · {(c.start / fps(view)).toFixed(2)} s
                          <input
                            aria-label={`Title ${i + 1} wording`}
                            maxLength={500}
                            disabled={!canApply || busy}
                            value={titleChanges[c.id] ?? c.text.content}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTitleChanges((previous) => {
                                const next = { ...previous };
                                if (value === c.text.content) delete next[c.id];
                                else next[c.id] = value;
                                return next;
                              });
                            }}
                          />
                        </label>
                      ) : (
                        c.text.content
                      )}
                    </li>
                  ))}
              </ol>
              {Object.keys(titleChanges).length > 0 && (
                <>
                  <p>Empty titles will be removed from the preview.</p>
                  <button
                    disabled={!canApply || busy}
                    onClick={updateTitlePreview}
                  >
                    Update title preview
                  </button>
                </>
              )}
            </details>
          )}
          <p className="re-row">
            <button onClick={() => void saveDNA()}>Save Style DNA</button> {saved}
          </p>
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
          <p className="re-muted">
            {result.dna.text === null
              ? "Text measurement unavailable"
              : result.dna.text.length + " transient text intervals"}{" "}
            · {view.clips.filter((c) => c.timeRemap).length} editable motion
            accents · {view.clips.filter((c) => c.kind === "text").length}{" "}
            editable text layers.
          </p>
          <p className="re-muted">
            Reference fades and bounded camera moves can be transferred. Exact
            source speed curves, composited transitions and typefaces require
            additional evidence.
          </p>
          {result.warnings.length > 0 && (
            <div className="re-notes">
              {result.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}
          <div className="re-actionbar">
          <p className="re-summary">Apply adds a new sequence; Undo removes it again.</p>
          <button
            className="re-primary"
            disabled={!canApply || Object.keys(titleChanges).length > 0}
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
          </div>
        </div>
      )}
    </section>
  );
}
