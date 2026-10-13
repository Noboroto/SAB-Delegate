import os from 'node:os';

/**
 * One `maxWorkers` for every Vitest project in this repo. Vitest refuses to
 * start when projects sharing a `groupOrder` disagree on it, so no config may
 * hardcode its own value.
 *
 * Sized per machine rather than a single constant, because an unsized worker
 * count can drive a loaded dev machine's free RAM to near zero mid-suite and
 * produce failures that only appear under load:
 * - macOS: half the logical cores (Apple silicon splits performance/efficiency
 *   cores, so the logical count overstates usable capacity).
 * - other OSes: capped at 8.
 * - every OS: at most one worker per 4 GB of RAM.
 * The floor of 2 wins over both caps: a box too small for two workers cannot
 * run this suite in a usable time either way.
 * `VITEST_MAX_WORKERS` overrides all of it, for benchmarking or a CI-like box.
 *
 * @returns {number}
 */
export function vitestMaxWorkers() {
  const override = Number.parseInt(process.env.VITEST_MAX_WORKERS ?? '', 10);
  if (Number.isInteger(override) && override > 0) return override;

  const cores = os.availableParallelism();
  const byCpu = process.platform === 'darwin' ? Math.floor(cores / 2) : Math.min(8, cores);
  const byMemory = Math.floor(os.totalmem() / 4 / 1024 ** 3);
  return Math.max(2, Math.min(byCpu, byMemory));
}
