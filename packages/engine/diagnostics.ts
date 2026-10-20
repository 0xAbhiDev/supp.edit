import { create } from "zustand";
export type RendererMode = "auto" | "cpu";
export interface PlaybackMetrics {
  renderer: string;
  gpu: string;
  fallback: string;
  renderMs: number;
  rendered: number;
  dropped: number;
  decodedDropped: number;
  frameCacheBytes: number;
  frameCacheHits: number;
  resourceCount: number;
  textureBytes: number;
  error: string;
}
const defaults: PlaybackMetrics = {
  renderer: "Initializing",
  gpu: "Not reported",
  fallback: "",
  renderMs: 0,
  rendered: 0,
  dropped: 0,
  decodedDropped: 0,
  frameCacheBytes: 0,
  frameCacheHits: 0,
  resourceCount: 0,
  textureBytes: 0,
  error: "",
};
let prefs: { renderer?: RendererMode; scale?: number } = {};
try {
  prefs = JSON.parse(localStorage.getItem("supp-playback") || "{}");
} catch {
  /* Invalid local preferences reset to defaults. */
}
export const usePlayback = create<
  PlaybackMetrics & {
    mode: RendererMode;
    scale: number;
    configure: (v: { mode?: RendererMode; scale?: number }) => void;
    publish: (v: Partial<PlaybackMetrics>) => void;
    reset: () => void;
  }
>((set, get) => ({
  ...defaults,
  mode: prefs.renderer === "cpu" ? "cpu" : "auto",
  scale: [1, 0.5, 0.25].includes(prefs.scale ?? 0) ? prefs.scale! : 1,
  configure(v) {
    set(v);
    const s = get();
    localStorage.setItem(
      "supp-playback",
      JSON.stringify({ renderer: s.mode, scale: s.scale }),
    );
  },
  publish(v) {
    set(v);
  },
  reset() {
    set({ rendered: 0, dropped: 0, decodedDropped: 0 });
  },
}));
