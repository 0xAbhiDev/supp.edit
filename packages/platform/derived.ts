import { useSyncExternalStore } from "react";
import { LruCache } from "../engine/lru";
import { readLocal, writeLocal, deleteLocal } from "./storage";
let revision = 0;
const listeners = new Set<() => void>();
function changed() {
  revision++;
  listeners.forEach((fn) => fn());
}
export const useDerivedRevision = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => revision,
  );
export class DerivedMemory<V> {
  private cache: LruCache<string, V>;
  constructor(
    bytes: number,
    entries: number,
    private sizeOf: (v: V) => number,
  ) {
    this.cache = new LruCache(bytes, entries);
  }
  has(key: string) {
    return this.cache.has(key);
  }
  get(key: string) {
    return this.cache.get(key);
  }
  set(key: string, value: V) {
    this.cache.set(key, value, this.sizeOf(value));
    changed();
    return this;
  }
  delete(key: string) {
    this.cache.delete(key);
    changed();
  }
}
type Entry = { key: string; bytes: number };
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>) {
  const next = queue.catch(() => undefined).then(fn);
  queue = next;
  return next;
}
async function touch(key: string, bytes?: number) {
  let index = (await readLocal<Entry[]>("state", "derived:index")) ?? [];
  const old = index.find((e) => e.key === key);
  index = index.filter((e) => e.key !== key);
  if (bytes !== undefined || old)
    index.push({ key, bytes: bytes ?? old!.bytes });
  let total = index.reduce((n, e) => n + e.bytes, 0);
  while (total > 64 * 1024 * 1024 || index.length > 512) {
    const entry = index.shift()!;
    total -= entry.bytes;
    if (entry.key.startsWith("derived:") && entry.key !== "derived:index")
      await deleteLocal("state", entry.key);
  }
  await writeLocal("state", "derived:index", index);
}
export function readDerived<T>(key: string) {
  return serialized(async () => {
    const value = await readLocal<T>("state", `derived:${key}`);
    if (value !== undefined) await touch(`derived:${key}`);
    return value;
  });
}
export function writeDerived(key: string, value: unknown, bytes: number) {
  return serialized(async () => {
    if (bytes > 64 * 1024 * 1024) return;
    await writeLocal("state", `derived:${key}`, value);
    await touch(`derived:${key}`, bytes);
  });
}
