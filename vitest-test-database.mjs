import { connect } from 'node:net';

// Loopback only, a fixed port (never "the next free one") and a name ending in
// `_test`: the harness creates and drops schemas here, so it must never be
// pointed at a database that holds real data.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const DEFAULT_TEST_DATABASE_URL = 'postgresql://sab_test@127.0.0.1:5451/sab_test';

/** Set by the global setup for the specs of ONE run; DATABASE_URL is never read. */
export const RUN_URL_VARIABLE = 'SAB_TEST_DATABASE_URL';
export const RUN_SCHEMA_VARIABLE = 'SAB_TEST_DATABASE_SCHEMA';

/**
 * The server a run connects to, before its private schema is appended.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function testDatabaseBaseUrl(env = process.env) {
  const url = env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const { hostname, pathname } = new URL(url);
  if (!LOOPBACK_HOSTS.has(hostname)) {
    // The host only, never the URL: it can carry a password.
    throw new Error(
      `TEST_DATABASE_URL must point at this machine (localhost, 127.0.0.1 or ::1), not "${hostname}".`,
    );
  }
  const database = pathname.replace(/^\//, '');
  if (!database.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must name a database ending in "_test".');
  }
  return url;
}

/**
 * With TEST_REQUIRE_DB=1 a missing database fails the run itself, even when no
 * spec would have touched it. A run that quietly skips its database specs
 * reports green without having checked anything.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function isDatabaseRequired(env = process.env) {
  return env.TEST_REQUIRE_DB === '1';
}

/**
 * A TCP connect is enough to tell "server is down" from "server is up": the
 * migration that follows reports any authentication or schema problem itself.
 *
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function isReachable(url, timeoutMs = 2000) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port || 5432) });
    const done = (/** @type {boolean} */ ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Fail-closed accessor for specs. A spec that skips itself when no database is
 * reachable still counts as passed, so every DB spec calls this (in
 * `beforeAll` or at module scope) and gets a thrown error instead.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string, schema: string }}
 */
export function requireDatabaseUrl(env = process.env) {
  const url = env[RUN_URL_VARIABLE];
  const schema = env[RUN_SCHEMA_VARIABLE];
  if (!url || !schema) {
    throw new Error(
      'The test database is not available. Start it with `pnpm test-db:start` and run the ' +
        'spec through `pnpm test:db`; a DB spec must fail, not skip, without it.',
    );
  }
  return { url, schema };
}
