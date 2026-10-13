import { describe, expect, it } from 'vitest';
import { mentionsForActor, userMentionsIn } from './allowed-mentions.js';

const idOf = (n: number): string => String(100000000000000000n + BigInt(n));

describe('mentionsForActor', () => {
  it('lets a slash command ping the kinds asked for', () => {
    expect(mentionsForActor({ source: 'DISCORD' }, ['users', 'roles'])).toEqual({
      parse: ['users', 'roles'],
    });
    expect(mentionsForActor({ source: 'DISCORD' }, ['users', 'roles', 'everyone'])).toEqual({
      parse: ['users', 'roles', 'everyone'],
    });
  });

  it.each(['HTTP', 'MCP', 'SYSTEM'] as const)('pings nobody for a %s caller', (source) => {
    expect(mentionsForActor({ source }, ['users', 'roles', 'everyone'])).toEqual({ parse: [] });
  });
});

describe('userMentionsIn', () => {
  it('names only the allowed users that appear in the text', () => {
    const text = `<@${idOf(1)}> <@!${idOf(2)}> <@${idOf(3)}> <@&${idOf(4)}> @everyone`;
    expect(userMentionsIn(text, new Set([idOf(1), idOf(3), idOf(4)]))).toEqual({
      users: [idOf(1), idOf(3)],
    });
  });

  it('names a user once however often the text mentions them', () => {
    expect(userMentionsIn(`<@${idOf(1)}> <@${idOf(1)}>`, new Set([idOf(1)])).users).toEqual([
      idOf(1),
    ]);
  });

  it('stays within the 100 users Discord accepts', () => {
    const ids = Array.from({ length: 150 }, (_, n) => idOf(n));
    const text = ids.map((id) => `<@${id}>`).join(' ');
    expect(userMentionsIn(text, new Set(ids)).users).toHaveLength(100);
  });
});
