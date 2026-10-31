import { create } from "zustand";
import { freeze } from "immer";
import { type Project, newProject } from "../project-schema";
import { History, type Edit } from "../commands";
import { compositionView, inComposition } from "../commands/compositions";
const initialProject = newProject();
let history = new History(initialProject);
function validScope(project: Project, activeComposition: string | null) {
  return activeComposition &&
    !project.compositions.some((c) => c.id === activeComposition)
    ? { activeComposition: null, selected: null }
    : {};
}
export type Workspace =
  "Edit" | "Composite" | "Color" | "Audio" | "Export" | "AI Studio";
interface State {
  project: Project;
  activeComposition: string | null;
  setComposition: (id: string | null) => void;
  executeScoped: (name: string, edit: Edit) => void;
  selected: string | null;
  source: string | null;
  workspace: Workspace;
  path: string | null;
  savedVersion: number | null;
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
  project: initialProject,
  activeComposition: null,
  setComposition: (id) =>
    set({
      activeComposition:
        id && get().project.compositions.some((c) => c.id === id) ? id : null,
      selected: null,
    }),
  executeScoped: (name, edit) =>
    get().execute(name, inComposition(get().activeComposition, edit)),
  selected: null,
  source: null,
  workspace: "Edit",
  path: null,
  savedVersion: 0,
  dirty: false,
  historyNames: [],
  redoNames: [],
  revision: 0,
  error: null,
  notice: null,
  execute: (name, edit) => {
    const old = get().project;
    // Commands contain structure only; media buffers remain in the resource cache.
    let project: Project;
    try {
      project = history.execute(old, name, edit);
    } catch (e) {
      get().report(e);
      return;
    }
    if (old === project) return;
    set((s) => ({
      project,
      ...validScope(project, s.activeComposition),
      dirty: history.currentVersion !== s.savedVersion,
      revision: s.revision + 1,
      historyNames: history.past.map((x) => x.name),
      redoNames: [],
    }));
  },
  undo: () => {
    const project = history.undo(get().project);
    set((s) => ({
      project,
      ...validScope(project, s.activeComposition),
      dirty: history.currentVersion !== s.savedVersion,
      revision: s.revision + 1,
      historyNames: history.past.map((x) => x.name),
      redoNames: history.future.map((x) => x.name),
    }));
  },
  redo: () => {
    const project = history.redo(get().project);
    set((s) => ({
      project,
      ...validScope(project, s.activeComposition),
      dirty: history.currentVersion !== s.savedVersion,
      revision: s.revision + 1,
      historyNames: history.past.map((x) => x.name),
      redoNames: history.future.map((x) => x.name),
    }));
  },
  load: (project, path = null, dirty = false) => {
    // Store snapshots must be immutable even before the first command. Scoped
    // selectors memoize by snapshot identity; an unfrozen disk load otherwise
    // produces a fresh view on every React subscription read.
    project = freeze(project, true);
    history = new History(project);
    set((s) => ({
      project,
      path,
      activeComposition: null,
      savedVersion: dirty ? null : 0,
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
      savedVersion: history.version(p) ?? null,
      dirty: history.currentVersion !== history.version(p),
    })),
  select: (selected) => set({ selected }),
  setSource: (source) => set({ source }),
  setWorkspace: (workspace) =>
    set({
      workspace,
    }),
  report: (e) =>
    set({ error: e instanceof Error ? e.message : String(e), notice: null }),
  inform: (notice) => set({ notice, error: null }),
}));
export const editorProject = (
  s: Pick<State, "project" | "activeComposition">,
) => compositionView(s.project, s.activeComposition);
