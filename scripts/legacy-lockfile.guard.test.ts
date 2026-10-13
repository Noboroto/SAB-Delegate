// The legacy bot in root/ keeps its own package.json and lockfile until
// cutover, and production builds from that lockfile with --frozen-lockfile.
// A workspace-level `pnpm install` or an editor "fix" that rewrites either file
// would change what production installs, so both must stay byte-identical to
// what `main` (the deployed branch) has.
//
// Only meaningful on a branch other than main: on main itself the merge-base is
// HEAD, so the files are compared with themselves and always match. Whichever
// of `main` and `origin/main` is newer is the baseline: a fresh clone has a
// stale or missing local `main`, while unpushed work on `main` is ahead of
// `origin/main`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');
const PINNED_FILES = ['root/pnpm-lock.yaml', 'root/package.json'];
// Skipped once cutover removes root/.
const LEGACY_PRESENT = existsSync(join(REPO_ROOT, 'root'));

function git(args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function refExists(ref: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(older: string, newer: string): boolean {
  try {
    git(['merge-base', '--is-ancestor', older, newer]);
    return true;
  } catch {
    return false;
  }
}

/** The newer of `main` and `origin/main`: either may lag behind the other. */
function mainRef(): string {
  const local = refExists('main');
  const remote = refExists('origin/main');
  if (local && remote) return isAncestor('origin/main', 'main') ? 'main' : 'origin/main';
  if (local) return 'main';
  if (remote) return 'origin/main';
  throw new Error('cannot resolve main (neither main nor origin/main exists)');
}

function mergeBaseWithMain(): string {
  return git(['merge-base', 'HEAD', mainRef()]).toString('utf8').trim();
}

function bytesAtBase(base: string, file: string): Buffer | undefined {
  try {
    return git(['show', `${base}:${file}`]);
  } catch {
    return undefined;
  }
}

describe.skipIf(!LEGACY_PRESENT)('legacy bot manifests stay byte-identical to main', () => {
  const base = LEGACY_PRESENT ? mergeBaseWithMain() : '';

  it.each(PINNED_FILES)('%s matches the merge-base with main', (file) => {
    const expected = bytesAtBase(base, file);
    if (expected === undefined) {
      // The file did not exist on main either, so there is nothing to protect.
      expect(existsSync(join(REPO_ROOT, file))).toBe(false);
      return;
    }
    const actual = readFileSync(join(REPO_ROOT, file));
    expect(actual.equals(expected)).toBe(true);
  });
});

// A guard that compares two identical blobs can pass vacuously forever. Prove
// the comparison actually distinguishes a one-byte difference.
describe('byte comparison', () => {
  it('detects a single changed byte', () => {
    expect(Buffer.from('a: 1\n').equals(Buffer.from('a: 2\n'))).toBe(false);
    expect(Buffer.from('a: 1\n').equals(Buffer.from('a: 1\n'))).toBe(true);
  });
});
