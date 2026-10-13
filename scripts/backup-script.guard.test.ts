import { randomBytes } from 'node:crypto';
// Runs the real backup.sh against fake `pg_dump` / `pg_restore` shims on PATH,
// so the guarantees that matter when a database is at stake are checked without
// a database: a `.dump` file exists only after verification, a failure leaves
// nothing behind, rotation never reaches another database or tag, and no
// credential is printed.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, '..', 'apps', 'server', 'scripts', 'backup.sh');
// Generated per run: a literal password in source trips the secret scanner.
const PASSWORD = `pw-${randomBytes(12).toString('hex')}`;

// The shims exit non-zero on a wrong PGPASSWORD, which proves the credential
// reaches pg_dump through the environment and not through its arguments.
const PG_DUMP_SHIM = `#!/bin/sh
if [ "\${PGPASSWORD:-}" != "${PASSWORD}" ]; then echo "shim: wrong PGPASSWORD" >&2; exit 9; fi
echo "$@" >> "$SHIM_LOG"
if [ -n "\${FAKE_DUMP_FAIL:-}" ]; then
  echo "pg_dump: error: connection to postgresql://u:$PGPASSWORD@h/db failed, password $PGPASSWORD" >&2
  exit 2
fi
for a in "$@"; do case "$a" in --file=*) out="\${a#--file=}" ;; esac; done
printf 'PGDMP fake archive' > "$out"
`;

const PG_RESTORE_SHIM = `#!/bin/sh
if [ -n "\${FAKE_RESTORE_FAIL:-}" ]; then echo "pg_restore: error: corrupt archive $PGPASSWORD" >&2; exit 1; fi
exit 0
`;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root: string;
let binDir: string;
let backupDir: string;

