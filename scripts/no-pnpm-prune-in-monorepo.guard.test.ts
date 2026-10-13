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

// `pnpm` and `prune` anywhere on the same logical line, so `pnpm -r prune`,
// `pnpm --filter x prune` and `pnpm install && pnpm prune` all match. Stops at
// an inline `#` so a trailing comment cannot trigger it.
const PRUNE_PATTERN = /\bpnpm\b[^\n#]*\bprune\b/;
// Case-insensitive: the legacy image file at the repo root is `dockerfile`.
const DOCKERFILE_NAME = /^dockerfile(\..+)?$/i;
// Release and backup scripts run inside the image, so they can prune it too.
const SHELL_SCRIPT = /\.sh$/;
// Compose files carry `command:` / `entrypoint:` lines that run in the image.
const YAML_FILE = /\.ya?ml$/;
const PACKAGE_MANIFEST = 'package.json';

/**
 * Backslash-continued lines are one command (`RUN a && \` + `pnpm prune`).
 * Comments (whole-line or after whitespace) are dropped first: an explanation
 * of why `pnpm prune` is forbidden is not itself a violation.
 */
function findPnpmPrune(content: string): boolean {
  return content
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .some((line) => PRUNE_PATTERN.test(line));
}

/** A manifest only runs its `scripts`; prose in `description` must not match. */
function manifestScripts(raw: string): string {
  const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  return Object.values(parsed.scripts ?? {})
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
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
    .filter((file) => {
      const name = basename(file);
      return (
        DOCKERFILE_NAME.test(name) ||
        SHELL_SCRIPT.test(file) ||
        YAML_FILE.test(file) ||
        name === PACKAGE_MANIFEST
      );
    });
}

describe('no `pnpm prune` in Dockerfiles, shell scripts, YAML or manifest scripts (unsupported in this monorepo)', () => {
  it('contains no `pnpm prune` invocation in any scanned file', () => {
    const offenders = listScannedFiles().filter((file) => {
      try {
        const raw = readFileSync(join(REPO_ROOT, file), 'utf8');
        return findPnpmPrune(basename(file) === PACKAGE_MANIFEST ? manifestScripts(raw) : raw);
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

  it('flags prune spread over a continued line or a pnpm option', () => {
    expect(findPnpmPrune('RUN pnpm install --prod && \\\n    pnpm prune')).toBe(true);
    expect(findPnpmPrune('RUN pnpm \\\n  prune --prod')).toBe(true);
    expect(findPnpmPrune('RUN pnpm -r prune')).toBe(true);
    expect(findPnpmPrune('RUN pnpm --filter ./apps/server prune')).toBe(true);
  });

  it('flags prune in a YAML command and a manifest script', () => {
    expect(findPnpmPrune('    command: sh -c "pnpm prune --prod"')).toBe(true);
    expect(findPnpmPrune(manifestScripts('{"scripts":{"slim":"pnpm prune --prod"}}'))).toBe(true);
    expect(findPnpmPrune(manifestScripts('{"description":"pnpm prune is banned"}'))).toBe(false);
  });

  it('does not flag ordinary pnpm invocations or comments', () => {
    expect(findPnpmPrune('RUN pnpm install --frozen-lockfile --prod')).toBe(false);
    expect(findPnpmPrune('RUN pnpm --filter ./apps/server deploy --prod /app/deploy')).toBe(false);
    expect(findPnpmPrune('# never run pnpm prune here')).toBe(false);
    expect(findPnpmPrune('RUN pnpm install --prod # not pnpm prune')).toBe(false);
  });

  it('recognises Dockerfile names in any case', () => {
    expect(DOCKERFILE_NAME.test('dockerfile')).toBe(true);
    expect(DOCKERFILE_NAME.test('Dockerfile')).toBe(true);
    expect(DOCKERFILE_NAME.test('Dockerfile.dockerignore')).toBe(true);
    expect(DOCKERFILE_NAME.test('docker-compose.yml')).toBe(false);
  });

  it('scans shell scripts and YAML too', () => {
    expect(SHELL_SCRIPT.test('apps/server/scripts/release.sh')).toBe(true);
    expect(SHELL_SCRIPT.test('scripts/generate-deps.mjs')).toBe(false);
    expect(YAML_FILE.test('coolify.compose.yml')).toBe(true);
    expect(YAML_FILE.test('pnpm-workspace.yaml')).toBe(true);
    expect(YAML_FILE.test('package.json')).toBe(false);
  });
});
