// The operator sets only POSTGRES_* (one source shared with the Postgres
// container); the connection string is derived here so a password containing
// URL-reserved characters cannot break parsing.

const DEFAULT_HOST = 'sab-postgres';
const DEFAULT_PORT = '5432';

// Values are variable NAMES. The key is `passwordVar`, not `password`, so a
// secret scanner does not read the name as a hard-coded password.
const ROLE_VARIABLES = {
  runtime: { user: 'POSTGRES_USER', passwordVar: 'POSTGRES_PASSWORD' },
  // The migrate role owns the schema; only the release job should hold it.
  migrate: { user: 'POSTGRES_MIGRATE_USER', passwordVar: 'POSTGRES_MIGRATE_PASSWORD' },
} as const;

type DatabaseRole = keyof typeof ROLE_VARIABLES;

// Values arrive from compose files and shells; stray whitespace around a name
// or port would otherwise surface as an opaque connection failure.
function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === '' ? undefined : result;
}

function parsePort(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new Error('POSTGRES_PORT must be an integer from 1 to 65535');
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error('POSTGRES_PORT must be an integer from 1 to 65535');
  return String(port);
}

// A bare IPv6 literal contains colons, which a URL authority reads as the port
// separator.
function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function resolveDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
  role: DatabaseRole = 'runtime',
): string {
  const variables = ROLE_VARIABLES[role];
  const user = trimmed(env[variables.user]);
  // Never trimmed: a password is opaque, and the release job and the Postgres
  // container read the same variable verbatim. Only an all-blank value is
  // treated as missing.
  const rawPassword = env[variables.passwordVar];
  const password = rawPassword?.trim() === '' ? undefined : rawPassword;
  const database = trimmed(env['POSTGRES_DB']);

  // Names only: the values are credentials.
  const missing = [
    [variables.user, user],
    [variables.passwordVar, password],
    ['POSTGRES_DB', database],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (!user || !password || !database) {
    throw new Error(`Cannot build a database URL, missing: ${missing.join(', ')}`);
  }

  const host = formatHost(trimmed(env['POSTGRES_HOST']) ?? DEFAULT_HOST);
  const port = parsePort(trimmed(env['POSTGRES_PORT']) ?? DEFAULT_PORT);
  return (
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${encodeURIComponent(database)}`
  );
}
