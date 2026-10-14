import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUILD_NAV, MODULE_PAGES, TOOL_PAGES, activeNavKey } from './guild-sections';

const G = '1'.repeat(18);

describe('GUILD_NAV', () => {
  it('lists the sections in menu order with the module and tool pages below their parent', () => {
    expect(GUILD_NAV.map((entry) => entry.key)).toEqual([
      'overview',
      'modules',
      'tools',
      'commands',
      'logs',
      'settings',
    ]);
    expect(GUILD_NAV.find((entry) => entry.key === 'modules')?.children).toBe(MODULE_PAGES);
    expect(GUILD_NAV.find((entry) => entry.key === 'tools')?.children).toBe(TOOL_PAGES);
    expect(MODULE_PAGES.map((page) => page.path)).toEqual([
      'modules/birthday',
      'modules/note',
      'modules/word-game',
      'modules/schedule',
      'modules/messaging',
    ]);
    expect(TOOL_PAGES).toHaveLength(7);
  });

  it('has no duplicate menu key', () => {
    const keys = GUILD_NAV.flatMap((entry) => [
      entry.key,
      ...(entry.children ?? []).map((c) => c.key),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('activeNavKey', () => {
  it.each([
    [`/servers/${G}`, 'overview'],
    [`/servers/${G}/`, 'overview'],
    [`/servers/${G}/logs`, 'logs'],
    [`/servers/${G}/modules`, 'modules'],
    [`/servers/${G}/modules/word-game`, 'wordGame'],
    [`/servers/${G}/modules/word-game/`, 'wordGame'],
    [`/servers/${G}/tools/role-assign`, 'roleAssign'],
    [`/servers/${G}/settings`, 'settings'],
  ])('%s selects %s', (pathname, key) => {
    expect(activeNavKey(pathname, G)).toBe(key);
  });

  it('selects nothing for an unknown path or another server', () => {
    expect(activeNavKey(`/servers/${G}/admin`, G)).toBeUndefined();
    expect(activeNavKey(`/servers/${G}/logsx`, G)).toBeUndefined();
    expect(activeNavKey(`/servers/${'2'.repeat(18)}/logs`, G)).toBeUndefined();
  });
});

describe('routes under a server', () => {
  it('has no catch-all segment, so an unknown path is a real 404', () => {
    const dir = join(import.meta.dirname, '..', 'app', '(app)', 'servers', '[guildId]');
    const dynamic = readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name.startsWith('['),
    );
    expect(dynamic).toEqual([]);
  });
});
