import { describe, expect, it } from 'vitest';
import type { CommandCatalogEntry } from '@sab/shared';
import { groupCommands } from './group-commands';

const entry = (name: string, permissions: string | null): CommandCatalogEntry => ({
  name,
  description: name,
  defaultMemberPermissions: permissions,
  guildOnly: true,
  subcommands: [],
});

describe('groupCommands', () => {
  it('separates open commands from permission-gated ones and keeps the order', () => {
    const groups = groupCommands([entry('b', null), entry('a', '8192'), entry('c', null)]);
    expect(groups.everyone.map((e) => e.name)).toEqual(['b', 'c']);
    expect(groups.restricted.map((e) => e.name)).toEqual(['a']);
  });

  it('gives two empty groups for no commands', () => {
    expect(groupCommands([])).toEqual({ everyone: [], restricted: [] });
  });
});
