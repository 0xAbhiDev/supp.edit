import type React from "react";
import {
  FolderOpen,
  Save,
  Plus,
  Undo2,
  Redo2,
  Settings2,
  Search,
  Command,
  ArrowUpRight,
  X,
  AlertTriangle,
  Check,
  Cpu,
  Keyboard,
  Sparkles,
} from "lucide-react";

import { useEditor, type Workspace } from "../../packages/editor-state";
import { parseProject } from "../../packages/project-schema";
import { clock } from "../../packages/engine/clock";
import { usePlayback } from "../../packages/engine/diagnostics";

import * as platform from "../../packages/platform";

import { Assets } from "./components/Assets";
import { Monitor, SourceViewer } from "./components/Monitor";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
import { ExportPanel } from "./components/ExportPanel";
import { IconButton } from "./components/Controls";

import { useWorkspaceSession } from "./hooks/useWorkspaceSession";
import { Modal, NewProject } from "./components/Dialogs";
import { EngineDiagnostics } from "./components/EngineDiagnostics";

export function App() {
  const renderer = usePlayback((s) => s.renderer);
  const {
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
  } = useWorkspaceSession();
  return (
    <div
      className="app"
      style={
        {
          "--left": `${left}px`,
          "--right": `${right}px`,
          "--timeline": `${height}px`,
        } as React.CSSProperties
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          if (platform.desktop)
            useEditor
              .getState()
              .report("Use Import media to grant native file access.");
          else void receiveFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <header className="topbar">
        <div className="brand">
          <img src="/mark.svg" alt="" />
          <span>
            supp<span className="brand-dot">.</span>edit
          </span>
          <span className="build-badge">EARLY ACCESS</span>
        </div>
        <div className="project-title">
          {project.name}
          <span
            className={dirty ? "dirty-dot" : "saved-dot"}
            title={dirty ? "Unsaved changes" : "Saved"}
          />
          <span className="local-label">LOCAL PROJECT</span>
        </div>
        <button
          className="command-trigger"
          onClick={() => {
            setQuery("");
            setDialog("commands");
          }}
        >
          <Search size={14} />
          <span>Find a command</span>
          <kbd>Ctrl K</kbd>
        </button>
        <IconButton label="Preferences" onClick={() => setDialog("settings")}>
          <Settings2 size={17} />
        </IconButton>
      </header>
      <nav className="workspace-bar">
        <div className="file-actions">
          <IconButton
            label="New project"
            onClick={() => guard(() => setDialog("new"))}
          >
            <Plus size={16} />
          </IconButton>
          <IconButton label="Open project" onClick={open}>
            <FolderOpen size={16} />
          </IconButton>
          <IconButton label="Save project" onClick={() => void save()}>
            <Save size={16} />
          </IconButton>
          <span className="divider" />
          <IconButton
            label="Undo"
            disabled={!history.length}
            onClick={() => useEditor.getState().undo()}
          >
            <Undo2 size={16} />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={!redo.length}
            onClick={() => useEditor.getState().redo()}
          >
            <Redo2 size={16} />
          </IconButton>
        </div>
        <div className="workspace-tabs">
          {(
            ["Edit", "Composite", "Color", "Audio", "Export"] as Workspace[]
          ).map((w) => (
            <button
              key={w}
              className={workspace === w ? "active" : ""}
              onClick={() => useEditor.getState().setWorkspace(w)}
            >
              {w}
            </button>
          ))}
          <button
            disabled
            title="AI provider execution is not implemented in this release"
          >
            <Sparkles size={12} />
            AI Studio
            <span className="soon-dot" />
          </button>
        </div>
        <button
          className="export-trigger"
          onClick={() => useEditor.getState().setWorkspace("Export")}
        >
          Export
          <ArrowUpRight size={14} />
        </button>
      </nav>
      {(error || notice) && (
        <div
          className={`notification ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <AlertTriangle size={15} /> : <Check size={15} />}
          <span>{error || notice}</span>
          <IconButton
            label="Dismiss notification"
            onClick={() => useEditor.setState({ error: null, notice: null })}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      <main className="workbench">
        <Assets
          onImport={() => void importMedia()}
          onRelink={(id) => void relinkMedia(id)}
          busy={busy}
        />
        <div
          className="splitter vertical"
          onPointerDown={(e) => resize(e, "left")}
          title="Resize library"
        />
        <Monitor onImport={() => void importMedia()} onCanvas={onCanvas} />
        <div
          className="splitter vertical"
          onPointerDown={(e) => resize(e, "right")}
          title="Resize inspector"
        />
        {workspace === "Export" ? (
          <ExportPanel capabilities={caps} />
        ) : (
          <Inspector />
        )}
      </main>
      <div
        className="splitter horizontal"
        onPointerDown={(e) => resize(e, "height")}
        title="Resize timeline"
      />
      <Timeline />
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          {busy ? "Reading media…" : "Local workspace"}
          <span className="status-separator">/</span>
          {platform.desktop ? "Desktop" : "Web companion"}
        </span>
        <span>
          {savedAt ? `Recovery saved ${savedAt}` : "Original media preserved"}
          <span className="status-separator">·</span>
          <Cpu size={12} />
          {renderer} / sRGB
        </span>
        <button onClick={() => setDialog("settings")}>
          <Keyboard size={12} />
          Shortcuts
        </button>
      </footer>
      <input
        ref={fileInput}
        type="file"
        data-testid="media-input"
        hidden
        multiple
        accept="video/*,audio/*,image/*"
        onChange={(e) => {
          void receiveFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        type="file"
        data-testid="project-input"
        hidden
        accept=".supp,.suppedit,.json,.bak"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            void file
              .text()
              .then((text) => {
                const p = parseProject(JSON.parse(text));
                useEditor.getState().load(p, file.name);
                clock.seek(0);
              })
              .catch(useEditor.getState().report);
          e.target.value = "";
        }}
      />
      <SourceViewer />
      {dialog === "new" && (
        <NewProject
          onClose={() => setDialog(null)}
          onCreate={(p) => {
            useEditor.getState().load(p, null, true);
            clock.pause();
            clock.seek(0);
            setDialog(null);
            void platform.discardRecovery().catch(useEditor.getState().report);
          }}
        />
      )}
      {dialog === "settings" && (
        <Modal
          title="Preferences & diagnostics"
          onClose={() => setDialog(null)}
        >
          <div className="settings-body">
            <span className="eyebrow">APPEARANCE</span>
            <label>
              Theme
              <select
                aria-label="Theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="dark">Studio dark</option>
                <option value="light">Studio light</option>
              </select>
            </label>
            <label>
              Accent color
              <input
                type="color"
                aria-label="Accent color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              onClick={() => {
                setLeft(272);
                setRight(290);
                setHeight(290);
                for (const key of ["supp-left", "supp-right", "supp-timeline"])
                  localStorage.removeItem(key);
              }}
            >
              Reset panel layout
            </button>
            <span className="eyebrow">THIS MACHINE</span>
            <dl>
              <dt>Platform</dt>
              <dd>{caps?.platform ?? "Detecting…"}</dd>
              <dt>CPU threads</dt>
              <dd>{caps?.cpuCores ?? "—"}</dd>
              <dt>FFprobe</dt>
              <dd>{caps?.ffprobe ? "Available" : "Unavailable"}</dd>
              <dt>FFmpeg / H.264</dt>
              <dd>
                {caps?.encoders.includes("libx264")
                  ? "Available"
                  : "Unavailable"}
              </dd>
              <dt>Advertised hardware APIs</dt>
              <dd>{caps?.hardwareAccels.join(", ") || "None reported"}</dd>
            </dl>
            <EngineDiagnostics capabilities={caps} />
            <span className="eyebrow">KEYBOARD</span>
            <div className="shortcuts">
              {commands
                .filter((c) => c.key)
                .map((c) => (
                  <div key={c.name}>
                    <span>{c.name}</span>
                    <kbd>{c.key}</kbd>
                  </div>
                ))}
              <div>
                <span>Shuttle backward / stop / forward</span>
                <kbd>J K L</kbd>
              </div>
              <div>
                <span>Step one frame</span>
                <kbd>← →</kbd>
              </div>
            </div>
            <div className="setup-notice">
              AI providers, RAW development, 3D, plugin execution, and cloud
              services are unavailable in this release. No credentials or media
              are sent to a server.
            </div>
          </div>
        </Modal>
      )}
      {dialog === "commands" && (
        <Modal title="Command palette" onClose={() => setDialog(null)}>
          <div className="palette-search">
            <Search size={18} />
            <input
              autoFocus
              placeholder="What would you like to do?"
              aria-label="Search commands"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="command-list">
            {commands
              .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
              .map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    setDialog(null);
                    c.run();
                  }}
                >
                  <Command size={14} />
                  <span>{c.name}</span>
                  <kbd>{c.key}</kbd>
                </button>
              ))}
          </div>
        </Modal>
      )}
      {recover && (
        <Modal title="Recover your work" onClose={() => setRecover(null)}>
          <div className="modal-body">
            <p>
              A local recovery snapshot is available for{" "}
              <strong>{recover.project.name}</strong>.
            </p>
            <p>Restore the snapshot to continue from your latest edits.</p>
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => {
                  void platform
                    .discardRecovery()
                    .catch(useEditor.getState().report);
                  setRecover(null);
                }}
              >
                Discard recovery
              </button>
              <button
                className="primary"
                onClick={() => {
                  void platform
                    .recovery(true)
                    .then((r) => {
                      if (r) {
                        useEditor.getState().load(r.project, null, true);
                        clock.seek(0);
                      }
                      setRecover(null);
                    })
                    .catch(useEditor.getState().report);
                }}
              >
                Restore project
              </button>
            </div>
          </div>
        </Modal>
      )}
      {pending && (
        <Modal title="Save your changes?" onClose={() => setPending(null)}>
          <div className="modal-body">
            <p>{project.name} has unsaved changes.</p>
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => {
                  const action = pending;
                  setPending(null);
                  void platform
                    .discardRecovery()
                    .then(action)
                    .catch(useEditor.getState().report);
                }}
              >
                Discard changes
              </button>
              <button className="secondary" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  void save().then((ok) => {
                    if (ok) {
                      const action = pending;
                      setPending(null);
                      action();
                    }
                  });
                }}
              >
                Save & continue
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
