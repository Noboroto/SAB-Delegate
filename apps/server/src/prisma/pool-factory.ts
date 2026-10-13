import { setTimeout as sleep } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../config/database-url.js';
import { loadEnv } from '../config/env.js';

/**
 * A connect that hangs would hold the boot (and every request) forever with the
 * pg default of 0, so the wait is bounded.
 */
export const POOL_CONNECTION_TIMEOUT_MS = 5_000;
export const POOL_IDLE_TIMEOUT_MS = 10_000;

/**
 * Pinned on the session, not left to the server's setting: with a non-UTC
 * session the adapter shifts every timestamptz by the offset, and because the
 * write and the read shift symmetrically the data looks right while comparisons
 * against Postgres' own `now()` are wrong.
 */
export const UTC_SESSION_OPTIONS = '-c timezone=UTC';

const logger = new Logger('PostgresPool');

/**
 * Names only. Driver messages can carry the host, the user name or a fragment
 * of the connection string, so a failure is reported by error class and, when
 * the driver provides one, its short code (ECONNREFUSED, 28P01).
 */
export function errorLabel(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code)
    ? `${error.name} ${code}`
    : error.name;
}

/**
 * The 'error' listener is mandatory: an idle client that loses its connection
 * (a Postgres restart) emits on the pool, and an emitter without a listener
 * turns that into an uncaught exception that kills the process.
 */
export function createPool(
  connectionString: string,
  max: number,
  sessionOptions: string = UTC_SESSION_OPTIONS,
): Pool {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    options: sessionOptions,
  });
  pool.on('error', (error) => {
    logger.error(`Postgres pool error: ${errorLabel(error)}`);
  });
  return pool;
}

/**
 * The pool is built here and handed to the adapter, not left for the adapter
 * to create, because the owner of the pool is the one that has to end it.
 * The adapter ignores `connection_limit` in the URL, so `max` is the only
 * pool-size control.
 */
export function createPrismaConnection(
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  pool: Pool;
  adapter: PrismaPg;
} {
  const pool = createPool(resolveDatabaseUrl(env), loadEnv(env).DB_POOL_MAX);
  return { pool, adapter: new PrismaPg(pool) };
}

/**
 * 1 + 2 + 4 + 8 s of waiting between five tries, about 15 s. Postgres coming
 * up a few seconds after the server (a stack-wide restart) is absorbed; a
 * database that stays down ends the process, and the container's restart
 * policy does the long wait.
 */
export const DEFAULT_CONNECT_RETRY = {
  /** Total tries, the first one included. */
  attempts: 5,
  /** Wait after the first failure; doubles after each further one. */
  baseDelayMs: 1_000,
};

export type ConnectRetryPolicy = Readonly<typeof DEFAULT_CONNECT_RETRY>;

export class DatabaseConnectError extends Error {
  constructor(
    readonly attempts: number,
    lastError: string,
  ) {
    super(`Database unreachable after ${attempts} attempt(s); last error: ${lastError}`);
    this.name = 'DatabaseConnectError';
  }
}

/**
 * SQLSTATEs that no wait can fix: bad password, bad authorization spec, missing
 * database, missing privilege. Retrying only delays the failure by ~15 s and
 * repeats failed logins against the server.
 */
const PERMANENT_SQLSTATES: ReadonlySet<string> = new Set(['28P01', '28000', '3D000', '42501']);

function isPermanent(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && PERMANENT_SQLSTATES.has(code);
}

/**
 * Runs `connect` until it succeeds, the budget is spent or a permanent error
 * (see above) occurs. Every failure is
 * reported through `onFailure` by label only; the final one throws a
 * DatabaseConnectError that carries no driver message.
 */
export async function connectWithRetry(
  connect: () => Promise<void>,
  policy: ConnectRetryPolicy,
  onFailure: (failure: { attempt: number; label: string; retryInMs: number | undefined }) => void,
): Promise<void> {
  const attempts = Math.max(1, Math.floor(policy.attempts));
  for (let attempt = 1; ; attempt++) {
    try {
      await connect();
      return;
    } catch (error) {
      const label = errorLabel(error);
      if (attempt >= attempts || isPermanent(error)) {
        onFailure({ attempt, label, retryInMs: undefined });
        throw new DatabaseConnectError(attempt, label);
      }
      const retryInMs = policy.baseDelayMs * 2 ** (attempt - 1);
      onFailure({ attempt, label, retryInMs });
      await sleep(retryInMs);
    }
  }
}
