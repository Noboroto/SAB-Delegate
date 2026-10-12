import { defineConfig } from 'vitest/config';
import { vitestMaxWorkers } from '../../vitest-workers.mjs';

export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pure schemas and source scans with no module-level mutable state, so one
    // shared worker context per thread is safe and skips per-file setup.
    pool: 'threads',
    isolate: false,
    // Projects sharing a groupOrder must agree on maxWorkers.
    maxWorkers: vitestMaxWorkers(),
    sequence: { groupOrder: 1 },
    env: { TZ: 'Asia/Ho_Chi_Minh' },
  },
});