function run(args: string[], env: Record<string, string> = {}): Run {
  const result = spawnSync('sh', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      TMPDIR: root,
      SHIM_LOG: join(root, 'shim.log'),
      POSTGRES_DB: 'sab_delegate',
      POSTGRES_BACKUP_USER: 'backup',
      POSTGRES_BACKUP_PASSWORD: PASSWORD,
      BACKUP_DIR: backupDir,
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function touch(name: string): void {
  writeFileSync(join(backupDir, name), 'old');
}

function files(): string[] {
  return readdirSync(backupDir).sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'backup-guard-'));
  binDir = join(root, 'bin');
  backupDir = join(root, 'backups');
  mkdirSync(binDir);
  for (const [name, body] of [
    ['pg_dump', PG_DUMP_SHIM],
    ['pg_restore', PG_RESTORE_SHIM],
  ] as const) {
    writeFileSync(join(binDir, name), body);
    chmodSync(join(binDir, name), 0o755);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('backup.sh', () => {
  it('writes exactly one verified 0600 dump in a 0700 directory', () => {
    const result = run(['daily']);

    expect(result.status).toBe(0);
    const written = files();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^sab_delegate-daily-\d{8}T\d{6}Z\.dump$/);
    expect(statSync(join(backupDir, written[0] ?? '')).mode & 0o777).toBe(0o600);
    expect(statSync(backupDir).mode & 0o777).toBe(0o700);
  });

  it('accepts --tag and names the file after it', () => {
    const result = run(['--tag', 'baseline']);

    expect(result.status).toBe(0);
    expect(files()[0]).toMatch(/^sab_delegate-baseline-\d{8}T\d{6}Z\.dump$/);
  });

  it('passes the password through the environment only and never prints it', () => {
    const result = run(['daily']);

    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr + readFileSync(join(root, 'shim.log'), 'utf8');
    expect(output).not.toContain(PASSWORD);
  });

  it('exits non-zero, leaves no file and redacts credentials when pg_dump fails', () => {
    const result = run(['daily'], { FAKE_DUMP_FAIL: '1' });

    expect(result.status).not.toBe(0);
    expect(files()).toEqual([]);
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
    expect(result.stderr).not.toContain('postgresql://');
  });

  it('leaves no file, keeps the previous good dump and exits non-zero when verification fails', () => {
    mkdirSync(backupDir);
    touch('sab_delegate-daily-20200101T000000Z.dump');

    const result = run(['daily'], { FAKE_RESTORE_FAIL: '1' });

    expect(result.status).not.toBe(0);
    expect(files()).toEqual(['sab_delegate-daily-20200101T000000Z.dump']);
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
  });

  it('rotates only files with its own database and tag prefix', () => {
    mkdirSync(backupDir);
    const own = [
      'sab_delegate-daily-20200101T000000Z.dump',
      'sab_delegate-daily-20200102T000000Z.dump',
      'sab_delegate-daily-20200103T000000Z.dump',
      'sab_delegate-daily-20200104T000000Z.dump',
    ];
    const others = [
      'sab_delegate-pre-migrate-20190101T000000Z.dump',
      'sab_delegate-baseline-20190101T000000Z.dump',
      'sab_delegate-pre-20190101T000000Z.dump',
      'other_db-daily-20190101T000000Z.dump',
      'notes.txt',
      '.sab_delegate-daily-20190101T000000Z.partial',
    ];
    for (const name of [...own, ...others]) touch(name);
    mkdirSync(join(backupDir, '_archive'));

    const result = run(['daily'], { BACKUP_KEEP_DAILY: '2' });

    expect(result.status).toBe(0);
    const remaining = files();
    const daily = remaining.filter((name) => name.startsWith('sab_delegate-daily-'));
    expect(daily).toHaveLength(2);
    expect(daily).toContain('sab_delegate-daily-20200104T000000Z.dump');
    expect(daily).not.toContain('sab_delegate-daily-20200101T000000Z.dump');
    for (const name of [...others, '_archive']) expect(remaining).toContain(name);
  });

  it('keeps the default of five pre-migrate dumps and never rotates other tags', () => {
    mkdirSync(backupDir);
    for (let day = 1; day <= 6; day += 1) {
      touch(`sab_delegate-pre-migrate-2020010${day}T000000Z.dump`);
    }
    for (let day = 1; day <= 20; day += 1) {
      touch(`sab_delegate-baseline-202001${String(day).padStart(2, '0')}T000000Z.dump`);
    }

    const result = run(['pre-migrate']);

    expect(result.status).toBe(0);
    const remaining = files();
    expect(remaining.filter((name) => name.includes('-pre-migrate-'))).toHaveLength(5);
    expect(remaining.filter((name) => name.includes('-baseline-'))).toHaveLength(20);

    const baseline = run(['baseline']);
    expect(baseline.status).toBe(0);
    expect(files().filter((name) => name.includes('-baseline-'))).toHaveLength(21);
  });

  it('refuses a retention that would delete every backup', () => {
    mkdirSync(backupDir);
    touch('sab_delegate-daily-20200101T000000Z.dump');

    const result = run(['daily'], { BACKUP_KEEP_DAILY: '0' });

    expect(result.status).not.toBe(0);
    expect(files()).toEqual(['sab_delegate-daily-20200101T000000Z.dump']);
  });

  it('is a no-op that exits 0 when BACKUP_ENABLED is false, even without credentials', () => {
    const result = run(['daily'], {
      BACKUP_ENABLED: 'false',
      POSTGRES_BACKUP_PASSWORD: '',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('BACKUP_ENABLED');
    expect(existsSync(backupDir)).toBe(false);
  });

  it.each([
    ['no tag', []],
    ['an invalid tag', ['Bad_Tag']],
    ['two tags', ['daily', 'baseline']],
  ])('rejects %s', (_label, args) => {
    const result = run(args);

    expect(result.status).not.toBe(0);
    expect(existsSync(backupDir)).toBe(false);
  });

  it('fails closed when a required variable is missing or the database name is unsafe', () => {
    expect(run(['daily'], { POSTGRES_BACKUP_USER: '' }).status).not.toBe(0);
    expect(run(['daily'], { POSTGRES_DB: 'a*b' }).status).not.toBe(0);
    expect(existsSync(backupDir) ? files() : []).toEqual([]);
  });
});
