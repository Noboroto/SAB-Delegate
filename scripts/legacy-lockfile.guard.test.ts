// The legacy bot in root/ keeps its own package.json and lockfile until
// cutover, and production builds from that lockfile with --frozen-lockfile.
// A workspace-level `pnpm install` or an editor "fix" that rewrites either file
// would change what production installs, so both must stay byte-identical to
// what `main` (the deployed branch) has.
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

function mergeBaseWithMain(): string {
  for (const ref of ['main', 'origin/main']) {
    try {
      return git(['merge-base', 'HEAD', ref]).toString('utf8').trim();
    } catch {
      // Try the next candidate ref.
    }
  }
  throw new Error('cannot resolve a merge-base with main (neither main nor origin/main exists)');
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
