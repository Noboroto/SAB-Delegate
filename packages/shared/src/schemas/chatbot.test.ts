import { describe, expect, it } from 'vitest';
import {
  CHATBOT_LIMIT_MAX,
  CHATBOT_MAX_CHANNELS,
  CHATBOT_TURN_ANSWER_MAX_CHARS,
  CHATBOT_TURN_QUESTION_MAX_CHARS,
} from '../constants/chatbot.js';
import {
  ChatbotChannelRequestSchema,
  ChatbotConfigPatchSchema,
  ChatbotConfigSchema,
  ChatbotLlmOverrideInputSchema,
  ChatbotMemoryClearRequestSchema,
  ChatbotQuotaGrantRequestSchema,
  ChatbotQuotaListQuerySchema,
  ChatbotQuotaRowSchema,
  ChatbotQuotaSetRequestSchema,
  ChatbotRecentTurnSchema,
  ChatbotTurnContextSchema,
  ChatbotTurnDeleteRequestSchema,
  ChatbotTurnDeleteResultSchema,
  ChatbotTurnDetailSchema,
  ChatbotTurnListQuerySchema,
  ChatbotTurnRecordSchema,
  ChatbotTurnRowSchema,
} from './chatbot.js';

const ID = '123456789012345678';

describe('ChatbotConfigSchema', () => {
  it('never carries a column of the stored LLM override key', () => {
    const keys = Object.keys(ChatbotConfigSchema.shape);
    expect(keys).not.toContain('llmApiKeyEnc');
    expect(keys).not.toContain('llmKeyLast4');
    expect(keys.sort()).toEqual(['channels', 'defaultMonthlyLimit', 'enabled', 'llm']);
    expect(Object.keys(ChatbotConfigSchema.shape.llm.shape)).not.toContain('apiKey');
  });

  it('strips fields it does not know, such as a leaked ciphertext', () => {
    const parsed = ChatbotConfigSchema.parse({
      enabled: true,
      defaultMonthlyLimit: 100_000,
      channels: [ID],
      llm: { source: 'none', baseUrl: null, model: null, keyLast4: null, globalAvailable: false },
      llmApiKeyEnc: 'secret',
    });
    expect(parsed).not.toHaveProperty('llmApiKeyEnc');
  });

  it('carries the pause deadline only as an ISO time and may omit it', () => {
    const base = {
      enabled: true,
      defaultMonthlyLimit: 0,
      channels: [],
      llm: { source: 'global', baseUrl: null, model: null, keyLast4: null, globalAvailable: true },
    };
    const withPause = (pausedUntil: string) => ({ ...base, llm: { ...base.llm, pausedUntil } });
    expect(ChatbotConfigSchema.safeParse(base).success).toBe(true);
    expect(ChatbotConfigSchema.safeParse(withPause('2026-10-16T08:30:00.000Z')).success).toBe(true);
    expect(ChatbotConfigSchema.safeParse(withPause('half past eight')).success).toBe(false);
  });

  it('caps the channel list at the allowed number', () => {
    const base = {
      enabled: true,
      defaultMonthlyLimit: 0,
      llm: { source: 'global', baseUrl: null, model: null, keyLast4: null, globalAvailable: true },
    };
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `1234567890123456${10 + i}`);
    expect(
      ChatbotConfigSchema.safeParse({ ...base, channels: ids(CHATBOT_MAX_CHANNELS) }).success,
    ).toBe(true);
    expect(
      ChatbotConfigSchema.safeParse({ ...base, channels: ids(CHATBOT_MAX_CHANNELS + 1) }).success,
    ).toBe(false);
  });
});

