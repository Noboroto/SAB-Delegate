import { describe, expect, it } from 'vitest';
import {
  CreateReactionPollSchema,
  EditBotMessageSchema,
  MessageContentSchema,
  POLL_CHOICES_MAX,
  POLL_EMOJIS,
  ReactToMessageSchema,
  SendMessageSchema,
} from './messaging.js';

const CHANNEL = '123456789012345678';
const MESSAGE = '223456789012345678';

describe('MessageContentSchema', () => {
  it('keeps the text as written', () => {
    expect(MessageContentSchema.parse('  line one\n\nline two ')).toBe('  line one\n\nline two ');
  });

  it('refuses blank text, which Discord would reject as an empty message', () => {
    expect(MessageContentSchema.safeParse('').success).toBe(false);
    expect(MessageContentSchema.safeParse(' \n\t').success).toBe(false);
  });

  it('allows 2000 characters and refuses 2001', () => {
    expect(MessageContentSchema.safeParse('a'.repeat(2000)).success).toBe(true);
    expect(MessageContentSchema.safeParse('a'.repeat(2001)).success).toBe(false);
  });
});

describe('SendMessageSchema', () => {
  it('takes an optional reply target and strips unknown fields', () => {
    const parsed = SendMessageSchema.parse({
      channelId: CHANNEL,
      content: 'hi',
      replyTo: { channelId: CHANNEL, messageId: MESSAGE, extra: 1 },
      allowedMentions: { parse: ['everyone'] },
    });
    expect(parsed).toEqual({
      channelId: CHANNEL,
      content: 'hi',
      replyTo: { channelId: CHANNEL, messageId: MESSAGE },
    });
  });

  it('refuses a channel that is not a snowflake', () => {
    expect(SendMessageSchema.safeParse({ channelId: '<#123>', content: 'hi' }).success).toBe(false);
  });
});

describe('EditBotMessageSchema', () => {
  it('refuses blank new content', () => {
    expect(
      EditBotMessageSchema.safeParse({
        target: { channelId: CHANNEL, messageId: MESSAGE },
        content: '   ',
      }).success,
    ).toBe(false);
  });
});

describe('ReactToMessageSchema', () => {
  const target = { channelId: CHANNEL, messageId: MESSAGE };

  it('trims the emoji and defaults to no poll choices', () => {
    expect(ReactToMessageSchema.parse({ target, emoji: ' 🔥 ' })).toEqual({
      target,
      emoji: '🔥',
      pollChoices: 0,
    });
  });

  it('allows 0 to 10 poll choices only', () => {
    expect(ReactToMessageSchema.safeParse({ target, emoji: 'x', pollChoices: 10 }).success).toBe(
      true,
    );
    expect(ReactToMessageSchema.safeParse({ target, emoji: 'x', pollChoices: 11 }).success).toBe(
      false,
    );
    expect(ReactToMessageSchema.safeParse({ target, emoji: 'x', pollChoices: -1 }).success).toBe(
      false,
    );
  });

  it('refuses an empty emoji', () => {
    expect(ReactToMessageSchema.safeParse({ target, emoji: '  ' }).success).toBe(false);
  });
});

describe('CreateReactionPollSchema', () => {
  it('needs 1 to 10 choices and an optional existing message', () => {
    expect(CreateReactionPollSchema.safeParse({ channelId: CHANNEL, choices: 0 }).success).toBe(
      false,
    );
    expect(CreateReactionPollSchema.safeParse({ channelId: CHANNEL, choices: 11 }).success).toBe(
      false,
    );
    expect(
      CreateReactionPollSchema.parse({ channelId: CHANNEL, messageId: MESSAGE, choices: 3 }),
    ).toEqual({ channelId: CHANNEL, messageId: MESSAGE, choices: 3 });
  });
});

describe('poll emoji', () => {
  it('has one numbered emoji per allowed choice', () => {
    expect(POLL_EMOJIS).toHaveLength(POLL_CHOICES_MAX);
    expect(new Set(POLL_EMOJIS).size).toBe(POLL_CHOICES_MAX);
  });
});
