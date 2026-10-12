import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './src/config/database-url.js';

// An explicit DATABASE_URL wins (the test harness points it at a throwaway
// schema); otherwise the migrate role's URL is derived from POSTGRES_*.
function resolveUrl(): string | undefined {
  const explicit = process.env['DATABASE_URL'];
  if (explicit) return explicit;
  try {
    return resolveDatabaseUrl(process.env, 'migrate');
  } catch {
    return undefined;
  }
}

const databaseUrl = resolveUrl();

// `prisma generate` never connects, so it may run with no database at all. Any
// other command that fell back to a placeholder would fail deep inside Prisma
// with a connection error, or worse reach an unrelated local Postgres.
if (!databaseUrl && !process.argv.includes('generate')) {
  throw new Error(
    'No database URL: set DATABASE_URL, or POSTGRES_DB with POSTGRES_MIGRATE_USER and POSTGRES_MIGRATE_PASSWORD.',
  );
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl ?? 'postgresql://unset:unset@invalid.invalid:5432/unset' },
});
