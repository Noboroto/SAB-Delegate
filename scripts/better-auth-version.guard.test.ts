// Better Auth's behaviour changes between releases (field validation, cookie
// layout, account schema), and the web client and the server must agree on the
// wire format. Both apps pin the same EXACT version, and the `@better-auth/core`
// override matches it, so a caret range or a half-done upgrade cannot ship.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const BETTER_AUTH_PACKAGE = /^(better-auth|@better-auth\/.+)$/;

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function betterAuthVersions(manifest: Manifest): Map<string, string> {
  const all = { ...manifest.devDependencies, ...manifest.dependencies };
  return new Map(Object.entries(all).filter(([name]) => BETTER_AUTH_PACKAGE.test(name)));
}

/** Problems across the manifests that depend on Better Auth; empty when they agree. */
function findProblems(
  manifests: readonly Manifest[],
  overrideVersion: string | undefined,
): string[] {
  const problems: string[] = [];
  const pinned = new Set<string>();
  for (const manifest of manifests) {
    for (const [name, version] of betterAuthVersions(manifest)) {
      if (!EXACT_VERSION.test(version)) {
        problems.push(`${manifest.name}: ${name} is "${version}", not an exact version`);
      }
      pinned.add(version);
    }
  }
  if (pinned.size > 1) {
    problems.push(`Better Auth versions differ across apps: ${[...pinned].sort().join(', ')}`);
  }
  if (pinned.size > 0 && overrideVersion === undefined) {
    problems.push('pnpm-workspace.yaml has no @better-auth/core override');
  }
  if (overrideVersion !== undefined && pinned.size > 0 && !pinned.has(overrideVersion)) {
    problems.push(
      `@better-auth/core override is ${overrideVersion}, apps pin ${[...pinned].join(', ')}`,
    );
  }
  return problems;
}

function readManifest(relativePath: string): Manifest | undefined {
  const path = join(REPO_ROOT, relativePath);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Manifest) : undefined;
}

function coreOverride(): string | undefined {
  const workspace = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
  return /^overrides:\s*\n(?:[ \t]+.*\n|\s*\n)*?[ \t]+['"]?@better-auth\/core['"]?:[ \t]*['"]?([^'"\s#]+)/m.exec(
    workspace,
  )?.[1];
}

describe('Better Auth is pinned to one exact version', () => {
  const server = readManifest('apps/server/package.json');
  const web = readManifest('apps/web/package.json');
  const manifests = [server, web].filter(
    (manifest): manifest is Manifest => manifest !== undefined,
  );

  it('reads the server and the web manifests, which both depend on Better Auth', () => {
    expect(server?.dependencies?.['better-auth']).toBeDefined();
    expect(web?.dependencies?.['better-auth']).toBeDefined();
  });

  it('holds in the repository: one exact version in both apps and in the override', () => {
    expect(manifests).toHaveLength(2);
    expect(findProblems(manifests, coreOverride())).toEqual([]);
  });

  it('gives the web client the version the server was measured with', () => {
    expect(web?.dependencies?.['better-auth']).toBe(server?.dependencies?.['better-auth']);
  });

  it('overrides @better-auth/core to the same version', () => {
    expect(coreOverride()).toBe(server?.dependencies?.['better-auth']);
  });

  describe('findProblems', () => {
    const app = (name: string, version: string): Manifest => ({
      name,
      dependencies: { 'better-auth': version },
    });

    it('accepts equal exact versions and a matching override', () => {
      expect(findProblems([app('server', '1.7.7'), app('web', '1.7.7')], '1.7.7')).toEqual([]);
    });

    it('accepts the server alone while the web app does not exist', () => {
      expect(findProblems([app('server', '1.7.7')], '1.7.7')).toEqual([]);
    });

    it('fails when the web app and the server differ', () => {
      expect(findProblems([app('server', '1.7.7'), app('web', '1.7.6')], '1.7.7')).toEqual([
        expect.stringContaining('differ'),
      ]);
    });

    it.each(['^1.7.7', '~1.7.7', '1.x', 'latest', '>=1.7.7'])('fails on the range %s', (range) => {
      expect(findProblems([app('server', range)], range)).toContainEqual(
        expect.stringContaining('not an exact version'),
      );
    });

    it('fails on a plugin package that drifts from the core', () => {
      const server: Manifest = {
        name: 'server',
        dependencies: { 'better-auth': '1.7.7', '@better-auth/stripe': '1.7.6' },
      };
      expect(findProblems([server], '1.7.7')).toContainEqual(expect.stringContaining('differ'));
    });

    it('fails when the override is missing or points elsewhere', () => {
      expect(findProblems([app('server', '1.7.7')], undefined)).toEqual([
        expect.stringContaining('no @better-auth/core override'),
      ]);
      expect(findProblems([app('server', '1.7.7')], '1.7.6')).toEqual([
        expect.stringContaining('override is 1.7.6'),
      ]);
    });
  });
});
