// The labelling page for the evaluation set, served on this computer only (127.0.0.1).
// Usage: npm run eval:label   (or node scripts/eval/label-server.mjs [--port=5199] [--dir=PATH])
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, ENERGY, FOOTAGE, LEVELS, ROLES, evalDir, labelsDigest, labelsSchema, listPairs, pairSchema, pairsDir, readJson, shotProblems, writeJson } from "./lib.mjs";
import { preparePair } from "./prepare.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// --dir=PATH labels another set (tests use a scratch copy); work/eval by default.
const dirArg = process.argv.find((a) => a.startsWith("--dir="))?.slice(6);
if (dirArg) process.env.SUPP_EVAL_DIR = path.resolve(dirArg);
const port = Number(process.argv.find((a) => a.startsWith("--port="))?.slice(7) ?? process.env.PORT ?? 5199);
const TYPES = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo" };

const pairDir = (id) => {
  const dir = path.join(pairsDir(), id);
  if (path.dirname(dir) !== pairsDir() || !fs.existsSync(dir)) throw Object.assign(Error("No such pair."), { status: 404 });
  return dir;
};
const readPair = (id) => pairSchema.parse(readJson(path.join(pairDir(id), "pair.json")));
const readLabels = (id) => labelsSchema.parse(readJson(path.join(pairDir(id), "labels.json")));

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
const send = (res, status, data, type = "application/json") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
};

/** A pair's video, with range requests so the page can seek. Only files the pair lists. */
function media(req, res, id, file) {
  const pair = readPair(id);
  const entry = [pair.reference, ...pair.raw].find((m) => m.file === file);
  if (!entry) return send(res, 404, { error: "Not a file of this pair." });
  const full = path.join(pairDir(id), entry.proxy ?? entry.file);
  const size = fs.statSync(full).size;
  const type = TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream";
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (!m) {
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    return fs.createReadStream(full).pipe(res);
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size) {
    res.writeHead(416, { "content-range": `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes" });
  fs.createReadStream(full, { start, end }).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, fs.readFileSync(path.join(here, "labeller.html")), "text/html; charset=utf-8");
    if (parts[0] === "media" && parts.length === 3) return media(req, res, parts[1], parts[2]);
    if (parts[0] !== "api") return send(res, 404, { error: "Not found." });
    if (req.method === "GET" && parts[1] === "state")
      return send(res, 200, { evalDir: evalDir(), pairsDir: pairsDir(), pairs: listPairs(), categories: CATEGORIES, footage: FOOTAGE, roles: ROLES, energy: ENERGY, levels: LEVELS });
    const id = parts[2];
    if (parts[1] !== "pair" || !id) return send(res, 404, { error: "Not found." });
    if (req.method === "POST" && parts[3] === "prepare") {
      const options = await body(req);
      return send(res, 200, await preparePair(pairDir(id), { category: options.category, footage: options.footage, name: options.name }));
    }
    if (req.method === "GET" && parts.length === 3) return send(res, 200, { pair: readPair(id), labels: readLabels(id) });
    if (req.method === "PUT" && parts[3] === "labels") {
      const pair = readPair(id);
      if (pair.lock) return send(res, 409, { error: "These labels are locked. Unlock them first." });
      const labels = labelsSchema.parse({ ...(await body(req)), version: 1, updatedAt: new Date().toISOString() });
      const clips = new Set(pair.raw.map((r) => r.file));
      for (const s of labels.shots) for (const a of s.acceptable) if (!clips.has(a.clip)) return send(res, 400, { error: `Shot ${s.shot}: ${a.clip} is not a raw clip of this pair.` });
      if (pair.footage === "different" && labels.shots.some((s) => s.acceptable.some((a) => a.level === "exact")))
        return send(res, 400, { error: "This pair's footage is other recordings, so no range can be the exact moment. Use “same action”." });
      writeJson(path.join(pairDir(id), "labels.json"), labels);
      return send(res, 200, { ok: true, updatedAt: labels.updatedAt });
    }
    if (req.method === "POST" && parts[3] === "lock") {
      const pair = readPair(id),
        labels = readLabels(id);
      const open = labels.shots.map((s) => ({ shot: s.shot, problems: shotProblems(s) })).filter((s) => s.problems.length);
      if (open.length) return send(res, 400, { error: "Some shots are not finished: " + open.map((s) => `shot ${s.shot} (${s.problems.join(", ")})`).join("; ") + "." });
      pair.lock = { sha256: labelsDigest(labels), lockedAt: new Date().toISOString() };
      writeJson(path.join(pairDir(id), "pair.json"), pairSchema.parse(pair));
      return send(res, 200, { ok: true, lock: pair.lock });
    }
    if (req.method === "POST" && parts[3] === "unlock") {
      const pair = readPair(id);
      delete pair.lock;
      // Labels changed after the app has already run on this pair no longer count as unseen.
      if (pair.firstRunAt) pair.relabelledAfterRun = true;
      writeJson(path.join(pairDir(id), "pair.json"), pairSchema.parse(pair));
      return send(res, 200, { ok: true, relabelledAfterRun: !!pair.relabelledAfterRun });
    }
    return send(res, 404, { error: "Not found." });
  } catch (e) {
    const message = e?.issues ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e?.message ?? e);
    send(res, e?.status ?? 400, { error: message });
  }
});
fs.mkdirSync(pairsDir(), { recursive: true });
server.listen(port, "127.0.0.1", () => console.log(`Labelling page: http://127.0.0.1:${port}  (pairs in ${pairsDir()})`));
