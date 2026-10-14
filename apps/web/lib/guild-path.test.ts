import { describe, expect, it } from 'vitest';
import { guildApiPath, snowflakeSegment } from './guild-path';

const GUILD = '1'.repeat(18);

describe('guildApiPath', () => {
  it('joins validated and encoded segments', () => {
    expect(guildApiPath(GUILD)).toBe(`/api/guilds/${GUILD}`);
    expect(guildApiPath(GUILD, 'notes')).toBe(`/api/guilds/${GUILD}/notes`);
    expect(guildApiPath(GUILD, 'threads/private', 'x y')).toBe(
      `/api/guilds/${GUILD}/threads/private/x%20y`,
    );
  });

  it.each(['..%2F..%2Fme%2Fx', '../me', '12', 'abc', '<@123456789012345678>', '1'.repeat(25), ''])(
    'renders not-found for the guild id %j',
    (bad) => {
      expect(() => guildApiPath(bad, 'logs')).toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    },
  );
});

describe('snowflakeSegment', () => {
  it('passes an id and rejects a path trick', () => {
    expect(snowflakeSegment(GUILD)).toBe(GUILD);
    expect(() => snowflakeSegment('1/../2')).toThrow();
  });
});
