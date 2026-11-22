// Prepare one pair folder for labelling: hash and probe its videos, find the reference's cuts as a
// draft for the person labelling, make browser-playable proxies where needed, assign the split
// and write the project the app opens.
// Usage: node scripts/eval/prepare.mjs PAIR_DIR --category=gym --footage=own|different [--name=…] [--split=open|blind|seen]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mediaEnvironment } from "../runtime.mjs";
import { CATEGORIES, FOOTAGE, SPLITS, VIDEO, listPairs, pairSchema, labelsSchema, readJson, sha256File, writeJson } from "./lib.mjs";

/** Codecs and containers Chromium-based browsers play without help. */
const PLAYABLE_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const PLAYABLE_FILES = /\.(mp4|m4v|webm)$/i;
/** A cut: this much picture change between neighbouring frames (ffmpeg's scene score). */
const SCENE = 0.3;
const MIN_SHOT_MS = 250;

const project = fileURLToPath(new URL("../..", import.meta.url));
const exe = (name) => path.join(project, "target/debug/examples", name + (process.platform === "win32" ? ".exe" : ""));

function probe(files) {
  return JSON.parse(execFileSync(exe("probe_assets"), files, { env: mediaEnvironment(), windowsHide: true, maxBuffer: 16 << 20, cwd: project }).toString());
}

/** The reference's cuts, from ffmpeg's scene change score. Dissolves and flashes may need a
 * person's correction; the page lets them split, merge and move cuts. */
export function detectCuts(file, durationMs, ffmpeg) {
  const run = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", `select='gt(scene,${SCENE})',showinfo`, "-f", "null", "-"], { encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 });
  const times = [...(run.stderr ?? "").matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000));
  const cuts = [];
  for (const t of times) if (t >= MIN_SHOT_MS && durationMs - t >= MIN_SHOT_MS && (!cuts.length || t - cuts.at(-1) >= MIN_SHOT_MS)) cuts.push(t);
  const edges = [0, ...cuts, durationMs];
  return edges.slice(0, -1).map((startMs, i) => ({ startMs, endMs: edges[i + 1] }));
}

function proxy(dir, file, codec, ffmpeg) {
  if (PLAYABLE_CODECS.has(codec) && PLAYABLE_FILES.test(file)) return undefined;
  fs.mkdirSync(path.join(dir, "proxies"), { recursive: true });
  const out = path.join("proxies", file.replace(/\.[^.]+$/, "") + ".proxy.mp4");
  if (!fs.existsSync(path.join(dir, out)))
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(dir, file), "-vf", "scale=-2:'min(540,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", path.join(dir, out)], { windowsHide: true });
  return out.replace(/\\/g, "/");
}

/** One in three new pairs, at random, is held back as blind. */
const chooseSplit = () => (crypto.randomInt(3) === 0 ? "blind" : "open");

export async function preparePair(dir, { category, footage, name, split, provenance } = {}) {
  dir = path.resolve(dir);
  if (!CATEGORIES.includes(category)) throw Error(`Choose a category: ${CATEGORIES.join(", ")}.`);
  if (!FOOTAGE.includes(footage)) throw Error("Say whether the raw footage is the reference's own footage (own) or other recordings (different).");
  if (split && !SPLITS.includes(split)) throw Error(`The split is one of ${SPLITS.join(", ")}.`);
  const pairFile = path.join(dir, "pair.json");
  if (fs.existsSync(pairFile)) throw Error("This pair is already prepared.");
  const videos = fs.readdirSync(dir).filter((f) => VIDEO.test(f) && fs.statSync(path.join(dir, f)).isFile());
  const reference = videos.filter((f) => /^reference\./i.test(f));
  if (reference.length !== 1) throw Error("Name the reference video reference.mp4 (or .mov, .webm …): exactly one file in the folder.");
  const raw = videos.filter((f) => f !== reference[0]);
  if (!raw.length) throw Error("Put the raw footage in the same folder as the reference.");
  const env = mediaEnvironment();
  const ffmpeg = env.SUPP_FFMPEG || "ffmpeg";
  const files = [reference[0], ...raw];
  const assets = probe(files.map((f) => path.join(dir, f)));
  const describe = (file, a) => {
    const playable = proxy(dir, file, a.codec ?? "", ffmpeg);
    return {
      file,
      sha256: sha256File(path.join(dir, file)),
      bytes: fs.statSync(path.join(dir, file)).size,
      durationMs: Math.round((a.duration ?? 0) * 1000),
      width: a.width ?? 0,
      height: a.height ?? 0,
      fps: a.fps ?? 0,
      codec: a.codec ?? "",
      ...(playable ? { proxy: playable } : {}),
    };
  };
  const media = files.map((f, i) => describe(f, assets[i]));
  if (media.some((m) => !m.durationMs)) throw Error("A video could not be read: " + media.filter((m) => !m.durationMs).map((m) => m.file).join(", "));
  // The same reference with other raw footage is another pair; the same reference and raw is not.
  const identity = (m) => [m[0].sha256, ...m.slice(1).map((x) => x.sha256).sort()].join(",");
  const twin = listPairs()
    .filter((p) => p.prepared && p.id !== path.basename(dir))
    .find((p) => {
      const other = readJson(path.join(dir, "..", p.id, "pair.json"));
      return identity([other.reference, ...other.raw]) === identity(media);
    });
  if (twin) throw Error(`This reference and footage are already in the set (${twin.id}).`);
  const draftShots = detectCuts(path.join(dir, files[0]), media[0].durationMs, ffmpeg);

  // The project the app opens: the reference first, then the raw clips, as the matrix cases do.
  const { createServer } = await import("vite");
  const server = await createServer({ root: project, appType: "custom", server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] }, logLevel: "error" });
  try {
    const { newProject } = await server.ssrLoadModule("/packages/project-schema/index.ts");
    const p = newProject("Evaluation " + path.basename(dir), 360, 640);
    p.assets = assets;
    writeJson(path.join(dir, "project.template.supp"), p);
  } finally {
    await server.close();
  }
  const pair = pairSchema.parse({
    version: 1,
    id: path.basename(dir),
    name: name || path.basename(dir),
    category,
    footage,
    split: split ?? chooseSplit(),
    createdAt: new Date().toISOString(),
    ...(provenance ? { provenance } : {}),
    reference: media[0],
    raw: media.slice(1),
    draftShots,
    template: "project.template.supp",
  });
  writeJson(pairFile, pair);
  const labelsFile = path.join(dir, "labels.json");
  if (!fs.existsSync(labelsFile))
    writeJson(
      labelsFile,
      labelsSchema.parse({
        version: 1,
        updatedAt: new Date().toISOString(),
        shots: draftShots.map((s, i) => ({ shot: i + 1, ...s, shows: "", role: null, energy: null, action: "", acceptable: [], note: "", done: false })),
      }),
    );
  return pair;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const option = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  if (!dir) throw Error("Usage: node scripts/eval/prepare.mjs PAIR_DIR --category=… --footage=own|different");
  const pair = await preparePair(dir, { category: option("category"), footage: option("footage"), name: option("name"), split: option("split") });
  console.log(`${pair.id}: ${pair.raw.length} raw clips, ${pair.draftShots.length} draft shots, ${pair.split}`);
}
