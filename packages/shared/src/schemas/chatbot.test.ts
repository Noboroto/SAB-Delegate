import { describe, expect, it } from 'vitest';
import { CHATBOT_LIMIT_MAX, CHATBOT_MAX_CHANNELS } from '../constants/chatbot.js';
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
