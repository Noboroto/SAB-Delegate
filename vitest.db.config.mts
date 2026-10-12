import { defineConfig } from 'vitest/config';
import { vitestMaxWorkers } from './vitest-workers.mjs';

// Specs named `*.db.spec.ts` run ONLY through this config (`pnpm test:db`),
// never through the root projects list, so `pnpm test` and the commit hook stay
// Docker-free. The global setup gives the run its own schema; a spec reaches it
// through requireDatabaseUrl() in vitest-test-database.mjs.
export default defineConfig({
  test: {
    name: 'db',
    root: import.meta.dirname,
    environment: 'node',
    include: ['**/*.db.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/src/generated/**'],
    // With no DB spec yet there is nothing to verify; the setup still enforces
    // TEST_REQUIRE_DB=1 whenever it runs.
    passWithNoTests: true,
    globalSetup: ['./vitest-db-global-setup.mjs'],
    pool: 'threads',
    hookTimeout: 30_000,
    testTimeout: 30_000,
    maxWorkers: vitestMaxWorkers(),
    env: { TZ: 'Asia/Ho_Chi_Minh' },
  },
});