describe('ChatbotConfigPatchSchema', () => {
  it('leaves an absent field absent instead of resetting it to the default', () => {
    expect(ChatbotConfigPatchSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(ChatbotConfigPatchSchema.parse({})).toEqual({});
  });

  it('bounds the default limit', () => {
    expect(ChatbotConfigPatchSchema.safeParse({ defaultMonthlyLimit: 0 }).success).toBe(true);
    expect(ChatbotConfigPatchSchema.safeParse({ defaultMonthlyLimit: -1 }).success).toBe(false);
    expect(
      ChatbotConfigPatchSchema.safeParse({ defaultMonthlyLimit: CHATBOT_LIMIT_MAX + 1 }).success,
    ).toBe(false);
    expect(ChatbotConfigPatchSchema.safeParse({ defaultMonthlyLimit: 1.5 }).success).toBe(false);
  });
});

describe('quota requests', () => {
  it('accepts a limit or null (clears the member limit) and rejects out-of-range values', () => {
    expect(ChatbotQuotaSetRequestSchema.parse({ limit: null })).toEqual({ limit: null });
    expect(ChatbotQuotaSetRequestSchema.parse({ limit: 5 })).toEqual({ limit: 5 });
    expect(ChatbotQuotaSetRequestSchema.safeParse({}).success).toBe(false);
    expect(ChatbotQuotaSetRequestSchema.safeParse({ limit: -1 }).success).toBe(false);
    expect(ChatbotQuotaSetRequestSchema.safeParse({ limit: CHATBOT_LIMIT_MAX + 1 }).success).toBe(
      false,
    );
  });

  it('takes a signed, non-zero grant within the ceiling', () => {
    expect(ChatbotQuotaGrantRequestSchema.safeParse({ tokens: 500 }).success).toBe(true);
    expect(ChatbotQuotaGrantRequestSchema.safeParse({ tokens: -500 }).success).toBe(true);
    expect(ChatbotQuotaGrantRequestSchema.safeParse({ tokens: 0 }).success).toBe(false);
    expect(
      ChatbotQuotaGrantRequestSchema.safeParse({ tokens: CHATBOT_LIMIT_MAX + 1 }).success,
    ).toBe(false);
    expect(
      ChatbotQuotaGrantRequestSchema.safeParse({ tokens: -CHATBOT_LIMIT_MAX - 1 }).success,
    ).toBe(false);
    expect(ChatbotQuotaGrantRequestSchema.safeParse({ tokens: 1.5 }).success).toBe(false);
  });

  it('parses the list query with the sort allow-list', () => {
    expect(ChatbotQuotaListQuerySchema.parse({ sort: 'used' }).sort).toBe('used');
    expect(ChatbotQuotaListQuerySchema.safeParse({ sort: 'summary' }).success).toBe(false);
  });

  it('describes a row without a negative remainder', () => {
    const row = {
      userId: ID,
      displayName: null,
      used: 1,
      limit: 2,
      bonus: 0,
      overridden: false,
      remaining: 1,
    };
    expect(ChatbotQuotaRowSchema.safeParse(row).success).toBe(true);
    expect(ChatbotQuotaRowSchema.safeParse({ ...row, remaining: -1 }).success).toBe(false);
  });
});

describe('ChatbotMemoryClearRequestSchema', () => {
  it('needs the id of what the scope names', () => {
    expect(ChatbotMemoryClearRequestSchema.safeParse({ scope: 'user' }).success).toBe(false);
    expect(ChatbotMemoryClearRequestSchema.safeParse({ scope: 'channel' }).success).toBe(false);
    expect(ChatbotMemoryClearRequestSchema.safeParse({ scope: 'user', userId: ID }).success).toBe(
      true,
    );
    expect(
      ChatbotMemoryClearRequestSchema.safeParse({ scope: 'channel', channelId: ID }).success,
    ).toBe(true);
    expect(ChatbotMemoryClearRequestSchema.safeParse({ scope: 'all' }).success).toBe(true);
  });

  it('refuses an id the scope does not name, so nothing narrower or wider is cleared', () => {
    const parse = (body: object) => ChatbotMemoryClearRequestSchema.safeParse(body).success;
    expect(parse({ scope: 'all', userId: ID })).toBe(false);
    expect(parse({ scope: 'all', channelId: ID })).toBe(false);
    expect(parse({ scope: 'user', userId: ID, channelId: ID })).toBe(false);
    expect(parse({ scope: 'channel', channelId: ID, userId: ID })).toBe(false);
  });

  it('defaults to a real run and rejects a malformed id', () => {
    expect(ChatbotMemoryClearRequestSchema.parse({ scope: 'all' }).dryRun).toBe(false);
    expect(
      ChatbotMemoryClearRequestSchema.safeParse({ scope: 'user', userId: 'abc' }).success,
    ).toBe(false);
  });
});

describe('input shapes', () => {
  it('requires a snowflake channel', () => {
    expect(ChatbotChannelRequestSchema.safeParse({ channelId: ID }).success).toBe(true);
    expect(ChatbotChannelRequestSchema.safeParse({ channelId: '<#1>' }).success).toBe(false);
  });

  it('takes the override as base URL, model and key, and nothing else', () => {
    expect(Object.keys(ChatbotLlmOverrideInputSchema.shape).sort()).toEqual([
      'apiKey',
      'baseUrl',
      'model',
    ]);
    expect(
      ChatbotLlmOverrideInputSchema.safeParse({ baseUrl: 'http://example.com/v1', model: 'm' })
        .success,
    ).toBe(false);
  });
});

describe('ChatbotTurnContextSchema', () => {
  it('fills in what a snapshot from an older build lacks', () => {
    expect(ChatbotTurnContextSchema.parse({ system: 's' })).toEqual({
      system: 's',
      channelMessages: [],
      memory: {},
      recentTurns: 0,
      attachments: [],
    });
  });

  it('refuses a snapshot without the system prompt or with a bad author id', () => {
    expect(ChatbotTurnContextSchema.safeParse({}).success).toBe(false);
    expect(
      ChatbotTurnContextSchema.safeParse({
        system: 's',
        channelMessages: [
          { authorName: 'a', authorId: 'x', content: 'c', at: '2026-10-16T00:00:00.000Z' },
        ],
      }).success,
    ).toBe(false);
  });

  it('strips fields it does not know, such as attachment bytes', () => {
    const parsed = ChatbotTurnContextSchema.parse({
      system: 's',
      attachments: [{ name: 'a', kind: 'image', bytes: 3, included: true, data: 'AAAA' }],
    });
    expect(parsed.attachments[0]).not.toHaveProperty('data');
  });
});

describe('chatbot turn schemas', () => {
  const record = {
    guildId: ID,
    channelId: ID,
    userId: ID,
    triggerMessageId: ID,
    replyMessageId: null,
    status: 'OK',
    failureReason: null,
    question: 'q',
    answer: 'a',
    model: null,
    llmSource: null,
    inputTokens: 0,
    outputTokens: 0,
    estimated: false,
    context: { system: 's' },
  };

  it('requires an answer when the turn is OK, and only then', () => {
    expect(ChatbotTurnRecordSchema.safeParse({ ...record, answer: null }).success).toBe(false);
    expect(
      ChatbotTurnRecordSchema.safeParse({ ...record, status: 'FAILED', answer: null }).success,
    ).toBe(true);
  });

  it('takes only an outcome as the end of a turn, never the intake or recovery states', () => {
    for (const status of ['PENDING', 'EXPIRED']) {
      expect(ChatbotTurnRecordSchema.safeParse({ ...record, status, answer: null }).success).toBe(
        false,
      );
    }
  });

  it('caps the question and the answer', () => {
    expect(
      ChatbotTurnRecordSchema.safeParse({
        ...record,
        question: 'x'.repeat(CHATBOT_TURN_QUESTION_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
    expect(
      ChatbotTurnRecordSchema.safeParse({
        ...record,
        answer: 'x'.repeat(CHATBOT_TURN_ANSWER_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it('keeps the context and the server out of a list row and puts the context in the detail', () => {
    expect(Object.keys(ChatbotTurnRowSchema.shape)).not.toContain('context');
    expect(Object.keys(ChatbotTurnRowSchema.shape)).not.toContain('guildId');
    expect(Object.keys(ChatbotTurnDetailSchema.shape)).toContain('context');
    expect(ChatbotTurnDetailSchema.shape.context.safeParse(null).success).toBe(true);
  });

  it('lists newest first and refuses a reversed time range or an unknown status', () => {
    expect(ChatbotTurnListQuerySchema.parse({}).order).toBe('desc');
    expect(
      ChatbotTurnListQuerySchema.safeParse({
        from: '2026-10-02T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(ChatbotTurnListQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(
      ChatbotTurnListQuerySchema.safeParse({ status: 'QUOTA_EXHAUSTED', userId: ID }).success,
    ).toBe(true);
  });

  describe('ChatbotTurnDeleteRequestSchema', () => {
    const TURN = '019a0000-0000-7000-8000-000000000001';

    it('wants exactly the id the scope names', () => {
      const parse = (body: object) => ChatbotTurnDeleteRequestSchema.safeParse(body).success;
      expect(parse({ scope: 'turn', turnId: TURN })).toBe(true);
      expect(parse({ scope: 'user', userId: ID })).toBe(true);
      expect(parse({ scope: 'all' })).toBe(true);
      expect(parse({ scope: 'turn' })).toBe(false);
      expect(parse({ scope: 'user' })).toBe(false);
      expect(parse({ scope: 'all', userId: ID })).toBe(false);
      // An owner check on one turn is how a member deletes only their own.
      expect(parse({ scope: 'turn', turnId: TURN, userId: ID })).toBe(true);
      expect(parse({ scope: 'all', turnId: TURN })).toBe(false);
      expect(parse({ scope: 'user', userId: ID, turnId: TURN })).toBe(false);
      expect(parse({ scope: 'all', userId: ID, turnId: TURN })).toBe(false);
      expect(parse({ scope: 'turn', turnId: 'nope' })).toBe(false);
    });

    it('defaults to a real delete', () => {
      expect(ChatbotTurnDeleteRequestSchema.parse({ scope: 'all' }).dryRun).toBe(false);
    });
  });

  it('takes only the reason codes of a failed model call as a failure reason', () => {
    const parse = (failureReason: string | null) =>
      ChatbotTurnRecordSchema.safeParse({ ...record, status: 'FAILED', failureReason }).success;
    expect(parse('unreachable')).toBe(true);
    expect(parse(null)).toBe(true);
    expect(parse('401 Unauthorized: key sk-123')).toBe(false);
  });

  it('bounds every text of the context snapshot', () => {
    const parse = (context: object) =>
      ChatbotTurnContextSchema.safeParse({ system: 's', ...context }).success;
    expect(parse({ system: 'x'.repeat(30_001) })).toBe(false);
    const message = { authorName: 'a', authorId: ID, content: 'c', at: '2026-10-16T00:00:00.000Z' };
    expect(parse({ channelMessages: [{ ...message, content: 'x'.repeat(4001) }] })).toBe(false);
    expect(parse({ channelMessages: [{ ...message, authorName: 'x'.repeat(256) }] })).toBe(false);
    expect(parse({ memory: { user: 'x'.repeat(2001) } })).toBe(false);
    const file = { name: 'n', kind: 'image', bytes: 1, included: true };
    expect(parse({ attachments: [{ ...file, note: 'x'.repeat(501) }] })).toBe(false);
    expect(parse({ attachments: [{ ...file, kind: 'x'.repeat(51) }] })).toBe(false);
    expect(parse({ attachments: [{ ...file, note: 'x'.repeat(500) }] })).toBe(true);
  });

  it('describes a recent turn with ISO dates and the ids needed to de-duplicate it', () => {
    const parsed = ChatbotRecentTurnSchema.parse({
      triggerMessageId: ID,
      replyMessageId: null,
      question: 'q',
      answer: 'a',
      createdAt: '2026-10-16T00:00:00.000Z',
      extra: 1,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'answer',
      'createdAt',
      'question',
      'replyMessageId',
      'triggerMessageId',
    ]);
  });

  it('describes a delete result by its count', () => {
    expect(ChatbotTurnDeleteResultSchema.safeParse({ dryRun: true, count: 3 }).success).toBe(true);
    expect(ChatbotTurnDeleteResultSchema.safeParse({ dryRun: true, count: -1 }).success).toBe(
      false,
    );
  });
});
