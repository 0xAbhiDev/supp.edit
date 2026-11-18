/** Decode an asset's audio on this device and measure its audio timeline. In the desktop app the
 * native host decodes (media files are not readable by the web view); in a browser the Web Audio
 * decoder is used. Results are cached by content fingerprint. */
import { invoke } from "@tauri-apps/api/core";
import type { Asset } from "../../project-schema";
import { desktop, importBrowser, sourceUrl } from "../../platform";
import { synthesize, wav, type SoundKind } from "./synth";
import { readDerived, writeDerived } from "../../platform/derived";
import { audioFeatures, type PCM } from "./features";
import { analyzeAudio, audioTimelineSchema, type AudioTimeline, type TranscriptWord } from "./timeline";

const RATE = 22050;
export async function decodeAudio(asset: Asset, url?: string): Promise<PCM> {
  if (desktop && !url) {
    const bytes = new Int16Array(await invoke<ArrayBuffer>("decode_audio_pcm", { path: asset.path }));
    const frames = bytes.length >> 1,
      left = new Float32Array(frames),
      right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = bytes[2 * i] / 32768;
      right[i] = bytes[2 * i + 1] / 32768;
    }
    return { rate: RATE, channels: [left, right] };
  }
  const data = await (await fetch(url ?? (await sourceUrl(asset)))).arrayBuffer();
  const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(Math.min(asset.duration, 600) * RATE)), RATE);
  const decoded = await context.decodeAudioData(data);
  const channels = [decoded.getChannelData(0), decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)];
  return { rate: decoded.sampleRate, channels: channels.map((c) => c.slice(0, Math.ceil(Math.min(asset.duration, 600) * decoded.sampleRate))) };
}

export async function audioTimeline(asset: Asset, words: TranscriptWord[] = [], url?: string): Promise<AudioTimeline | undefined> {
  if (!asset.hasAudio) return;
  const key = "audio-timeline-v2:" + asset.id + ":" + asset.fingerprint + ":" + words.length;
  const cached = audioTimelineSchema.safeParse(await readDerived(key).catch(() => undefined));
  if (cached.success) return cached.data;
  const timeline = analyzeAudio(audioFeatures(await decodeAudio(asset, url)), words);
  await writeDerived(key, timeline, JSON.stringify(timeline).length * 2).catch(() => {});
  return timeline;
}

/** A locally synthesized effect as a library asset: written to app data and imported like any
 * other audio file, so it can be auditioned, moved, regained, muted or replaced. */
export async function generatedSound(kind: SoundKind): Promise<Asset> {
  const rate = 44100,
    // Rising sounds are long enough to be trimmed from their start to any measured length.
    mono = synthesize(kind, rate, 1, kind === "riser" ? 4000 : kind === "whoosh" ? 1000 : undefined),
    bytes = wav([mono, mono], rate);
  if (desktop)
    return (await invoke<{ asset: Asset }>("import_generated_audio", { name: "supp-generated-" + kind, bytes: Array.from(bytes) })).asset;
  const { imported, errors } = await importBrowser([new File([bytes], "supp-generated-" + kind + ".wav", { type: "audio/wav" })]);
  if (!imported[0]) throw Error(errors[0] ?? "The generated sound could not be imported");
  return imported[0].asset;
}

/** The soundtrack of a video as its own audio asset, on the video's clock. The video is only read. */
export async function soundtrackAsset(asset: Asset, url?: string): Promise<Asset> {
  if (desktop && !url) return (await invoke<{ asset: Asset }>("extract_reference_audio", { path: asset.path })).asset;
  const pcm = await decodeAudio(asset, url);
  const { imported, errors } = await importBrowser([new File([wav(pcm.channels, pcm.rate)], "reference-audio.wav", { type: "audio/wav" })]);
  if (!imported[0]) throw Error(errors[0] ?? "The reference soundtrack could not be imported");
  return imported[0].asset;
}
