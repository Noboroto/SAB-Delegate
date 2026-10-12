// The operator sets only POSTGRES_* (one source shared with the Postgres
// container); the connection string is derived here so a password containing
// URL-reserved characters cannot break parsing.

const DEFAULT_HOST = 'sab-postgres';
const DEFAULT_PORT = '5432';

const ROLE_VARIABLES = {
  runtime: { user: 'POSTGRES_USER', password: 'POSTGRES_PASSWORD' },
  // The migrate role owns the schema; only the release job should hold it.
  migrate: { user: 'POSTGRES_MIGRATE_USER', password: 'POSTGRES_MIGRATE_PASSWORD' },
} as const;

type DatabaseRole = keyof typeof ROLE_VARIABLES;

export function resolveDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
  role: DatabaseRole = 'runtime',
): string {
  const variables = ROLE_VARIABLES[role];
  const user = env[variables.user];
  const password = env[variables.password];
  const database = env['POSTGRES_DB'];

  // Names only: the values are credentials.
  const missing = [
    [variables.user, user],
    [variables.password, password],
    ['POSTGRES_DB', database],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (!user || !password || !database) {
    throw new Error(`Cannot build a database URL, missing: ${missing.join(', ')}`);
  }

  const host = env['POSTGRES_HOST'] || DEFAULT_HOST;
  const port = env['POSTGRES_PORT'] || DEFAULT_PORT;
  return (
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${encodeURIComponent(database)}`
  );
}
