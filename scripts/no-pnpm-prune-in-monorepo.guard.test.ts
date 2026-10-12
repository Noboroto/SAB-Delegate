// `pnpm prune` does not support recursive execution on a monorepo (pnpm's own
// docs) - measured elsewhere: it silently dropped a dependency only one
// package declared from the shared virtual store, so the runner image failed at
// startup with `Cannot find module` even though the install had succeeded. The
// documented replacement is `pnpm deploy`, or a reinstall with `--prod` - never
// `pnpm prune` in a workspace with more than one package.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');

const PRUNE_PATTERN = /\bpnpm\s+prune\b/;
// Case-insensitive: the legacy image file at the repo root is `dockerfile`.
const DOCKERFILE_NAME = /^dockerfile(\..+)?$/i;
// Release and backup scripts run inside the image, so they can prune it too.
const SHELL_SCRIPT = /\.sh$/;

/**
 * Only scans non-comment lines: a `#`-prefixed explanation of why `pnpm prune`
 * is forbidden is not itself a violation.
 */
function findPnpmPrune(content: string): boolean {
  return content
    .split('\n')
    .some((line) => !line.trim().startsWith('#') && PRUNE_PATTERN.test(line));
}

// Tracked plus untracked-but-not-ignored, so a brand-new Dockerfile is checked
// before it is ever staged.
function listScannedFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => DOCKERFILE_NAME.test(basename(file)) || SHELL_SCRIPT.test(file));
}

describe('no `pnpm prune` in Dockerfiles or shell scripts (unsupported in this monorepo)', () => {
  it('contains no `pnpm prune` invocation in any Dockerfile or shell script', () => {
    const offenders = listScannedFiles().filter((file) => {
      try {
        return findPnpmPrune(readFileSync(join(REPO_ROOT, file), 'utf8'));
      } catch (error) {
        // Listed but deleted in the working tree and not yet staged.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
    expect(offenders).toEqual([]);
  });

  // A guard that scans a repo currently free of violations and asserts `[]`
  // can pass vacuously forever. These prove the detector flags the forbidden
  // form, on inline fixture strings rather than real files.
  it('flags `pnpm prune --prod` in a fixture string', () => {
    expect(findPnpmPrune('RUN pnpm prune --prod --ignore-scripts')).toBe(true);
  });

  it('does not flag ordinary pnpm invocations or comments', () => {
    expect(findPnpmPrune('RUN pnpm install --frozen-lockfile --prod')).toBe(false);
    expect(findPnpmPrune('RUN pnpm --filter ./apps/server deploy --prod /app/deploy')).toBe(false);
    expect(findPnpmPrune('# never run pnpm prune here')).toBe(false);
  });

  it('recognises Dockerfile names in any case', () => {
    expect(DOCKERFILE_NAME.test('dockerfile')).toBe(true);
    expect(DOCKERFILE_NAME.test('Dockerfile')).toBe(true);
    expect(DOCKERFILE_NAME.test('Dockerfile.dockerignore')).toBe(true);
    expect(DOCKERFILE_NAME.test('docker-compose.yml')).toBe(false);
  });

  it('scans shell scripts too', () => {
    expect(SHELL_SCRIPT.test('apps/server/scripts/release.sh')).toBe(true);
    expect(SHELL_SCRIPT.test('scripts/generate-deps.mjs')).toBe(false);
  });
});
