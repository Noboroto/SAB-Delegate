import { describe, expect, it } from 'vitest';
import { WORD_MAX_WORDS_MAX, WORD_MAX_WORDS_MIN } from './guild-config.js';
import {
  WordGameConfigSchema,
  WordGameInfoSchema,
  WordGameWordsQuerySchema,
  WordStatus,
  WordStatusSchema,
  WordSubmitInputSchema,
  WordSubmitResultSchema,
} from './word-game.js';

const CHANNEL = '123456789012345678';

describe('WordStatus', () => {
  it('names every outcome of a message, and the enum object mirrors the schema', () => {
    expect(WordStatusSchema.options).toEqual([
      'SUCCESS',
      'SAME_AUTHOR',
      'SAME_WORD',
      'NOT_EXIST',
      'NOT_LINK',
      'MAX_WORD',
      'NOTHING',
    ]);
    expect(WordStatus.NOT_LINK).toBe('NOT_LINK');
  });
});

describe('WordGameConfigSchema', () => {
  it('accepts a channel, a limit, or both', () => {
    expect(WordGameConfigSchema.parse({ channelId: CHANNEL })).toEqual({ channelId: CHANNEL });
    expect(WordGameConfigSchema.parse({ maxWords: 400 })).toEqual({ maxWords: 400 });
    expect(WordGameConfigSchema.parse({ channelId: CHANNEL, maxWords: 400 })).toEqual({
      channelId: CHANNEL,
      maxWords: 400,
    });
  });

  it('rejects a request that changes nothing', () => {
    expect(WordGameConfigSchema.safeParse({}).success).toBe(false);
    expect(WordGameConfigSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('bounds the limit from the 200 floor to the Int column', () => {
    const accepts = (maxWords: unknown) => WordGameConfigSchema.safeParse({ maxWords }).success;
    expect(accepts(WORD_MAX_WORDS_MIN - 1)).toBe(false);
    expect(accepts(WORD_MAX_WORDS_MIN)).toBe(true);
    expect(accepts(WORD_MAX_WORDS_MAX)).toBe(true);
    expect(accepts(WORD_MAX_WORDS_MAX + 1)).toBe(false);
    expect(accepts(1500.5)).toBe(false);
    expect(accepts('1500')).toBe(false);
  });

  it('rejects a channel that is not a snowflake, such as a mention', () => {
    for (const channelId of ['<#123456789012345678>', '123', '', 42]) {
      expect(WordGameConfigSchema.safeParse({ channelId }).success, String(channelId)).toBe(false);
    }
  });

  it('drops fields it does not know', () => {
    expect(WordGameConfigSchema.parse({ channelId: CHANNEL, guildId: 'x', id: 'y' })).toEqual({
      channelId: CHANNEL,
    });
  });
});

describe('WordSubmitInputSchema', () => {
  it('needs real ids and keeps the text as it came', () => {
    const parsed = WordSubmitInputSchema.parse({
      channelId: CHANNEL,
      authorId: CHANNEL,
      content: '  Hello ',
    });
    expect(parsed.content).toBe('  Hello ');
    expect(WordSubmitInputSchema.safeParse({ ...parsed, authorId: 'me' }).success).toBe(false);
  });
});

describe('WordSubmitResultSchema and WordGameInfoSchema', () => {
  it('describe a move and a round without leaking database columns', () => {
    expect(
      WordSubmitResultSchema.parse({
        status: 'NOT_LINK',
        count: 3,
        maxWords: 1500,
        starter: 'k',
        finished: false,
      }),
    ).toEqual({ status: 'NOT_LINK', count: 3, maxWords: 1500, starter: 'k', finished: false });

    const info = WordGameInfoSchema.parse({
      id: 'internal',
      guildId: 'internal',
      updatedAt: new Date(),
      started: false,
      lastWord: 'apple',
      lastUserId: CHANNEL,
      channelId: CHANNEL,
      maxWords: 1500,
      count: 1,
      finished: false,
    });
    expect(Object.keys(info).sort()).toEqual(
      ['channelId', 'count', 'finished', 'lastUserId', 'lastWord', 'maxWords', 'started'].sort(),
    );
  });
});

describe('WordGameWordsQuerySchema', () => {
  it('reads the paging from the query string and defaults to play order', () => {
    expect(WordGameWordsQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
      sort: 'played',
      order: 'asc',
    });
  });

  it('only sorts by the listed keys', () => {
    expect(WordGameWordsQuerySchema.safeParse({ sort: 'id' }).success).toBe(false);
    expect(WordGameWordsQuerySchema.safeParse({ sort: 'word', order: 'desc' }).success).toBe(true);
  });
});
