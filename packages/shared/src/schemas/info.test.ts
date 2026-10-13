import { describe, expect, it } from 'vitest';
import {
  INVITE_REASON_MAX_LENGTH,
  InviteCreateSchema,
  IntroductionResultSchema,
  ReactorIdsQuerySchema,
  RoleMembersQuerySchema,
} from './info.js';

const ID = '123456789012345678';

describe('IntroductionResultSchema', () => {
  it('tells the three outcomes apart by status', () => {
    expect(IntroductionResultSchema.parse({ status: 'NO_CHANNEL' })).toEqual({
      status: 'NO_CHANNEL',
    });
    expect(IntroductionResultSchema.parse({ status: 'NOT_FOUND', scanned: 120 })).toEqual({
      status: 'NOT_FOUND',
      scanned: 120,
    });
    const found = { status: 'FOUND', channelId: ID, messageId: ID, url: 'https://x', content: '' };
    expect(IntroductionResultSchema.parse(found)).toEqual(found);
    expect(IntroductionResultSchema.safeParse({ status: 'FOUND' }).success).toBe(false);
  });
});

describe('ReactorIdsQuerySchema', () => {
  it('trims the emoji and refuses an empty one', () => {
    expect(ReactorIdsQuerySchema.parse({ channelId: ID, messageId: ID, emoji: ' 👍 ' }).emoji).toBe(
      '👍',
    );
    expect(
      ReactorIdsQuerySchema.safeParse({ channelId: ID, messageId: ID, emoji: ' ' }).success,
    ).toBe(false);
  });
});

describe('RoleMembersQuerySchema', () => {
  it('makes the channel optional', () => {
    expect(RoleMembersQuerySchema.parse({ roleId: ID })).toEqual({ roleId: ID });
    expect(RoleMembersQuerySchema.parse({ roleId: ID, channelId: ID }).channelId).toBe(ID);
    expect(RoleMembersQuerySchema.safeParse({ roleId: 'role' }).success).toBe(false);
  });
});

describe('InviteCreateSchema', () => {
  it('keeps the reason within what the audit log header allows', () => {
    expect(InviteCreateSchema.parse({ channelId: ID, reason: 'because' }).reason).toBe('because');
    expect(
      InviteCreateSchema.safeParse({
        channelId: ID,
        reason: 'x'.repeat(INVITE_REASON_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(InviteCreateSchema.parse({ channelId: ID })).toEqual({ channelId: ID });
  });
});
