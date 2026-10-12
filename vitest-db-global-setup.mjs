import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUN_SCHEMA_VARIABLE,
  RUN_URL_VARIABLE,
  isDatabaseRequired,
  isReachable,
  testDatabaseBaseUrl,
} from './vitest-test-database.mjs';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), 'apps', 'server');

/**
 * Runs the server package's own Prisma CLI through this Node binary, so the
 * version and the prisma.config.ts are the ones the release job uses.
 *
 * @param {string[]} args
 * @param {string} url
 * @param {string} [input]
 */
function runPrisma(args, url, input) {
  const resolveFromServer = createRequire(join(SERVER_DIR, 'package.json'));
  const cli = join(dirname(resolveFromServer.resolve('prisma/package.json')), 'build', 'index.js');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    input,
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma ${args.join(' ')} failed on the test database (exit ${String(result.status)}):\n` +
        `${result.stdout}${result.stderr}`,
    );
  }
}

/**
 * Gives this run a private schema, filled by the committed migrations, so
 * concurrent runs and leftovers of a crashed one never see each other's rows.
 * The schema is dropped again on teardown; the server and its other schemas
 * are left alone.
 */
export default async function setup() {
  const baseUrl = testDatabaseBaseUrl();
  if (!(await isReachable(baseUrl))) {
    const { hostname, port } = new URL(baseUrl);
    if (isDatabaseRequired()) {
      throw new Error(
        `TEST_REQUIRE_DB=1 but nothing listens on ${hostname}:${port}. Start it with \`pnpm test-db:start\`.`,
      );
    }
    // Specs find no run URL and fail in requireDatabaseUrl(); nothing is skipped.
    console.warn(`[test-db] ${hostname}:${port} is unreachable; DB specs will fail.`);
    return undefined;
  }

  const schema = `test_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const runUrl = new URL(baseUrl);
  runUrl.searchParams.set('schema', schema);

  // `migrate deploy` creates the schema named in the URL when it is missing.
  runPrisma(['migrate', 'deploy'], runUrl.toString());
  process.env[RUN_URL_VARIABLE] = runUrl.toString();
  process.env[RUN_SCHEMA_VARIABLE] = schema;

  return () => {
    runPrisma(['db', 'execute', '--stdin'], baseUrl, `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
  };
}
