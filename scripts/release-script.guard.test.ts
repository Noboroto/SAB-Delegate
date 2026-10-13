// Runs the real release.sh against shims for psql and backup.sh, so the rule
// that matters when data is at stake is checked without a database: a
// non-empty database is always dumped before migrating, whatever
// BACKUP_ENABLED says, and a failed dump stops the release.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RELEASE = join(import.meta.dirname, '..', 'apps', 'server', 'scripts', 'release.sh');

// Answers the state query with $FAKE_STATE; every other call fails, which ends
// the script right after the step under test.
const PSQL_SHIM = `#!/bin/sh
case "$*" in
  *to_regclass*) printf '%s\\n' "$FAKE_STATE" ;;
  *) exit 7 ;;
esac
`;

// Records what the dump step was given instead of dumping.
const BACKUP_SHIM = `#!/bin/sh
printf 'tag=%s enabled=%s\\n' "$1" "$BACKUP_ENABLED" >> "$SHIM_LOG"
exit "\${FAKE_BACKUP_EXIT:-0}"
`;

let root: string;
let scriptsDir: string;

function run(env: Record<string, string>): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('sh', [join(scriptsDir, 'release.sh')], {
    encoding: 'utf8',
    cwd: root,
    env: {
      PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      SHIM_LOG: join(root, 'shim.log'),
      POSTGRES_DB: 'sab_delegate',
      POSTGRES_USER: 'runtime',
      POSTGRES_MIGRATE_USER: 'migrate',
      POSTGRES_MIGRATE_PASSWORD: 'not-a-secret',
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const dumps = (): string[] =>
  existsSync(join(root, 'shim.log'))
    ? readFileSync(join(root, 'shim.log'), 'utf8').trim().split('\n')
    : [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'release-guard-'));
  scriptsDir = join(root, 'scripts');
  mkdirSync(scriptsDir);
  mkdirSync(join(root, 'bin'));
  // release.sh finds backup.sh next to itself.
  copyFileSync(RELEASE, join(scriptsDir, 'release.sh'));
  writeFileSync(join(scriptsDir, 'backup.sh'), BACKUP_SHIM);
  writeFileSync(join(root, 'bin', 'psql'), PSQL_SHIM);
  chmodSync(join(root, 'bin', 'psql'), 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('release.sh', () => {
  it.each(['false', '0', 'no', 'true', ''])(
    'dumps a non-empty database before migrating when BACKUP_ENABLED is %j',
    (enabled) => {
      run({ FAKE_STATE: 't|4', BACKUP_ENABLED: enabled });
      expect(dumps()).toEqual(['tag=pre-migrate enabled=true']);
    },
  );

  it('stops before migrating when the dump fails', () => {
    const result = run({ FAKE_STATE: 't|4', FAKE_BACKUP_EXIT: '1', BACKUP_ENABLED: 'false' });
    expect(result.status).not.toBe(0);
    expect(dumps()).toEqual(['tag=pre-migrate enabled=true']);
    expect(result.stdout).not.toContain('applying migrations');
  });

  it('skips the dump for an empty database', () => {
    run({ FAKE_STATE: 'f|0', BACKUP_ENABLED: 'true' });
    expect(dumps()).toEqual([]);
  });

  it('refuses tables without a migration history', () => {
    const result = run({ FAKE_STATE: 'f|3' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('baseline it by hand');
    expect(dumps()).toEqual([]);
  });
});
