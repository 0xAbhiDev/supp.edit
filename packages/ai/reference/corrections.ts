/** Take choices as corrections (step 7 of the any-footage plan).
 *
 * When a person replaces a recreated shot's source moment with another take, they have labelled
 * that shot: this moment plays it better than the one chosen. The desktop app appends each choice
 * to a local file (src-tauri corrections.rs: take-corrections.jsonl in the app's data folder),
 * nothing leaves the computer, and the evaluation scripts read it as evidence for tuning
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
