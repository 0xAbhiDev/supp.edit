// Download the openly licensed pairs listed in open-pairs.json and prepare them. A source is a
// Commons file ({ title, size }: a transcode, or "original") or a first-party link ({ url, licence,
// credit, page, zip? }: NASA's media library, Blender's server). Files are saved under neutral names; sources.json in each pair records title, licence,
// author and URL (attribution for CC BY). Pairs are "open": the developer labels them.
// Usage: node scripts/eval/fetch-open-pairs.mjs [--only=id,id]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evalDir, pairsDir, readJson, sha256File, writeJson } from "./lib.mjs";
import { preparePair } from "./prepare.mjs";

const UA = "supp-edit-eval/0.1 (offline test-set builder)";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const manifest = readJson(new URL("./open-pairs.json", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", ...params });
  for (let attempt = 0; ; attempt++) {
    const text = await (await fetch(url, { headers: { "user-agent": UA } })).text();
    try {
      return JSON.parse(text);
    } catch {
      if (attempt >= 6) throw Error("Commons API: " + text.slice(0, 120));
      await wait(15000 * (attempt + 1));
    }
  }
}

/** Where to download a source from, and what to record about it. */
async function locate(entry) {
  if (entry.url) {
    const ext = path.extname(decodeURIComponent(new URL(entry.url).pathname).replace(/\.zip$/i, "")) || ".mp4";
    return { url: entry.url, ext: entry.zip ? path.extname(entry.zip) : ext, zip: entry.zip, source: { title: entry.title, page: entry.page, licence: entry.licence, credit: entry.credit } };
  }
  const { title, size } = entry;
  const j = await api({ action: "query", titles: "File:" + title, prop: "videoinfo", viprop: "url|size|derivatives|extmetadata" });
  const v = j.query.pages[0].videoinfo?.[0];
  if (!v) throw Error(`Not on Commons: ${title}`);
  const m = v.extmetadata ?? {};
  const strip = (t) => (t ?? "").replace(/<[^>]+>/g, "").trim();
  const derivative = size === "original" ? undefined : (v.derivatives ?? []).find((d) => d.transcodekey === size);
  if (size !== "original" && !derivative) throw Error(`${title}: no ${size} copy`);
  return {
    url: derivative?.src ?? v.url,
    ext: size === "original" ? path.extname(title) : "." + size.split(".").pop(),
    source: { title, page: v.descriptionurl, size, licence: strip(m.LicenseShortName?.value), author: strip(m.Artist?.value).slice(0, 200), credit: strip(m.Credit?.value).slice(0, 200) },
  };
}

async function download(url, file) {
  if (fs.existsSync(file)) return;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.ok) {
      fs.writeFileSync(file + ".part", Buffer.from(await res.arrayBuffer()));
      fs.renameSync(file + ".part", file);
      return;
    }
    if (attempt >= 8) throw Error(`${res.status} for ${url}`);
    // Commons throttles bursts: wait as long as it asks (at least a minute), longer each time.
    const after = Number(res.headers.get("retry-after")) || 60;
    console.log(`  ${res.status}: waiting ${after * (attempt + 1)} s`);
    await wait(after * 1000 * (attempt + 1));
  }
}

// First-party sources first (no throttling), then Commons; Commons films (hundreds of MB) last.
const fromCommons = (p) => [p.reference, ...p.raw].some((e) => !e.url);
const rank = (p) => (fromCommons(p) ? 1 : 0) + (fromCommons(p) && p.id.startsWith("film-") ? 1 : 0);
const order = [...manifest.pairs].sort((a, b) => rank(a) - rank(b));
for (const p of order) {
  if (only && !only.includes(p.id)) continue;
  const dir = path.join(pairsDir(), p.id);
  if (fs.existsSync(path.join(dir, "pair.json"))) {
    console.log(`${p.id}: already prepared`);
    continue;
  }
  fs.mkdirSync(dir, { recursive: true });
  const sources = [];
  const files = [["reference", p.reference], ...p.raw.map((r, i) => [`raw-${i + 1}`, r])];
  for (const [name, entry] of files) {
    const found = await locate(entry);
    const file = path.join(dir, name + found.ext);
    if (found.zip && !fs.existsSync(file)) {
      // An archive: fetched into its own empty folder, the one member taken out, the rest removed.
      const box = path.join(evalDir(), "downloads", `${p.id}-${name}`);
      fs.mkdirSync(box, { recursive: true });
      const zip = path.join(box, "source.zip");
      await download(found.url, zip);
      // Windows' own tar reads zip files and drive-letter paths (Git's GNU tar takes "C:" for a host).
      const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe") : "tar";
      const run = spawnSync(tar, ["-xf", zip, "-C", box, found.zip], { windowsHide: true, encoding: "utf8" });
      if (run.status !== 0 || !fs.existsSync(path.join(box, found.zip))) throw Error(`Could not take ${found.zip} out of ${found.url}: ${run.stderr}`);
      fs.renameSync(path.join(box, found.zip), file);
      fs.rmSync(box, { recursive: true, force: true });
    } else await download(found.url, file);
    sources.push({ file: path.basename(file), sha256: sha256File(file), url: found.url, ...found.source });
    console.log(`  ${p.id}/${path.basename(file)} ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
    if (!entry.url) await wait(30000); // Commons: one file at a time, well spaced
  }
  writeJson(path.join(dir, "sources.json"), sources);
  const pair = await preparePair(dir, { category: p.category, footage: p.footage, split: "open", name: p.name, provenance: "Wikimedia Commons; see sources.json" });
  console.log(`${p.id}: ${pair.raw.length} raw, ${pair.draftShots.length} draft shots`);
}
