/** Deterministic, locally generated sounds. Used as replacement sound effects when recreating a
 * reference's audio structure (nothing is copied from the reference), and as ground-truth audio
 * for tests. */
export type SoundKind = "kick" | "snare" | "hat" | "impact" | "bass_hit" | "whoosh" | "riser";
function noise(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 31 - 1);
}
/** One sound, mono, starting at sample 0. */
export function synthesize(kind: SoundKind, rate: number, seed = 1, durationMs?: number): Float32Array {
  const length = Math.round(
    (rate *
      (durationMs ??
        { kick: 250, snare: 200, hat: 60, impact: 1400, bass_hit: 900, whoosh: 600, riser: 1500 }[kind])) /
      1000,
  );
  const out = new Float32Array(length),
    rnd = noise(seed);
  let phase = 0,
    lp = 0,
    hp = 0,
    prev = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate,
      x = i / length,
      white = rnd();
    let v = 0;
    switch (kind) {
      case "kick": {
        const f = 50 + 110 * Math.exp(-t * 40);
        phase += (2 * Math.PI * f) / rate;
        v = Math.sin(phase) * Math.exp(-t * 14) * 0.9;
        break;
      }
      case "snare": {
        hp = white - prev + 0.9 * hp;
        prev = white;
        phase += (2 * Math.PI * 190) / rate;
        v = (hp * 0.7 + Math.sin(phase) * 0.3) * Math.exp(-t * 22) * 0.8;
        break;
      }
      case "hat": {
        hp = white - prev + 0.6 * hp;
        prev = white;
        v = hp * Math.exp(-t * 60) * 0.4;
        break;
      }
      case "impact": {
        const f = 38 + 60 * Math.exp(-t * 6);
        phase += (2 * Math.PI * f) / rate;
        lp += 0.15 * (white - lp);
        v = (Math.sin(phase) * 0.8 + white * Math.exp(-t * 18) * 0.6 + lp * 0.4) * Math.exp(-t * 2.2);
        break;
      }
      case "bass_hit": {
        phase += (2 * Math.PI * 45) / rate;
        v = Math.sin(phase) * Math.exp(-t * 3) * 0.9 * Math.min(1, t * 400);
        break;
      }
      case "whoosh":
      case "riser": {
        // Noise whose brightness and level climb; a whoosh also falls away at the end.
        const climb = kind === "riser" ? x : Math.sin(Math.PI * x);
        const cutoff = 0.02 + 0.9 * climb * climb;
        lp += cutoff * (white - lp);
        hp = lp - prev + 0.5 * hp;
        prev = lp;
        v = (hp * 0.8 + lp * 0.2) * (kind === "riser" ? 0.05 + 0.75 * x * x : 0.7 * climb);
        break;
      }
    }
    out[i] = Math.max(-1, Math.min(1, v));
  }
  // End every sound with a 10 ms fade: an abrupt cut is itself a click.
  const fade = Math.min(length, Math.round(rate / 100));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}
/** Mix `sound` into `track` at `atMs`, scaled by `gain`. */
export function place(track: Float32Array, sound: Float32Array, rate: number, atMs: number, gain = 1) {
  const start = Math.round((atMs * rate) / 1000);
  for (let i = 0; i < sound.length && start + i < track.length; i++) if (start + i >= 0) track[start + i] += sound[i] * gain;
}
/** 16-bit PCM WAV bytes for one or two channels. */
export function wav(channels: Float32Array[], rate: number) {
  const n = channels[0].length,
    c = channels.length,
    bytes = new Uint8Array(44 + n * c * 2),
    view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + n * c * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, c, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * c * 2, true);
  view.setUint16(32, c * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, n * c * 2, true);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < c; k++) view.setInt16(44 + (i * c + k) * 2, Math.round(Math.max(-1, Math.min(1, channels[k][i])) * 32767), true);
  return bytes;
}
