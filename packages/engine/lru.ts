/** Byte- and entry-bounded least-recently-used storage with explicit ownership. */
export class LruCache<K, V> {
  private entries = new Map<K, { value: V; bytes: number }>();
  bytes = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
  constructor(
    readonly maxBytes: number,
    readonly maxEntries: number,
    private release: (v: V) => void = () => {},
  ) {}
  get size() {
    return this.entries.size;
  }
  has(key: K) {
    return this.entries.has(key);
  }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return;
    }
    this.hits++;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: K, value: V, bytes: number): boolean {
    this.delete(key);
    if (
      !Number.isFinite(bytes) ||
      bytes < 0 ||
      bytes > this.maxBytes ||
      this.maxEntries < 1
    ) {
      this.release(value);
      return false;
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      this.delete(this.entries.keys().next().value!);
      this.evictions++;
    }
    return true;
  }
  delete(key: K) {
    const e = this.entries.get(key);
    if (e) {
      this.entries.delete(key);
      this.bytes -= e.bytes;
      this.release(e.value);
    }
  }
  clear() {
    for (const key of this.entries.keys()) this.delete(key);
  }
}
