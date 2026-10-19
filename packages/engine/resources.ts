import { type Asset, type Clip, type Project, fps } from "../project-schema";
import { sourceUrl, waitEvent } from "../platform";
interface Resource {
  element: HTMLImageElement | HTMLVideoElement | HTMLAudioElement;
  fingerprint: string;
  gain?: GainNode;
  source?: MediaElementAudioSourceNode;
}
export class ResourcePool {
  private entries = new Map<string, Promise<Resource>>();
  private context: AudioContext | null = null;
  constructor(private silent = false) {}
  async get(clip: Clip, asset: Asset): Promise<Resource> {
    const key = `${clip.id}:${asset.fingerprint}`;
    if (this.entries.has(key)) return this.entries.get(key)!;
    const resource = (async () => {
      const url = await sourceUrl(asset);
      if (asset.kind === "image") {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { element: image, fingerprint: asset.fingerprint };
      }
      const media = document.createElement(
        asset.kind === "audio" ? "audio" : "video",
      );
      media.preload = "auto";
      media.crossOrigin = "anonymous";
      media.muted = this.silent;
      media.src = url;
      if (media instanceof HTMLVideoElement) media.playsInline = true;
      await waitEvent(media, "loadedmetadata");
      if (media.readyState < 2) await waitEvent(media, "loadeddata");
      return { element: media, fingerprint: asset.fingerprint };
    })();
    this.entries.set(key, resource);
    resource.catch(() => this.entries.delete(key));
    return resource;
  }
  async prepare(
    clip: Clip,
    asset: Asset,
    p: Project,
    frame: number,
    playing: boolean,
    speed: number,
  ): Promise<Resource> {
    const r = await this.get(clip, asset),
      media = r.element;
    if (media instanceof HTMLMediaElement) {
      const time = Math.max(
        0,
        Math.min(
          media.duration - 0.00001,
          (clip.sourceIn + frame - clip.start) / fps(p),
        ),
      );
      if (!playing || speed < 0) {
        media.pause();
        if (Math.abs(media.currentTime - time) > 0.0001) {
          const seeked = waitEvent(media, "seeked");
          media.currentTime = time;
          await seeked;
        }
      } else {
        if (Math.abs(media.currentTime - time) > 0.12) media.currentTime = time;
        media.playbackRate = Math.max(0.25, Math.min(4, speed));
        await media.play();
      }
    }
    return r;
  }
  async audio(
    clip: Clip,
    asset: Asset,
    p: Project,
    frame: number,
    playing: boolean,
    speed: number,
    audible: boolean,
  ) {
    const r = await this.prepare(clip, asset, p, frame, playing, speed),
      el = r.element;
    if (!(el instanceof HTMLMediaElement) || this.silent) return;
    if (!this.context) {
      this.context = new AudioContext();
    }
    if (!r.gain) {
      r.source = this.context.createMediaElementSource(el);
      r.gain = this.context.createGain();
      r.source.connect(r.gain).connect(this.context.destination);
    }
    r.gain.gain.value = audible ? 10 ** (clip.gain / 20) : 0;
    if (playing && this.context.state === "suspended")
      await this.context.resume();
  }
  async pauseInactive(active: Set<string>) {
    for (const [key, entry] of this.entries) {
      const r = await entry.catch(() => null);
      if (
        r?.element instanceof HTMLMediaElement &&
        !active.has(key.split(":")[0])
      )
        r.element.pause();
    }
  }
  async prune(active: Set<string>) {
    if (this.entries.size <= 24) return;
    for (const [key, entry] of this.entries) {
      if (active.has(key.split(":")[0])) continue;
      this.entries.delete(key);
      const r = await entry.catch(() => null);
      if (r) {
        r.source?.disconnect();
        r.gain?.disconnect();
        if (r.element instanceof HTMLMediaElement) {
          r.element.pause();
          r.element.removeAttribute("src");
          r.element.load();
        }
      }
      if (this.entries.size <= 24) break;
    }
  }
  async dispose() {
    for (const promise of this.entries.values()) {
      const r = await promise.catch(() => null);
      if (r?.element instanceof HTMLMediaElement) {
        r.element.pause();
        r.element.removeAttribute("src");
        r.element.load();
      }
      r?.source?.disconnect();
      r?.gain?.disconnect();
    }
    this.entries.clear();
    await this.context?.close();
    this.context = null;
  }
}
