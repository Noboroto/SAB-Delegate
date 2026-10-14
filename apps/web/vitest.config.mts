import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { vitestMaxWorkers } from '../../vitest-workers.mjs';

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') } },
  plugins: [react()],
  test: {
    name: 'web',
    root: import.meta.dirname,
    // RTL unmounts after each test through the global `afterEach`.
    globals: true,
    environment: 'happy-dom',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    setupFiles: ['./vitest.setup.ts'],
    unstubGlobals: true,
    // Projects sharing a groupOrder must agree on maxWorkers.
    maxWorkers: vitestMaxWorkers(),
    sequence: { groupOrder: 0 },
    env: { TZ: 'Asia/Ho_Chi_Minh' },
  },
});
