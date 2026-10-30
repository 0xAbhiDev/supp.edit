import { useEffect, useState } from "react";
import {
  Search,
  Plus,
  Film,
  Image,
  Music2,
  LayoutGrid,
  List,
  Upload,
  Link2,
  ArrowDownToLine,
} from "lucide-react";
import { useEditor, editorProject } from "../../../packages/editor-state";
import {
  thumbnails,
  desktop,
  restoreThumbnail,
  useDerivedRevision,
  derivedErrors,
} from "../../../packages/platform";
import { insertAsset } from "../../../packages/commands";
import { newTrack, fps } from "../../../packages/project-schema";
import { clock } from "../../../packages/engine/clock";
import { IconButton } from "./Controls";
export function Assets({
  onImport,
  onRelink,
  busy,
}: {
  onImport: () => void;
  onRelink: (id: string) => void;
  busy: boolean;
}) {
  useDerivedRevision();
  const project = useEditor(editorProject),
    source = useEditor((s) => s.source),
    setSource = useEditor((s) => s.setSource),
    execute = useEditor((s) => s.executeScoped);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [view, setView] = useState<"grid" | "list">("grid");
  const [, refresh] = useState(0);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      for (const asset of project.assets) {
        if (stopped) return;
        try {
          await restoreThumbnail(asset);
          if (!stopped) refresh((n) => n + 1);
        } catch {
          /* Offline sources keep their type icon; playback reports the source failure. */
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [project.assets]);
  const assets = project.assets.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  function append(id: string) {
    const a = project.assets.find((a) => a.id === id)!;
    let track = project.tracks.find(
      (t) => t.kind === (a.kind === "audio" ? "audio" : "video") && !t.locked,
    );
    if (!track) {
      track = newTrack(
        a.kind === "audio" ? "audio" : "video",
        project.tracks.length + 1,
      );
      execute("Add track", (p) => {
        p.tracks.push(track!);
      });
    }
    execute("Insert media", insertAsset(id, track.id, clock.get().frame));
    const c = editorProject(useEditor.getState()).clips.at(-1);
    if (c) useEditor.getState().select(c.id);
  }
  return (
    <aside className="assets panel">
      <div className="panel-heading">
        <span>Project library</span>
        <span className="badge">{project.assets.length}</span>
        <IconButton label="Import media" onClick={onImport} disabled={busy}>
          <Plus size={16} />
        </IconButton>
      </div>
      <div className="library-path">
        <span className="tiny-dot" /> {project.name}
        <span className="muted">/ Media</span>
      </div>
      <div className="search">
        <Search size={14} />
        <input
          placeholder="Search your media"
          aria-label="Search media"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>/</kbd>
      </div>
      <div className="asset-filters">
        <select
          aria-label="Filter media"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All media</option>
          <option value="video">Video</option>
          <option value="image">Images</option>
          <option value="audio">Audio</option>
        </select>
        <span />
        <IconButton
          label="Grid view"
          aria-pressed={view === "grid"}
          onClick={() => setView("grid")}
        >
          <LayoutGrid size={14} />
        </IconButton>
        <IconButton
          label="List view"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          <List size={14} />
        </IconButton>
      </div>
      <div className={`asset-items ${view}`}>
        {assets.map((a) => (
          <div
            key={a.id}
            className={`asset ${source === a.id ? "selected" : ""}`}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData("application/x-supp-asset", a.id)
            }
          >
            <button
              className="asset-preview"
              onClick={() => setSource(a.id)}
              aria-label={`Preview ${a.name}`}
            >
              {thumbnails.has(a.id) ? (
                <img src={thumbnails.get(a.id)} alt="" />
              ) : a.kind === "video" ? (
                <Film size={25} />
              ) : a.kind === "image" ? (
                <Image size={25} />
              ) : (
                <Music2 size={25} />
              )}
              <span className={`media-type ${a.kind}`}>
                {a.kind === "image" ? "STILL" : `${a.duration.toFixed(1)}s`}
              </span>
            </button>
            <div className="asset-name" title={a.name}>
              {a.name}
            </div>
            <div className="asset-meta">
              {a.kind === "audio" ? a.codec : `${a.width} × ${a.height}`}
              <span>{(a.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
            <div className="asset-actions">
              <button onClick={() => append(a.id)} title="Insert at playhead">
                <ArrowDownToLine size={12} /> Insert
              </button>
              <IconButton
                label={`Relink ${a.name}`}
                onClick={() => onRelink(a.id)}
              >
                <Link2 size={12} />
              </IconButton>
            </div>
            {derivedErrors.has(a.id) && (
              <small
                className="asset-analysis-error"
                title={derivedErrors.get(a.id)}
              >
                Preview analysis unavailable: {derivedErrors.get(a.id)}
              </small>
            )}
          </div>
        ))}
        {!assets.length && (
          <div className="empty-library">
            <div className="empty-symbol">
              <Upload size={23} />
            </div>
            <strong>
              {query ? "No matching media" : "Make room for your next idea."}
            </strong>
            <p>
              {query
                ? "Try another filename."
                : "Import video, images, or audio. Your original files stay untouched."}
            </p>
            <button className="secondary" onClick={onImport} disabled={busy}>
              <Plus size={14} />
              {busy ? "Reading media…" : "Import media"}
            </button>
            <small>
              {desktop
                ? "Native metadata · FFprobe"
                : "Files stay in this browser"}
            </small>
          </div>
        )}
      </div>
      <div className="library-footer">
        <span>{assets.length} assets</span>
        <span>{fps(project).toFixed(2).replace(".00", "")} fps project</span>
      </div>
    </aside>
  );
}
