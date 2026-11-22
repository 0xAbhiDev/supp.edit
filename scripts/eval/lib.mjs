// The evaluation set: real reference-plus-footage pairs, labelled by a person before any build runs
// on them. Nothing in the application imports this; labels never reach production decisions.
//
// Layout (git-ignored, private: work/eval, or SUPP_EVAL_DIR):
//   pairs/<id>/reference.<ext>      the reference reel
//   pairs/<id>/<raw clips>          every other video in the folder is raw footage
//   pairs/<id>/pair.json            written by preparation: files, hashes, draft shots, split
//   pairs/<id>/labels.json          written by the labelling page
//   pairs/<id>/project.template.supp  the project the app opens (reference first, then raw)
//   runs/<stamp>-<build>/           one run of the app over the set, and its score card
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";

export const evalDir = () => path.resolve(process.env.SUPP_EVAL_DIR || "work/eval");
export const pairsDir = () => path.join(evalDir(), "pairs");
export const runsDir = () => path.join(evalDir(), "runs");

export const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
export const CATEGORIES = ["gym", "cooking", "travel", "vlog", "talking", "product", "dance", "sports", "event", "pets", "real estate", "other"];
/** own: the reference was cut from this footage. different: the footage is other recordings. */
export const FOOTAGE = ["own", "different"];
/** open: used while developing. blind: scored only at release checks. seen: already used for tuning. */
export const SPLITS = ["open", "blind", "seen"];
export const ROLES = {
  opener: "sets the scene (wide, establishing)",
  action: "the subject doing the main thing",
  detail: "a close-up of hands, an object or a texture",
  face: "a face: a reaction or talking to camera",
  reveal: "the result, payoff or before/after",
  passing: "movement or b-roll between moments",
  card: "a title or end card with little footage",
  other: "none of these",
};
export const ENERGY = ["still", "steady", "building", "peak"];
/** How well a raw range fills a shot, best first. */
export const LEVELS = {
  exact: "the very moment the reference used (own footage only)",
  action: "the same action or subject, another moment or recording",
  role: "something else that does this shot's job",
};
const LEVEL_ORDER = ["exact", "action", "role"];
/** A pick counts as inside a range when this share of it lies inside. */
export const INSIDE = 0.8;

const media = z.object({
  file: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  fps: z.number().nonnegative(),
  codec: z.string(),
  proxy: z.string().optional(),
});
export const pairSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(CATEGORIES),
  footage: z.enum(FOOTAGE),
  split: z.enum(SPLITS),
  createdAt: z.string(),
  provenance: z.string().optional(),
  reference: media,
  raw: z.array(media).min(1),
  draftShots: z.array(z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })),
  template: z.string(),
  lock: z.object({ sha256: z.string(), lockedAt: z.string() }).optional(),
  firstRunAt: z.string().optional(),
  relabelledAfterRun: z.boolean().optional(),
});
const range = z.object({ clip: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), level: z.enum(LEVEL_ORDER) }).refine((r) => r.endMs > r.startMs, "A range must end after it starts.");
export const labelsSchema = z.object({
  version: z.literal(1),
  labelledBy: z.string().optional(),
  updatedAt: z.string(),
  shots: z
    .array(
      z.object({
        shot: z.number().int().positive(),
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
        shows: z.string(),
        role: z.enum(Object.keys(ROLES)).nullable(),
        energy: z.enum(ENERGY).nullable(),
        action: z.string(),
        acceptable: z.array(range),
        note: z.string(),
        done: z.boolean(),
      }),
    )
    .min(1),
});

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
export const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 1));
export const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1 << 20);
    for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0; ) hash.update(buffer.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}
/** The labels' identity: their content without the edit time. */
export const labelsDigest = (labels) => sha256(JSON.stringify(labels.shots));

/** Why a labelled shot is not ready yet (empty when it is). */
export function shotProblems(shot) {
  const problems = [];
  if (!shot.shows.trim()) problems.push("say what it shows");
  if (!shot.role) problems.push("choose its role");
  if (!shot.energy) problems.push("choose its energy");
  if (!shot.done) problems.push("mark it done");
  return problems;
}

/** Every pair folder and how far it has got. */
export function listPairs() {
  const root = pairsDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(root, d.name);
      const pairFile = path.join(dir, "pair.json"),
        labelsFile = path.join(dir, "labels.json");
      if (!fs.existsSync(pairFile)) {
        const files = fs.readdirSync(dir).filter((f) => VIDEO.test(f));
        return { id: d.name, prepared: false, files, hasReference: files.some((f) => /^reference\./i.test(f)) };
      }
      const pair = pairSchema.parse(readJson(pairFile));
      const labels = fs.existsSync(labelsFile) ? labelsSchema.parse(readJson(labelsFile)) : undefined;
      const done = labels ? labels.shots.filter((s) => !shotProblems(s).length).length : 0;
      return { id: d.name, prepared: true, name: pair.name, category: pair.category, footage: pair.footage, split: pair.split, shots: labels?.shots.length ?? 0, done, locked: !!pair.lock, ran: !!pair.firstRunAt, relabelledAfterRun: !!pair.relabelledAfterRun };
    });
}

