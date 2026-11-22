// Seed the evaluation set with cases already used for tuning, as "seen" pairs (regression checks,
// never counted as unseen):
//  - the A/B footage (test-results/footage/different42): labels written by a person before any
//    build ran on it, imported as same-action ranges, and locked;
//  - the personal gym reel and its raw clips: prepared only, for a person to label.
// Usage: node scripts/eval/import-seen.mjs
import fs from "node:fs";
import path from "node:path";
import { labelsDigest, labelsSchema, pairSchema, pairsDir, readJson, writeJson } from "./lib.mjs";
import { preparePair } from "./prepare.mjs";

function copyInto(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, name] of files) if (!fs.existsSync(path.join(dir, name))) fs.copyFileSync(from, path.join(dir, name));
}

// ---- A/B footage ---------------------------------------------------------------------------
{
  const source = path.resolve("test-results/footage/different42");
  const id = "ab-gym-beach";
  const dir = path.join(pairsDir(), id);
  if (fs.existsSync(path.join(dir, "pair.json"))) console.log(`${id}: already imported`);
  else if (!fs.existsSync(source)) console.log(`${id}: ${source} is missing; skipped`);
  else {
    const shots = readJson(path.join(source, "reference-shots.json"));
    const labels = readJson(path.join(source, "labels.json"));
    copyInto(dir, [[path.join(source, "reference.mp4"), "reference.mp4"], ...shots.raw.map((f) => [path.join(source, f), f])]);
    await preparePair(dir, { category: "gym", footage: "different", split: "seen", name: "A/B: gym and beach (different footage)", provenance: "test-results/footage/different42 (4.2 blind A/B; seen since)" });
    const imported = labelsSchema.parse({
      version: 1,
      labelledBy: "imported from test-results/footage/different42/labels.json: written by a person before any build ran on the case; role and energy were not recorded",
      updatedAt: new Date().toISOString(),
      shots: shots.shots.map((s) => {
        const l = labels.shots.find((x) => x.shot === s.shot);
        return { shot: s.shot, startMs: s.startMs, endMs: s.endMs, shows: s.shows, role: null, energy: null, action: "", note: "", done: true, acceptable: (l?.acceptable ?? []).map((a) => ({ clip: a.clip, startMs: a.startMs, endMs: a.endMs, level: "action" })) };
      }),
    });
    writeJson(path.join(dir, "labels.json"), imported);
    const pair = pairSchema.parse(readJson(path.join(dir, "pair.json")));
    pair.lock = { sha256: labelsDigest(imported), lockedAt: new Date().toISOString() };
    pair.firstRunAt = "2026-11-21T00:00:00.000Z"; // the 4.2 blind A/B ran on it
    writeJson(path.join(dir, "pair.json"), pairSchema.parse(pair));
    console.log(`${id}: imported, ${imported.shots.length} shots, locked`);
  }
}

// ---- Personal gym reel ---------------------------------------------------------------------
{
  const template = path.resolve("test-results/audio-ue/case1.template.supp");
  const id = "gym-personal-reel";
  const dir = path.join(pairsDir(), id);
  if (fs.existsSync(path.join(dir, "pair.json"))) console.log(`${id}: already prepared`);
  else if (!fs.existsSync(template)) console.log(`${id}: ${template} is missing; skipped`);
  else {
    const videos = readJson(template).assets.filter((a) => a.kind === "video").map((a) => a.path.replace(/^\\\\\?\\/, ""));
    if (!videos.every((f) => fs.existsSync(f))) console.log(`${id}: a source video is missing; skipped`);
    else {
      copyInto(dir, [[videos[0], "reference" + path.extname(videos[0])], ...videos.slice(1).map((f) => [f, path.basename(f)])]);
      await preparePair(dir, { category: "gym", footage: "different", split: "seen", name: "Personal gym reel", provenance: "test-results/audio-ue/case1 (every matrix since 4.1)" });
      console.log(`${id}: prepared; label it on the labelling page`);
    }
  }
}
