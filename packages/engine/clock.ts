import { useSyncExternalStore } from "react";
import { useEditor, editorProject } from "../editor-state";
import { duration, fps } from "../project-schema";
type Snapshot = {
  frame: number;
  playing: boolean;
  speed: number;
  loop: boolean;
};
class PlaybackClock {
  private state: Snapshot = { frame: 0, playing: false, speed: 1, loop: false };
  private listeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  private fraction = 0;
  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(next: Partial<Snapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => fn());
  }
  seek(frame: number) {
    this.fraction = 0;
    this.emit({ frame: Math.max(0, Math.round(frame)) });
  }
  pause() {
    cancelAnimationFrame(this.raf);
    this.emit({ playing: false });
  }
  play(speed = 1) {
    this.pause();
    if (!duration(editorProject(useEditor.getState()))) return;
    if (
      this.state.frame >= duration(editorProject(useEditor.getState())) &&
      speed > 0
    )
      this.seek(0);
    this.last = performance.now();
    this.emit({ playing: true, speed });
    this.raf = requestAnimationFrame(this.tick);
  }
  toggle() {
    this.state.playing ? this.pause() : this.play();
  }
  loop() {
    this.emit({ loop: !this.state.loop });
  }
  private tick = (now: number) => {
    const p = editorProject(useEditor.getState()),
      end = duration(p);
    this.fraction +=
      Math.min(0.25, (now - this.last) / 1000) * fps(p) * this.state.speed;
    this.last = now;
    const delta = Math.trunc(this.fraction);
    this.fraction -= delta;
    let frame = this.state.frame + delta;
    if (frame >= end || frame < 0) {
      if (this.state.loop) frame = frame < 0 ? Math.max(0, end - 1) : 0;
      else {
        this.seek(frame < 0 ? 0 : Math.max(0, end - 1));
        this.pause();
        return;
      }
    }
    if (frame !== this.state.frame) this.emit({ frame });
    this.raf = requestAnimationFrame(this.tick);
  };
}
export const clock = new PlaybackClock();
export const useClock = () => useSyncExternalStore(clock.subscribe, clock.get);
