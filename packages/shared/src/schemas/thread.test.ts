import { describe, expect, it } from 'vitest';
import { MESSAGE_MAX_LENGTH } from '../constants/limits.js';
import {
  PRIVATE_THREAD_MAX_MEMBERS,
  PrivateThreadCreateSchema,
  PrivateThreadFromReactorsSchema,
  THREAD_BYLINE_MAX_LENGTH,
  THREAD_MESSAGE_MAX_LENGTH,
  THREAD_NAME_MAX_LENGTH,
  ThreadCreateSchema,
  ThreadDeleteSchema,
  ThreadRenameSchema,
} from './thread.js';

const CHANNEL = '123456789012345678';
const USER = '223456789012345678';

describe('ThreadCreateSchema', () => {
  it('trims the name, defaults to a public thread and strips unknown fields', () => {
    const parsed = ThreadCreateSchema.parse({
      channelId: CHANNEL,
      name: '  Planning  ',
      message: 'Hello',
      guildId: 'internal',
    });
    expect(parsed).toEqual({
      channelId: CHANNEL,
      name: 'Planning',
      message: 'Hello',
      isPrivate: false,
    });
  });

  it('keeps the layout of the message', () => {
    const parsed = ThreadCreateSchema.parse({
      channelId: CHANNEL,
      name: 'n',
      message: '  line\n\n    indented',
    });
    expect(parsed.message).toBe('  line\n\n    indented');
  });

  it('refuses a blank name or message and anything past the limits', () => {
    const base = { channelId: CHANNEL, name: 'n', message: 'm' };
    expect(ThreadCreateSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(ThreadCreateSchema.safeParse({ ...base, message: ' \n ' }).success).toBe(false);
    expect(
      ThreadCreateSchema.safeParse({ ...base, name: 'x'.repeat(THREAD_NAME_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(
      ThreadCreateSchema.safeParse({
        ...base,
        message: 'x'.repeat(THREAD_MESSAGE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      ThreadCreateSchema.safeParse({
        ...base,
        message: 'x'.repeat(THREAD_MESSAGE_MAX_LENGTH),
        name: 'x'.repeat(THREAD_NAME_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it('leaves room for the longest byline and the blank line, so the first post always fits', () => {
    const parsed = ThreadCreateSchema.parse({
      channelId: CHANNEL,
      name: 'n',
      message: 'x'.repeat(THREAD_MESSAGE_MAX_LENGTH),
      byline: 'b'.repeat(THREAD_BYLINE_MAX_LENGTH),
    });
    const content = `${parsed.byline}\n\n${parsed.message}`;
    expect(content.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
  });

  it('refuses a channel that is not a snowflake', () => {
    expect(
      ThreadCreateSchema.safeParse({ channelId: '<#123>', name: 'n', message: 'm' }).success,
    ).toBe(false);
  });
});

describe('ThreadRenameSchema and ThreadDeleteSchema', () => {
  it('keeps the prefixes exactly as typed and refuses an empty old prefix', () => {
    expect(
      ThreadRenameSchema.parse({ channelId: CHANNEL, oldPrefix: ' A- ', newPrefix: ' B- ' }),
    ).toEqual({ channelId: CHANNEL, oldPrefix: ' A- ', newPrefix: ' B- ' });
    expect(ThreadDeleteSchema.parse({ channelId: CHANNEL, prefix: 'A- ' }).prefix).toBe('A- ');
    expect(
      ThreadRenameSchema.safeParse({ channelId: CHANNEL, oldPrefix: '', newPrefix: 'B' }).success,
    ).toBe(false);
    expect(ThreadDeleteSchema.safeParse({ channelId: CHANNEL, prefix: '' }).success).toBe(false);
  });

  it('allows an empty new prefix, which removes the prefix', () => {
    expect(
      ThreadRenameSchema.parse({ channelId: CHANNEL, oldPrefix: 'A-', newPrefix: '' }).newPrefix,
    ).toBe('');
  });
});

describe('PrivateThreadCreateSchema', () => {
  const base = { channelId: CHANNEL, prefix: 'Team', message: 'Welcome' };

  it('needs members by id or by role', () => {
    expect(PrivateThreadCreateSchema.safeParse(base).success).toBe(false);
    expect(PrivateThreadCreateSchema.safeParse({ ...base, userIds: [] }).success).toBe(false);
    expect(PrivateThreadCreateSchema.safeParse({ ...base, userIds: [USER] }).success).toBe(true);
    expect(PrivateThreadCreateSchema.safeParse({ ...base, roleId: USER }).success).toBe(true);
  });

  it('bounds the prefix, the message and the number of members', () => {
    expect(
      PrivateThreadCreateSchema.safeParse({ ...base, prefix: 'x'.repeat(61), userIds: [USER] })
        .success,
    ).toBe(false);
    expect(
      PrivateThreadCreateSchema.safeParse({ ...base, message: 'x'.repeat(2001), userIds: [USER] })
        .success,
    ).toBe(false);
    expect(
      PrivateThreadCreateSchema.safeParse({
        ...base,
        userIds: Array.from({ length: PRIVATE_THREAD_MAX_MEMBERS + 1 }, () => USER),
      }).success,
    ).toBe(false);
  });
});

describe('PrivateThreadFromReactorsSchema', () => {
  it('needs a link and an emoji', () => {
    const base = { channelId: CHANNEL, prefix: 'Team', message: 'Hi' };
    expect(
      PrivateThreadFromReactorsSchema.safeParse({ ...base, messageLink: ' ', emoji: '👍' }).success,
    ).toBe(false);
    expect(
      PrivateThreadFromReactorsSchema.safeParse({ ...base, messageLink: 'x', emoji: ' ' }).success,
    ).toBe(false);
    expect(
      PrivateThreadFromReactorsSchema.parse({ ...base, messageLink: ' link ', emoji: ' 👍 ' }),
    ).toMatchObject({ messageLink: 'link', emoji: '👍' });
  });
});