// ---- Grading ---------------------------------------------------------------------------------

/** The app's picks from its "Why each source moment was chosen" rows (the first automatic edit,
 * before anything is edited). Clip names are matched against the pair's own files, so names with
 * spaces work. */
export function parsePicks(rows, clips) {
  const names = [...clips].sort((a, b) => b.length - a.length);
  return rows
    .map((t) => {
      const at = t.match(/^(\d+) ([\d.]+)–([\d.]+) s /);
      const source = [...t.matchAll(/ @ ([\d.]+)–([\d.]+) s/g)][0];
      if (!at || !source) return null;
      const before = t.slice(0, source.index);
      const clip = names.find((n) => before.endsWith(" " + n) || before.endsWith(n));
      if (!clip) return null;
      const confidence = t.match(/confidence (\d+)%/);
      const label = /best available candidate|No close source match/.test(t) ? "best available" : /close match/.test(t) ? "close match" : "unlabelled";
      return {
        appShot: Number(at[1]),
        refStartMs: Math.round(Number(at[2]) * 1000),
        refEndMs: Math.round(Number(at[3]) * 1000),
        clip,
        inMs: Math.round(Number(source[1]) * 1000),
        outMs: Math.round(Number(source[2]) * 1000),
        confidence: confidence ? Number(confidence[1]) : null,
        label,
      };
    })
    .filter(Boolean);
}

/** The explanation rows a driver log recorded. */
export function rowsFromLog(text) {
  const line = text.split("\n").find((l) => l.includes("Explained each choice"));
  if (!line) return undefined;
  return JSON.parse(line.replace(/^.*?Explained each choice /, "")).rows;
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Grade one pair: each labelled shot against the app pick that covers most of it. */
export function gradePair(labels, picks) {
  const shots = labels.shots.map((shot) => {
    const pick = picks
      .map((p) => ({ p, o: overlap(p.refStartMs, p.refEndMs, shot.startMs, shot.endMs) }))
      .filter((x) => x.o > 0)
      .sort((a, b) => b.o - a.o)[0]?.p;
    const has = (levels) => shot.acceptable.some((a) => levels.includes(a.level));
    const actionAvailable = has(["exact", "action"]),
      exactAvailable = has(["exact"]),
      roleAvailable = shot.acceptable.length > 0;
    let level = null;
    if (pick) {
      const len = Math.max(1, pick.outMs - pick.inMs);
      for (const l of LEVEL_ORDER)
        if (!level && shot.acceptable.some((a) => a.level === l && a.clip === pick.clip && overlap(pick.inMs, pick.outMs, a.startMs, a.endMs) / len >= INSIDE)) level = l;
    }
    const rightAction = level === "exact" || level === "action";
    const confident = pick?.label === "close match";
    return {
      shot: shot.shot,
      startMs: shot.startMs,
      endMs: shot.endMs,
      shows: shot.shows,
      role: shot.role,
      placed: !!pick,
      pick: pick ?? null,
      level,
      actionAvailable,
      exactAvailable,
      roleAvailable,
      rightAction,
      rightMoment: level === "exact",
      rightRole: level !== null,
      rightClip: !!pick && shot.acceptable.some((a) => (a.level === "exact" || a.level === "action") && a.clip === pick.clip),
      confident,
      falseConfident: confident && !rightAction,
      // A shot the footage lacks is flagged when the app placed something and did not call it a
      // close match; a shot it never placed is counted under "not placed" instead.
      flagged: !actionAvailable ? !!pick && !confident : null,
    };
  });
  return { shots, totals: totals(shots) };
}

const share = (n, d) => ({ n, d, text: `${n}/${d}` });
export function totals(shots) {
  const available = shots.filter((s) => s.actionAvailable),
    exact = shots.filter((s) => s.exactAvailable),
    role = shots.filter((s) => s.roleAvailable),
    unavailable = shots.filter((s) => !s.actionAvailable),
    confident = shots.filter((s) => s.confident);
  return {
    shots: shots.length,
    notPlaced: shots.filter((s) => !s.placed).length,
    rightAction: share(available.filter((s) => s.rightAction).length, available.length),
    rightMoment: share(exact.filter((s) => s.rightMoment).length, exact.length),
    rightClip: share(available.filter((s) => s.rightClip).length, available.length),
    rightRole: share(role.filter((s) => s.rightRole).length, role.length),
    unavailableFlagged: share(unavailable.filter((s) => s.flagged).length, unavailable.length),
    falseConfident: share(confident.filter((s) => s.falseConfident).length, confident.length),
  };
}

/** How often a pick at each confidence was the right action (calibration). */
export const BUCKETS = [
  [0, 50],
  [50, 65],
  [65, 80],
  [80, 101],
];
export function calibration(shots) {
  return BUCKETS.map(([lo, hi]) => {
    const inside = shots.filter((s) => s.pick && s.pick.confidence !== null && s.pick.confidence >= lo && s.pick.confidence < hi);
    return { from: lo, to: Math.min(100, hi), shots: inside.length, rightAction: inside.filter((s) => s.rightAction).length };
  });
}
