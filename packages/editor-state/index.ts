import { create } from "zustand";
import { type Project, newProject } from "../project-schema";
import { History, type Edit } from "../commands";
let history = new History();
export type Workspace = "Edit" | "Composite" | "Color" | "Audio" | "Export";
interface State {
  project: Project;
  selected: string | null;
  source: string | null;
  workspace: Workspace;
  path: string | null;
  saved: string;
  dirty: boolean;
  historyNames: string[];
  redoNames: string[];
  revision: number;
  error: string | null;
  notice: string | null;
  execute: (name: string, edit: Edit) => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project, path?: string | null, dirty?: boolean) => void;
  markSaved: (p: Project, path?: string | null) => void;
  select: (id: string | null) => void;
  setSource: (id: string | null) => void;
  setWorkspace: (v: Workspace) => void;
  report: (e: unknown) => void;
  inform: (message: string) => void;
}
export const useEditor = create<State>((set, get) => ({
  project: newProject(),
  selected: null,
  source: null,
  workspace: "Edit",
  path: null,
  saved: "",
  dirty: false,
  historyNames: [],
  redoNames: [],
  revision: 0,
  error: null,
  notice: null,
  execute: (name, edit) => {
    const old = get().project;
    // Commands contain structure only; media buffers remain in the resource cache.
    const project = history.execute(old, name, edit);
    if (old === project) return;
    set((s) => ({
      project,
      dirty: JSON.stringify(project) !== s.saved,
      revision: s.revision + 1,
      historyNames: history.past.map((x) => x.name),
      redoNames: [],
    }));
  },
  undo: () => {
    const project = history.undo(get().project);
    set((s) => ({
      project,
      dirty: JSON.stringify(project) !== s.saved,
      revision: s.revision + 1,
      historyNames: history.past.map((x) => x.name),
      redoNames: history.future.map((x) => x.name),
    }));
  },
  redo: () => {
    const project = history.redo(get().project);
    set((s) => ({
      project,
      dirty: JSON.stringify(project) !== s.saved,
      revision: s.revision + 1,
      historyNames: history.past.map((x) => x.name),
      redoNames: history.future.map((x) => x.name),
    }));
  },
  load: (project, path = null, dirty = false) => {
    history = new History();
    set((s) => ({
      project,
      path,
      saved: dirty ? "" : JSON.stringify(project),
      dirty,
      selected: null,
      source: null,
      historyNames: [],
      redoNames: [],
      revision: s.revision + 1,
      error: null,
    }));
  },
  markSaved: (p, path) =>
    set((s) => ({
      path: path ?? s.path,
      saved: JSON.stringify(p),
      dirty: JSON.stringify(s.project) !== JSON.stringify(p),
    })),
  select: (selected) => set({ selected }),
  setSource: (source) => set({ source }),
  setWorkspace: (workspace) => set({ workspace }),
  report: (e) =>
    set({ error: e instanceof Error ? e.message : String(e), notice: null }),
  inform: (notice) => set({ notice, error: null }),
}));
