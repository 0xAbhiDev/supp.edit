/** Take choices as corrections (step 7 of the any-footage plan).
 *
 * When a person replaces a recreated shot's source moment with another take, they have labelled
 * that shot: this moment plays it better than the one chosen. The desktop app appends each choice
 * to a local file (src-tauri corrections.rs: take-corrections.jsonl in the app's data folder),
 * nothing leaves the computer. The next recreation of the same reel from the same footage reads
 * them back (`takesFor`, `takeChoiceShift`): a moment chosen for a shot leads for that shot, and a
 * replaced one falls back. The evaluation scripts read them as evidence for tuning
 * (scripts/eval/corrections.mjs). Files are identified by fingerprint, not by name or path. */
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface TakeChoice {
  /** When the choice was made (ISO time). */
  at: string;
  reference: { fingerprint: string; durationMs: number };
  /** The reference shot the choice is for. */
  shot: { startMs: number; endMs: number; role?: string };
  rejected: { fingerprint: string; inMs: number; outMs: number; label?: string; certainty?: number };
  chosen: { fingerprint: string; inMs: number; outMs: number; lostOn?: string };
  mode?: string;
}

/** Record one take choice; never throws (a correction log must not break editing). */
export async function recordTakeChoice(choice: TakeChoice) {
  if (!isTauri()) return;
  try {
    await invoke("record_take_choice", { entry: choice });
  } catch {
    // Not recorded: editing goes on.
  }
}

/** All recorded take choices (oldest first); none outside the desktop app or on any failure. */
export async function readTakeChoices(): Promise<TakeChoice[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<TakeChoice[]>("read_take_choices");
  } catch {
    return [];
  }
}

/** One moment, for one reference shot. */
export interface TakenMoment {
  shotStartMs: number;
  shotEndMs: number;
  inMs: number;
  outMs: number;
}
/** What the person chose and replaced in one clip, for one reel. */
export interface SourceTakes {
  chosen: TakenMoment[];
  rejected: TakenMoment[];
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const sameShot = (m: { shotStartMs: number; shotEndMs: number }, s0: number, s1: number) =>
  overlap(m.shotStartMs, m.shotEndMs, s0, s1) >= 0.5 * Math.min(m.shotEndMs - m.shotStartMs, s1 - s0);
const sameMoment = (m: { inMs: number; outMs: number }, i0: number, i1: number) => overlap(m.inMs, m.outMs, i0, i1) >= 0.5 * Math.min(m.outMs - m.inMs, i1 - i0);

/** This clip's choices for this reel, in the order made. A later choice overrides an earlier one
 * for the same shot: a moment replaced and then chosen again is chosen. */
export function takesFor(choices: readonly TakeChoice[], referenceFingerprint: string, sourceFingerprint: string): SourceTakes | undefined {
  let chosen: TakenMoment[] = [],
    rejected: TakenMoment[] = [];
  const mine = choices.filter((c) => c?.reference?.fingerprint === referenceFingerprint && c.shot).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const c of mine) {
    const s0 = c.shot.startMs,
      s1 = c.shot.endMs;
    const without = (list: TakenMoment[], m: { inMs: number; outMs: number }) => list.filter((x) => !(sameShot(x, s0, s1) && sameMoment(x, m.inMs, m.outMs)));
    if (c.rejected?.fingerprint === sourceFingerprint) {
      chosen = without(chosen, c.rejected);
      rejected = [...without(rejected, c.rejected), { shotStartMs: s0, shotEndMs: s1, inMs: c.rejected.inMs, outMs: c.rejected.outMs }];
    }
    if (c.chosen?.fingerprint === sourceFingerprint) {
      rejected = without(rejected, c.chosen);
      // One chosen moment per shot: the latest.
      chosen = [...chosen.filter((x) => !sameShot(x, s0, s1)), { shotStartMs: s0, shotEndMs: s1, inMs: c.chosen.inMs, outMs: c.chosen.outMs }];
    } else if (c.chosen) {
      // Chosen from another clip: this clip's earlier choice for the shot no longer stands.
      chosen = chosen.filter((x) => !sameShot(x, s0, s1));
    }
  }
  return chosen.length || rejected.length ? { chosen, rejected } : undefined;
}

/** How much a window's score moves for a reference shot: up where the person chose this moment
 * for this shot, down by as much where they replaced it. */
export const TAKE_SHIFT = 0.2;
export function takeChoiceShift(takes: SourceTakes | undefined, shotStartMs: number, shotEndMs: number, inMs: number, outMs: number) {
  if (!takes) return 0;
  if (takes.chosen.some((m) => sameShot(m, shotStartMs, shotEndMs) && sameMoment(m, inMs, outMs))) return TAKE_SHIFT;
  if (takes.rejected.some((m) => sameShot(m, shotStartMs, shotEndMs) && sameMoment(m, inMs, outMs))) return -TAKE_SHIFT;
  return 0;
}
