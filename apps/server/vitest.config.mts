import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';
import { vitestMaxWorkers } from '../../vitest-workers.mjs';

export default defineConfig({
  plugins: [
    // esbuild/oxc do not emit decorator metadata, so Nest's constructor
    // injection would see `undefined` types in specs.
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Database specs need the schema-per-run setup of the DB config and fail
    // closed without it.
    exclude: ['**/*.db.spec.ts', ...configDefaults.exclude],
    pool: 'threads',
    hookTimeout: 30_000,
    testTimeout: 20_000,
    // Projects sharing a groupOrder must agree on maxWorkers.
    maxWorkers: vitestMaxWorkers(),
    sequence: { groupOrder: 1 },
    env: { TZ: 'Asia/Ho_Chi_Minh' },
  },
});
