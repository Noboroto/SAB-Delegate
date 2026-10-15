import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUILD_NAV, MODULE_PAGES, TOOL_PAGES } from '@/lib/guild-sections';

const SERVER_PAGES = join(import.meta.dirname, '..', '..', 'app', '(app)', 'servers', '[guildId]');

/** Every path the menu links to, children included; the overview (`''`) is the folder's own page. */
const NAV_PATHS = [
  ...GUILD_NAV.flatMap((entry) => (entry.path === undefined ? [] : [entry.path])),
  ...MODULE_PAGES.map((page) => page.path),
  ...TOOL_PAGES.map((page) => page.path),
];

const pageFile = (path: string): string => join(SERVER_PAGES, path, 'page.tsx');

/** `undefined` when git cannot answer (not installed, not a checkout), so the check is skipped. */
function isGitIgnored(file: string): boolean | undefined {
  try {
    execFileSync('git', ['check-ignore', '--quiet', file], { stdio: 'ignore' });
    return true;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return status === 1 ? false : undefined;
  }
}

describe('menu entries have a page that ships', () => {
  it('has a page.tsx for every path in the menu', () => {
    const missing = NAV_PATHS.filter((path) => !existsSync(pageFile(path)));
    expect(missing).toEqual([]);
  });

  // A page under an ignored folder works on a dev machine and 404s in the
  // image, because git never carried it (a `logs` ignore rule did exactly that).
  it('has no page.tsx that git ignores', () => {
    const ignored = NAV_PATHS.filter((path) => isGitIgnored(pageFile(path)) === true);
    expect(ignored).toEqual([]);
  });

  it('does not fail the ignore check on a file git has never heard of', () => {
    expect(isGitIgnored(join(SERVER_PAGES, 'definitely-not-a-route', 'page.tsx'))).not.toBe(true);
  });
});
