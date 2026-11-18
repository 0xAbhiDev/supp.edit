import { type Asset, type Clip, type Project, fps } from "../project-schema";
import { sourceUrl, waitEvent } from "../platform";
import { LruCache } from "./lru";
import { sourceFrameAt, speedAt } from "../time-remap/model";
import { seekMedia } from "./seek-media";
export interface Resource {
  element: HTMLImageElement | HTMLVideoElement | HTMLAudioElement;
  gain?: GainNode;
  source?: MediaElementAudioSourceNode;
  colorSurface?: HTMLCanvasElement;
}
interface Entry {
  clipId: string;
  promise: Promise<Resource>;
  value?: Resource;
  used: number;
}
export class ResourcePool {
  private entries = new Map<string, Entry>();
  private active = new Set<string>();
  private context: AudioContext | null = null;
  private limiter: WaveShaperNode | null = null;
  private disposed = false;
  private prefetching = 0;
  private borrowed = new Set<ImageBitmap>();
  private retired = new Set<ImageBitmap>();
  readonly frames = new LruCache<string, ImageBitmap>(
    96 * 1024 * 1024,
    96,
    (b) => {
      if (this.borrowed.has(b)) this.retired.add(b);
      else b.close();
    },
  );
  constructor(private silent = false) {}
  get size() {
    return this.entries.size;
  }
  get decodedDropped() {
    let n = 0;
    for (const e of this.entries.values())
      if (e.value?.element instanceof HTMLVideoElement)
        n +=
          e.value.element.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
    return n;
  }
  setActive(active: Set<string>) {
    this.active = active;
  }
  private release(r: Resource) {
    if (r.colorSurface) r.colorSurface.width = r.colorSurface.height = 0;
    r.source?.disconnect();
    r.gain?.disconnect();
    if (r.element instanceof HTMLMediaElement) {
      r.element.pause();
      r.element.removeAttribute("src");
      r.element.load();
    } else r.element.src = "";
  }
  private remove(key: string, entry: Entry) {
    this.entries.delete(key);
    if (entry.value) this.release(entry.value);
  }
  async get(clip: Clip, asset: Asset): Promise<Resource> {
    if (this.disposed) throw new Error("Media pool closed");
    const key = `${clip.id}:${asset.fingerprint}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.used = performance.now();
      return existing.promise;
    }
    while (this.entries.size >= 24) {
      const victim = [...this.entries]
        .filter(([, e]) => !this.active.has(e.clipId))
        .sort((a, b) => a[1].used - b[1].used)[0];
      if (!victim)
        throw new Error(
          "Playback decoder limit reached (24 concurrent sources)",
        );
      this.remove(...victim);
    }
    const entry: Entry = {
      clipId: clip.id,
      used: performance.now(),
      promise: Promise.resolve(null as unknown as Resource),
    };
    this.entries.set(key, entry);
    entry.promise = (async () => {
      const url = await sourceUrl(asset);
      let element: Resource["element"] | undefined;
      try {
        if (asset.kind === "image") {
          const image = new Image();
          element = image;
          image.src = url;
          await image.decode();
        } else {
          const media = document.createElement(
            asset.kind === "audio" ? "audio" : "video",
          );
          element = media;
          media.preload = "auto";
          media.crossOrigin = "anonymous";
          media.muted = true;
          if (media instanceof HTMLVideoElement) media.playsInline = true;
          const ready = waitEvent(media, "loadedmetadata");
          media.src = url;
          await ready;
          if (media.readyState < 2) await waitEvent(media, "loadeddata");
        }
        const resource = { element };
        if (this.disposed || this.entries.get(key) !== entry) {
          throw new Error("Media load superseded");
        }
        entry.value = resource;
        return resource;
      } catch (error) {
        if (element) this.release({ element });
        throw error;
      }
    })();
    entry.promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.promise;
  }
  private time(clip: Clip, p: Project, frame: number) {
    return Math.max(0, sourceFrameAt(clip, frame - clip.start) / fps(p));
  }
  private key(clip: Clip, asset: Asset, p: Project, frame: number) {
    return `${asset.id}:${asset.fingerprint}:${this.time(clip, p, frame).toFixed(9)}`;
  }
  async prepare(
    clip: Clip,
    asset: Asset,
    p: Project,
    frame: number,
    playing: boolean,
    speed: number,
  ) {
    const r = await this.get(clip, asset),
      media = r.element;
    if (media instanceof HTMLMediaElement) {
      const time = Math.max(
        0,
        Math.min(media.duration - 0.00001, this.time(clip, p, frame)),
      );
      if (!playing || speed < 0) {
        media.pause();
        if (
          !(
            media instanceof HTMLVideoElement &&
            this.frames.has(this.key(clip, asset, p, frame))
          ) &&
          Math.abs(media.currentTime - time) > 0.0001
        ) {
          await seekMedia(media, time, asset.fps || fps(p));
        }
      } else {
        if (Math.abs(media.currentTime - time) > 0.12) media.currentTime = time;
        media.preservesPitch = !clip.timeRemap;
        media.playbackRate = Math.max(
          0.0625,
          Math.min(16, speed * speedAt(clip, frame - clip.start)),
        );
        await media.play();
      }
    }
    return r;
  }
  async visual(
    r: Resource,
    clip: Clip,
    asset: Asset,
    p: Project,
    frame: number,
    playing: boolean,
  ): Promise<CanvasImageSource> {
    if (r.element instanceof HTMLAudioElement)
      throw new Error("Audio has no visual frame");
    if (!(r.element instanceof HTMLVideoElement)) return r.element;
    const key = this.key(clip, asset, p, frame),
      cached = this.frames.get(key);
    if (cached && !playing) {
      this.borrowed.add(cached);
      return cached;
    }
    // Resolve video color into the project's sRGB working surface before either
    // renderer reads it. Uploading an HDR ImageBitmap directly to WebGL can
    // bypass the conversion that Canvas2D performs, producing different grades.
    const surface = (r.colorSurface ??= document.createElement("canvas"));
    if (
      surface.width !== r.element.videoWidth ||
      surface.height !== r.element.videoHeight
    ) {
      surface.width = r.element.videoWidth;
      surface.height = r.element.videoHeight;
    }
    const context = surface.getContext("2d", {
      colorSpace: "srgb",
      alpha: true,
    })!;
    context.globalCompositeOperation = "copy";
    context.drawImage(r.element, 0, 0);
    if (playing) return surface;
    const bitmap = await createImageBitmap(surface);
    this.borrowed.add(bitmap);
    this.frames.set(key, bitmap, bitmap.width * bitmap.height * 4);
    return bitmap;
  }
  releaseFrames() {
    this.borrowed.clear();
    for (const b of this.retired) b.close();
    this.retired.clear();
  }
  async audio(
    r: Resource,
    clip: Clip,
    playing: boolean,
    speed: number,
    audible: boolean,
  ) {
    const el = r.element;
    if (!(el instanceof HTMLMediaElement) || this.silent) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.limiter = this.context.createWaveShaper();
      this.limiter.curve = Float32Array.from({ length: 65537 }, (_, i) =>
        Math.max(-0.95, Math.min(0.95, i / 32768 - 1)),
      );
      this.limiter.connect(this.context.destination);
    }
    if (!r.gain) {
      r.source = this.context.createMediaElementSource(el);
      r.gain = this.context.createGain();
      r.source.connect(r.gain).connect(this.limiter!);
    }
    r.gain.gain.value = audible && speed > 0 ? 10 ** (clip.gain / 20) : 0;
    el.muted = false;
    if (playing && this.context.state === "suspended")
      await this.context.resume();
  }
  pauseInactive(active: Set<string>) {
    for (const e of this.entries.values())
      if (e.value?.element instanceof HTMLMediaElement && !active.has(e.clipId))
        e.value.element.pause();
  }
  prune(active: Set<string>) {
    const victims = [...this.entries]
      .filter(([, e]) => !active.has(e.clipId))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of victims)
      if (this.entries.size > 12) this.remove(key, e);
  }
  prefetch(p: Project, upcoming: Clip[], active: Set<string>) {
    if (this.disposed) return;
    for (const c of upcoming) {
      if (this.prefetching >= 2) return;
      if (active.has(c.id) || p.tracks.find((t) => t.id === c.trackId)?.hidden)
        continue;
      const asset = p.assets.find((a) => a.id === c.assetId);
      if (!asset || this.entries.has(`${c.id}:${asset.fingerprint}`)) continue;
      this.prefetching++;
      void this.get(c, asset)
        .catch(() => {
          /* Playback reports failures when the source becomes active. */
        })
        .finally(() => this.prefetching--);
    }
  }
  async dispose() {
    this.disposed = true;
    this.frames.clear();
    this.releaseFrames();
    for (const [key, e] of this.entries) this.remove(key, e);
    // AudioContext.close() can stay pending in the desktop web view (observed after a completed
    // Deliver export); releasing resources must not wait on it indefinitely.
    const closing = this.context?.close().catch(() => {});
    this.context = null;
    await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 2000))]);
    this.limiter = null;
  }
}
