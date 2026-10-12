import { defineConfig } from 'vitest/config';
import { vitestMaxWorkers } from '../vitest-workers.mjs';

// Covers the repo-wide guard specs in this directory.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['*.test.ts'],
    pool: 'threads',
    isolate: false,
    maxWorkers: vitestMaxWorkers(),
    sequence: { groupOrder: 1 },
    env: { TZ: 'Asia/Ho_Chi_Minh' },
  },
});
