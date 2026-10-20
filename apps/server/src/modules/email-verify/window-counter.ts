import { LRUCache } from 'lru-cache';

/**
 * Counts uses per key inside a window that starts at the first use, in memory.
 * A restart forgets the counts, which only forgives one window. The least
 * recently used keys are dropped past `capacity`, so a flood of distinct keys
 * cannot grow it without bound.
 */
export class WindowCounter {
  private readonly counts: LRUCache<string, number>;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    capacity = 1_000,
  ) {
    this.counts = new LRUCache<string, number>({
      max: capacity,
      // lru-cache binds the global clock once, at import; reading it per call
      // lets a replaced clock (fake timers) take effect.
      perf: { now: () => performance.now() },
    });
  }

  /** Counts one use of `key`; `false` (and nothing counted) once the window's uses are gone. */
  tryConsume(key: string): boolean {
    const used = this.counts.get(key) ?? 0;
    if (used >= this.max) return false;
    if (used === 0) this.counts.set(key, 1, { ttl: this.windowMs });
    else this.counts.set(key, used + 1, { noUpdateTTL: true });
    return true;
  }
}
