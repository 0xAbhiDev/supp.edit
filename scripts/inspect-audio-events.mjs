// Print the audio events, beats and measurements the application finds in a media file's soundtrack.
// Usage: node scripts/inspect-audio-events.mjs FILE [all]   (all: include plain onsets)
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment(), file = process.argv[2];
const bytes = execFileSync(env.SUPP_FFMPEG, ["-v","error","-i",file,"-map","0:a:0","-ac","2","-ar","22050","-f","s16le","pipe:1"], { env, maxBuffer: 1<<30 });
const s = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1), n = s.length >> 1, l = new Float32Array(n), r = new Float32Array(n);
for (let i = 0; i < n; i++) { l[i] = s[2*i]/32768; r[i] = s[2*i+1]/32768; }
const host = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
const { audioFeatures } = await host.ssrLoadModule("/packages/ai/audio/features.ts");
const { analyzeAudio } = await host.ssrLoadModule("/packages/ai/audio/timeline.ts");
const a = analyzeAudio(audioFeatures({ rate: 22050, channels: [l, r] }));
for (const e of a.events) if (e.kind !== "onset" || process.argv[3]) console.log(e.kind.padEnd(13), String(e.timeMs).padStart(6), e.endMs ?? "", e.strength.toFixed(2), JSON.stringify(e.measured));
console.log("beats", a.beats.map(b => b.timeMs + (b.downbeat ? "D" : "") + ":" + b.strength.toFixed(2)).join(" "));
await host.close();
