export type JobState =
  "Queued" | "Running" | "Paused" | "Completed" | "Failed" | "Cancelled";
export interface JobProgress {
  completed: number;
  total: number;
  unit: string;
  detail?: string;
}
export interface JobSnapshot {
  readonly id: string;
  readonly label: string;
  readonly scope: string;
  readonly state: JobState;
  readonly supportsPause: boolean;
  readonly pauseRequested: boolean;
  readonly progress?: Readonly<JobProgress>;
  readonly error?: string;
}
export interface JobContext {
  readonly signal: AbortSignal;
  report(progress: JobProgress): void;
  /** Cooperative yield. A pausable worker must call this between bounded work units. */
  checkpoint(): Promise<void>;
}
export type JobOutcome<T> =
  | { state: "Completed"; result: T }
  | { state: "Failed"; error: string }
  | { state: "Cancelled" };
export interface JobHandle<T> {
  id: string;
  finished: Promise<JobOutcome<T>>;
}
export interface JobSpec<T> {
  label: string;
  scope: string;
  supportsPause?: boolean;
  run(context: JobContext): Promise<T>;
}
interface Entry {
  snapshot: JobSnapshot;
  controller: AbortController;
  spec: JobSpec<unknown>;
  settle(outcome: JobOutcome<unknown>): void;
  wake?: () => void;
  settled: boolean;
  executing: boolean;
}
const terminal = (state: JobState) =>
  ["Completed", "Failed", "Cancelled"].includes(state);
const abortError = () => new DOMException("Job cancelled", "AbortError");

/** In-memory shared queue. No synthetic progress, timers estimating work, or persisted promises. */
export class JobScheduler {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshots: readonly JobSnapshot[] = Object.freeze([]);
  private active = 0;
  constructor(
    private concurrency = 1,
    private capacity = 100,
  ) {
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isInteger(capacity) ||
      capacity < concurrency
    )
      throw new Error("Invalid job queue limits");
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshots;
  enqueue<T>(spec: JobSpec<T>): JobHandle<T> {
    if (this.entries.size >= this.capacity) {
      const removable = [...this.entries].find(
        ([, e]) => e.settled && !e.executing,
      );
      if (removable) this.entries.delete(removable[0]);
      else throw new Error("Background job queue is full");
    }
    const id = crypto.randomUUID();
    let resolve!: (outcome: JobOutcome<unknown>) => void;
    const finished = new Promise<JobOutcome<unknown>>((r) => {
      resolve = r;
    });
    const entry: Entry = {
      snapshot: Object.freeze({
        id,
        label: spec.label,
        scope: spec.scope,
        state: "Queued",
        supportsPause: !!spec.supportsPause,
        pauseRequested: false,
      }),
      controller: new AbortController(),
      spec,
      settle: resolve,
      settled: false,
      executing: false,
    };
    this.entries.set(id, entry);
    this.emit();
    queueMicrotask(() => this.pump());
    return { id, finished: finished as Promise<JobOutcome<T>> };
  }
  cancel(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || terminal(entry.snapshot.state)) return false;
    entry.controller.abort();
    entry.wake?.();
    this.finish(entry, { state: "Cancelled" });
    // An uncooperative executor retains its concurrency slot until it actually stops.
    this.pump();
    return true;
  }
  pause(id: string): boolean {
    const entry = this.entries.get(id);
    if (
      !entry ||
      !entry.snapshot.supportsPause ||
      entry.snapshot.state !== "Running" ||
      entry.snapshot.pauseRequested
    )
      return false;
    this.update(entry, { pauseRequested: true });
    return true;
  }
  resume(id: string): boolean {
    const entry = this.entries.get(id);
    if (
      !entry ||
      !entry.snapshot.pauseRequested ||
      terminal(entry.snapshot.state)
    )
      return false;
    this.update(entry, { pauseRequested: false, state: "Running" });
    entry.wake?.();
    return true;
  }
  private emit() {
    this.snapshots = Object.freeze(
      [...this.entries.values()].map((e) => e.snapshot),
    );
    for (const listener of this.listeners) listener();
  }
  private update(entry: Entry, patch: Partial<JobSnapshot>) {
    entry.snapshot = Object.freeze({ ...entry.snapshot, ...patch });
    this.emit();
  }
  private finish(entry: Entry, outcome: JobOutcome<unknown>) {
    if (entry.settled) return;
    entry.settled = true;
    this.update(entry, {
      state: outcome.state,
      pauseRequested: false,
      ...(outcome.state === "Failed" ? { error: outcome.error } : {}),
    });
    entry.settle(outcome);
  }
  private pump() {
    for (const entry of this.entries.values()) {
      if (this.active >= this.concurrency) break;
      if (entry.snapshot.state !== "Queued") continue;
      this.active++;
      entry.executing = true;
      this.update(entry, { state: "Running" });
      void this.run(entry);
    }
  }
  private async run(entry: Entry) {
    const signal = entry.controller.signal;
    const checkpoint = async () => {
      if (signal.aborted) throw abortError();
      if (entry.snapshot.pauseRequested) {
        await new Promise<void>((resolve) => {
          entry.wake = resolve;
          this.update(entry, { state: "Paused" });
          if (!entry.snapshot.pauseRequested || signal.aborted) resolve();
        });
        entry.wake = undefined;
      }
      if (signal.aborted) throw abortError();
    };
    try {
      await checkpoint();
      const result = await entry.spec.run({
        signal,
        checkpoint,
        report: (progress) => {
          if (entry.settled || signal.aborted) return;
          if (
            !Number.isFinite(progress.completed) ||
            !Number.isFinite(progress.total) ||
            progress.total <= 0 ||
            progress.completed < 0 ||
            progress.completed > progress.total
          )
            throw new Error("Invalid job progress");
          const previous = entry.snapshot.progress;
          if (
            previous &&
            (previous.total !== progress.total ||
              previous.unit !== progress.unit ||
              previous.completed > progress.completed)
          )
            throw new Error(
              "Job progress must be monotonic within one work unit",
            );
          this.update(entry, { progress: Object.freeze({ ...progress }) });
        },
      });
      await checkpoint();
      this.finish(
        entry,
        signal.aborted
          ? { state: "Cancelled" }
          : { state: "Completed", result },
      );
    } catch (error) {
      this.finish(
        entry,
        signal.aborted
          ? { state: "Cancelled" }
          : {
              state: "Failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Background job failed",
            },
      );
    } finally {
      entry.executing = false;
      this.active--;
      this.pump();
    }
  }
}

export const backgroundJobs = new JobScheduler();
