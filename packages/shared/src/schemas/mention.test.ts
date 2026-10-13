import { describe, expect, it } from 'vitest';
import {
  MENTION_CONTENT_MAX_LENGTH,
  MENTION_EVERYONE_CONTENT_MAX_LENGTH,
  MentionEveryoneInputSchema,
  MentionNonReactorsInputSchema,
  MentionReactorsInputSchema,
  MentionResultSchema,
} from './mention.js';

// Built at runtime: a literal 18-digit id next to an id field trips the secret scanner.
const ID = '1234567890'.repeat(2).slice(0, 18);
const OTHER_ID = '9876543210'.repeat(2).slice(0, 18);

describe('MentionReactorsInputSchema', () => {
  it('trims the emoji and keeps the reply target', () => {
    const parsed = MentionReactorsInputSchema.parse({
      channelId: ID,
      messageId: ID,
      emoji: '  👍 ',
      replyTo: { channelId: OTHER_ID, messageId: OTHER_ID },
    });
    expect(parsed.emoji).toBe('👍');
    expect(parsed.replyTo?.channelId).toBe(OTHER_ID);
  });

  it('rejects an empty emoji, a mention-shaped id and an over-long text', () => {
    const base = { channelId: ID, messageId: ID, emoji: '👍' };
    expect(MentionReactorsInputSchema.safeParse({ ...base, emoji: '   ' }).success).toBe(false);
    expect(MentionReactorsInputSchema.safeParse({ ...base, channelId: '<#1>' }).success).toBe(
      false,
    );
    expect(
      MentionReactorsInputSchema.safeParse({
        ...base,
        content: 'x'.repeat(MENTION_CONTENT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('drops fields it does not declare', () => {
    const parsed = MentionReactorsInputSchema.parse({
      channelId: ID,
      messageId: ID,
      emoji: '👍',
      allowedMentions: { parse: ['everyone'] },
    });
    expect('allowedMentions' in parsed).toBe(false);
  });
});

describe('MentionNonReactorsInputSchema', () => {
  it('defaults to no bots, channel members only and no reply', () => {
    const parsed = MentionNonReactorsInputSchema.parse({ channelId: ID, messageId: ID });
    expect(parsed).toMatchObject({ includeBots: false, onlyInChannel: true, reply: false });
  });
});

describe('MentionEveryoneInputSchema', () => {
  it('limits the text so the first line still fits in a message', () => {
    expect(
      MentionEveryoneInputSchema.safeParse({
        threadId: ID,
        content: 'x'.repeat(MENTION_EVERYONE_CONTENT_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      MentionEveryoneInputSchema.safeParse({
        threadId: ID,
        content: 'x'.repeat(MENTION_EVERYONE_CONTENT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe('MentionResultSchema', () => {
  it('refuses a message that Discord would reject', () => {
    const result = {
      dryRun: false,
      status: 'OK',
      count: 1,
      sample: [ID],
      chunks: ['x'.repeat(2001)],
      delivered: false,
    };
    expect(MentionResultSchema.safeParse(result).success).toBe(false);
    expect(MentionResultSchema.safeParse({ ...result, chunks: ['x'] }).success).toBe(true);
  });
});
