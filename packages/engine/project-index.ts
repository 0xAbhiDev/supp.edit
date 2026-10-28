import type { Clip, Project } from "../project-schema";
export class ClipIndex {
  readonly clips: Clip[];
  readonly ends: number[] = [];
  constructor(clips: readonly Clip[]) {
    this.clips = [...clips].sort((a, b) => a.start - b.start);
    let end = 0;
    for (const c of this.clips) {
      end = Math.max(end, c.start + c.duration);
      this.ends.push(end);
    }
  }
  /** Includes overlapping clips; a prefix-max index avoids scanning earlier closed ranges. */
  range(start: number, end: number) {
    let lo = 0,
      hi = this.ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ends[mid] <= start) lo = mid + 1;
      else hi = mid;
    }
    const found: Clip[] = [];
    for (let i = lo; i < this.clips.length && this.clips[i].start < end; i++) {
      const c = this.clips[i];
      if (c.start + c.duration > start) found.push(c);
    }
    return found;
  }
}
const clipIndices = new WeakMap<
  Project["clips"],
  { all: ClipIndex; tracks: Map<string, ClipIndex> }
>();
const indices = new WeakMap<Project, ReturnType<typeof createIndex>>();
function createIndex(p: Project) {
  let clips = Object.isFrozen(p.clips) ? clipIndices.get(p.clips) : undefined;
  if (!clips) {
    const groups = new Map<string, Clip[]>();
    for (const c of p.clips) {
      if (!groups.has(c.trackId)) groups.set(c.trackId, []);
      groups.get(c.trackId)!.push(c);
    }
    clips = {
      all: new ClipIndex(p.clips),
      tracks: new Map([...groups].map(([k, v]) => [k, new ClipIndex(v)])),
    };
    if (Object.isFrozen(p.clips)) clipIndices.set(p.clips, clips);
  }
  return {
    ...clips,
    order: new Map(p.clips.map((c, i) => [c.id, i])),
    assets: new Map(p.assets.map((a) => [a.id, a])),
    trackById: new Map(p.tracks.map((t) => [t.id, t])),
  };
}
export function projectIndex(p: Project) {
  if (
    !Object.isFrozen(p.clips) ||
    !Object.isFrozen(p.tracks) ||
    !Object.isFrozen(p.assets)
  )
    return createIndex(p);
  let index = indices.get(p);
  if (!index) {
    index = createIndex(p);
    indices.set(p, index);
  }
  return index;
}
