import { defineConfig } from 'vitest/config';

// One Vitest process with one global scheduler packs every workspace's test
// files onto the available cores, avoiding the oversubscription `pnpm -r test`
// would cause by spawning a separate Vitest per package.
export default defineConfig({
  test: {
    projects: [
      'scripts/vitest.config.ts',
      'packages/shared/vitest.config.mts',
      'apps/server/vitest.config.mts',
    ],
  },
});
