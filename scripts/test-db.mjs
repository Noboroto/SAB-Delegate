// Starts and stops the throwaway Postgres behind the DB specs
// (docker/test-db.compose.yml) and keeps the machine-wide port registry honest:
// a line is written when the database is up and removed when it is stopped, so
// other sessions can see who holds 5451 instead of guessing and picking another
// port.
//
//   node scripts/test-db.mjs start | stop
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDatabaseBaseUrl } from '../vitest-test-database.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = join(ROOT, 'docker', 'test-db.compose.yml');
const REGISTRY = '/tmp/cc-ports.registry';
const PORT = '5451';
const OWNER = 'SAB-Delegate';
const ENTRY = `${PORT} ${OWNER} test-db`;

/** @returns {string[]} */
function registryLines() {
  return existsSync(REGISTRY)
    ? readFileSync(REGISTRY, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
    : [];
}

/** @param {string[]} lines */
function writeRegistry(lines) {
  writeFileSync(REGISTRY, lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

/** @param {string[]} args */
function compose(args) {
  const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`[test-db] docker compose ${args[0]} failed (exit ${String(result.status)}).`);
    process.exit(result.status ?? 1);
  }
}

const command = process.argv[2];

if (command === 'start') {
  // Throws unless the configured test database is a loopback `*_test` database,
  // so this script can never be aimed at, or advertise, a remote server.
  testDatabaseBaseUrl();
  const holder = registryLines().find(
    (line) => line.split(' ')[0] === PORT && line.split(' ')[1] !== OWNER,
  );
  if (holder) {
    // Another project owns the port: stop that owner, never take a different port.
    console.error(`[test-db] port ${PORT} is registered to another project: ${holder}`);
    process.exit(1);
  }
  compose(['up', '-d', '--wait']);
  const others = registryLines().filter((line) => line !== ENTRY);
  writeRegistry([...others, ENTRY]);
  console.log(`[test-db] ready on 127.0.0.1:${PORT}`);
} else if (command === 'stop') {
  compose(['down']);
  writeRegistry(registryLines().filter((line) => line !== ENTRY));
  console.log('[test-db] stopped');
} else {
  console.error('usage: node scripts/test-db.mjs start | stop');
  process.exit(2);
}
