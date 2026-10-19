import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEditor } from "../../../packages/editor-state";
import { fps } from "../../../packages/project-schema";
import { clock } from "../../../packages/engine/clock";
import { splitClip, deleteClip } from "../../../packages/commands";
import * as platform from "../../../packages/platform";
import {
  readLocal,
  writeLocal,
  type Recovery,
} from "../../../packages/platform/storage";

export function useWorkspaceSession() {
  const project = useEditor((s) => s.project),
    dirty = useEditor((s) => s.dirty),
    workspace = useEditor((s) => s.workspace),
    error = useEditor((s) => s.error),
    notice = useEditor((s) => s.notice),
    history = useEditor((s) => s.historyNames),
    redo = useEditor((s) => s.redoNames);
  const [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState<"new" | "settings" | "commands" | null>(
      null,
    ),
    [recover, setRecover] = useState<Recovery | null>(null),
    [caps, setCaps] = useState<platform.Capabilities | null>(null),
    [savedAt, setSavedAt] = useState(""),
    [pending, setPending] = useState<(() => void) | null>(null),
    [query, setQuery] = useState("");
  const [left, setLeft] = useState(
      () => Number(localStorage.getItem("supp-left")) || 272,
    ),
    [right, setRight] = useState(
      () => Number(localStorage.getItem("supp-right")) || 290,
    ),
    [height, setHeight] = useState(
      () => Number(localStorage.getItem("supp-timeline")) || 290,
    );
  const [theme, setTheme] = useState(
      () => localStorage.getItem("supp-theme") || "dark",
    ),
    [accent, setAccent] = useState(
      () => localStorage.getItem("supp-accent") || "#c3f96b",
    );
  const fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    relink = useRef<string | null>(null),
    programCanvas = useRef<HTMLCanvasElement | null>(null);
  const onCanvas = useCallback((c: HTMLCanvasElement | null) => {
    programCanvas.current = c;
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--accent", accent);
    localStorage.setItem("supp-theme", theme);
    localStorage.setItem("supp-accent", accent);
  }, [theme, accent]);
  useEffect(() => {
    void platform
      .capabilities()
      .then(setCaps)
      .catch(useEditor.getState().report);
    void platform
      .recovery()
      .then(setRecover)
      .catch(useEditor.getState().report);
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined,
      disposed = false,
      chain = Promise.resolve();
    const unsub = useEditor.subscribe((s, old) => {
      if (!s.dirty) {
        clearTimeout(timer);
        return;
      }
      if (s.revision === old.revision) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const snapshot = useEditor.getState();
        chain = chain
          .then(() => platform.autosave(snapshot.project, snapshot.path))
          .then(() => {
            if (!disposed)
              setSavedAt(
                new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              );
          })
          .catch(useEditor.getState().report);
      }, 1500);
    });
    const before = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    let unlisten: (() => void) | undefined;
    if (platform.desktop)
      void getCurrentWindow()
        .onCloseRequested((e) => {
          if (useEditor.getState().dirty) {
            e.preventDefault();
            setPending(() => () => {
              void getCurrentWindow().destroy();
            });
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        });
    return () => {
      disposed = true;
      unsub();
      clearTimeout(timer);
      window.removeEventListener("beforeunload", before);
      unlisten?.();
    };
  }, []);
  function guard(action: () => void) {
    clock.pause();
    if (useEditor.getState().dirty) setPending(() => action);
    else action();
  }
  async function save(saveAs = false) {
    const s = useEditor.getState();
    try {
      const path = await platform.saveProject(s.project, saveAs || !s.path);
      if (path) {
        s.markSaved(s.project, path);
        if (!useEditor.getState().dirty) await platform.discardRecovery();
        s.inform(
          platform.desktop
            ? "Project saved."
            : "Project file downloaded. Browser media stays in local storage.",
        );
        return true;
      }
      return false;
    } catch (e) {
      useEditor.getState().report(e);
      return false;
    }
  }
  function open() {
    guard(() => {
      if (platform.desktop)
        void platform
          .openNative()
          .then((result) => {
            if (result) {
              useEditor.getState().load(result.project, result.path);
              clock.seek(0);
              if (result.missing.length)
                useEditor
                  .getState()
                  .report(
                    `${result.missing.length} source files are offline. Use Relink in the project library.`,
                  );
            }
          })
          .catch(useEditor.getState().report);
      else projectInput.current?.click();
    });
  }
  async function applyImport(result: {
    imported: platform.Imported[];
    errors: string[];
  }) {
    const state = useEditor.getState();
    if (relink.current) {
      const id = relink.current,
        old = state.project.assets.find((a) => a.id === id),
        next = result.imported[0]?.asset;
      relink.current = null;
      if (old && next) {
        platform.validateRelink(state.project, old, next);
        if (!platform.desktop) {
          const file = await readLocal<Blob>("media", next.id);
          if (file) await writeLocal("media", id, file);
          platform.invalidateAsset(id);
          const thumbnail = await readLocal<string>(
            "state",
            `thumbnail:${next.id}`,
          );
          if (thumbnail) {
            await writeLocal("state", `thumbnail:${id}`, thumbnail);
            platform.thumbnails.set(id, thumbnail);
          }
        }
        state.execute("Relink media", (p) => {
          const i = p.assets.findIndex((a) => a.id === id);
          p.assets[i] = { ...next, id };
        });
      }
    } else {
      const known = new Set(state.project.assets.map((a) => a.fingerprint)),
        fresh = result.imported.filter((item) => {
          if (known.has(item.asset.fingerprint)) return false;
          known.add(item.asset.fingerprint);
          return true;
        });
      if (fresh.length)
        state.execute("Import media", (p) => {
          p.assets.push(...fresh.map((i) => i.asset));
        });
      if (result.imported.length && !fresh.length)
        state.inform("These media files are already in the project.");
    }
    if (result.errors.length) state.report(result.errors.join("\n"));
  }
  async function importMedia() {
    if (busy) return;
    relink.current = null;
    if (platform.desktop) {
      setBusy(true);
      try {
        await applyImport(await platform.importNative());
      } catch (e) {
        useEditor.getState().report(e);
      } finally {
        setBusy(false);
      }
    } else fileInput.current?.click();
  }
  async function relinkMedia(id: string) {
    if (platform.desktop) {
      setBusy(true);
      try {
        const next = await platform.relinkNative(id);
        if (next) {
          const s = useEditor.getState(),
            old = s.project.assets.find((a) => a.id === id)!;
          platform.validateRelink(s.project, old, next);
          s.execute("Relink media", (p) => {
            p.assets[p.assets.findIndex((a) => a.id === id)] = next;
          });
        }
      } catch (e) {
        useEditor.getState().report(e);
      } finally {
        setBusy(false);
      }
    } else {
      relink.current = id;
      fileInput.current?.click();
    }
  }
  async function receiveFiles(files: File[]) {
    setBusy(true);
    try {
      await applyImport(await platform.importBrowser(files));
    } catch (e) {
      useEditor.getState().report(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input,textarea,select,[contenteditable]")
      )
        return;
      const mod = e.ctrlKey || e.metaKey,
        s = useEditor.getState(),
        key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setQuery("");
        setDialog("commands");
        return;
      }
      if (e.key === "Escape") {
        setDialog(null);
        s.setSource(null);
        setPending(null);
        return;
      }
      if (dialog || recover || pending || s.source) return;
      if (mod && key === "s") {
        e.preventDefault();
        void save(e.shiftKey);
      } else if (mod && key === "o") {
        e.preventDefault();
        open();
      } else if (mod && key === "n") {
        e.preventDefault();
        guard(() => setDialog("new"));
      } else if (mod && key === "i") {
        e.preventDefault();
        void importMedia();
      } else if (mod && key === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        s.redo();
      } else if (e.code === "Space") {
        e.preventDefault();
        clock.toggle();
      } else if (key === "k") clock.pause();
      else if (key === "l")
        clock.play(
          clock.get().playing && clock.get().speed > 0
            ? Math.min(4, clock.get().speed * 2)
            : 1,
        );
      else if (key === "j")
        clock.play(
          clock.get().playing && clock.get().speed < 0
            ? Math.max(-4, clock.get().speed * 2)
            : -1,
        );
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        clock.pause();
        clock.seek(
          clock.get().frame +
            (e.key === "ArrowRight" ? 1 : -1) *
              (e.shiftKey ? Math.round(fps(s.project)) : 1),
        );
      } else if (key === "s" && s.selected)
        s.execute("Split clip", splitClip(s.selected, clock.get().frame));
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selected) {
        e.preventDefault();
        s.execute("Delete clip", deleteClip(s.selected, e.shiftKey));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function resize(e: React.PointerEvent, kind: "left" | "right" | "height") {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = kind === "height" ? e.clientY : e.clientX,
      value = kind === "left" ? left : kind === "right" ? right : height;
    let last = value;
    const move = (ev: PointerEvent) => {
      const delta = (kind === "height" ? ev.clientY : ev.clientX) - start;
      last = Math.min(
        kind === "height" ? 500 : 450,
        Math.max(
          kind === "height" ? 180 : 210,
          value + (kind === "left" ? delta : -delta),
        ),
      );
      if (kind === "left") setLeft(last);
      else if (kind === "right") setRight(last);
      else setHeight(last);
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener(
      "pointerup",
      () => {
        target.removeEventListener("pointermove", move as EventListener);
        localStorage.setItem(
          kind === "height" ? "supp-timeline" : `supp-${kind}`,
          String(last),
        );
      },
      { once: true },
    );
  }
  const commands = [
    {
      name: "New project",
      key: "Ctrl N",
      run: () => guard(() => setDialog("new")),
    },
    { name: "Open project", key: "Ctrl O", run: open },
    { name: "Save project", key: "Ctrl S", run: () => void save() },
    { name: "Import media", key: "Ctrl I", run: () => void importMedia() },
    { name: "Undo", key: "Ctrl Z", run: () => useEditor.getState().undo() },
    {
      name: "Redo",
      key: "Ctrl Shift Z",
      run: () => useEditor.getState().redo(),
    },
    { name: "Play / pause", key: "Space", run: () => clock.toggle() },
    {
      name: "Split selected clip",
      key: "S",
      run: () => {
        const s = useEditor.getState();
        if (s.selected)
          s.execute("Split clip", splitClip(s.selected, clock.get().frame));
      },
    },
    {
      name: "Export workspace",
      key: "",
      run: () => useEditor.getState().setWorkspace("Export"),
    },
    {
      name: "Preferences & diagnostics",
      key: "",
      run: () => setDialog("settings"),
    },
  ];
  return {
    project,
    dirty,
    workspace,
    error,
    notice,
    history,
    redo,
    busy,
    dialog,
    setDialog,
    recover,
    setRecover,
    caps,
    savedAt,
    pending,
    setPending,
    query,
    setQuery,
    left,
    right,
    height,
    setLeft,
    setRight,
    setHeight,
    theme,
    setTheme,
    accent,
    setAccent,
    fileInput,
    projectInput,
    onCanvas,
    guard,
    save,
    open,
    importMedia,
    relinkMedia,
    receiveFiles,
    resize,
    commands,
  };
}
