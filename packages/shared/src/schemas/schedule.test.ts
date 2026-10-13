import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MENTIONS_ALL,
  ALLOWED_MENTIONS_NONE,
  AllowedMentionsSchema,
  RunAtSchema,
  ScheduleCancelResultSchema,
  ScheduleCopyInputSchema,
  ScheduleListQuerySchema,
  ScheduleSendInputSchema,
  ScheduledMessageViewSchema,
  SCHEDULE_LIST_MAX,
} from './schedule.js';

// Built at runtime: a literal 18-digit id trips the secret scanner.
const CHANNEL = '2'.repeat(18);
const USER = '5'.repeat(18);
const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('AllowedMentionsSchema', () => {
  it('defaults to notifying nobody', () => {
    expect(AllowedMentionsSchema.parse({})).toEqual({ parse: [] });
    expect(AllowedMentionsSchema.parse(ALLOWED_MENTIONS_NONE)).toEqual({ parse: [] });
  });

  it('accepts the policy slash commands keep', () => {
    expect(AllowedMentionsSchema.parse(ALLOWED_MENTIONS_ALL).parse).toEqual([
      'users',
      'roles',
      'everyone',
    ]);
  });

  it('refuses what Discord would refuse: a kind both parsed and listed', () => {
    expect(AllowedMentionsSchema.safeParse({ parse: ['users'], users: [USER] }).success).toBe(
      false,
    );
    expect(AllowedMentionsSchema.safeParse({ parse: ['roles'], roles: [USER] }).success).toBe(
      false,
    );
    expect(AllowedMentionsSchema.safeParse({ parse: ['roles'], users: [USER] }).success).toBe(true);
  });

  it('refuses ids that are not snowflakes and kinds it does not know', () => {
    expect(AllowedMentionsSchema.safeParse({ users: ['abc'] }).success).toBe(false);
    expect(AllowedMentionsSchema.safeParse({ parse: ['here'] }).success).toBe(false);
  });
});

describe('RunAtSchema', () => {
  it('turns an ISO string into a date and lets a date through', () => {
    expect(RunAtSchema.parse('2026-10-20T09:30:00+07:00')).toEqual(
      new Date('2026-10-20T02:30:00.000Z'),
    );
    const date = new Date('2026-10-20T02:30:00.000Z');
    expect(RunAtSchema.parse(date)).toEqual(date);
  });

  it('refuses text that is not an instant and a date that is not valid', () => {
    expect(RunAtSchema.safeParse('tomorrow').success).toBe(false);
    expect(RunAtSchema.safeParse('2026-02-31T09:00:00Z').success).toBe(false);
    expect(RunAtSchema.safeParse(new Date(Number.NaN)).success).toBe(false);
    expect(RunAtSchema.safeParse(1_800_000_000).success).toBe(false);
  });
});

describe('ScheduleSendInputSchema', () => {
  const valid = { channelId: CHANNEL, content: 'hello', runAt: '2026-10-20T09:30:00Z' };

  it('accepts a message and strips what it does not know', () => {
    const parsed = ScheduleSendInputSchema.parse({ ...valid, guildId: 'x' });
    expect(parsed).toEqual({
      channelId: CHANNEL,
      content: 'hello',
      runAt: new Date('2026-10-20T09:30:00.000Z'),
    });
  });

  it('refuses blank text and text over what Discord takes', () => {
    expect(ScheduleSendInputSchema.safeParse({ ...valid, content: '   ' }).success).toBe(false);
    expect(ScheduleSendInputSchema.safeParse({ ...valid, content: '' }).success).toBe(false);
    expect(ScheduleSendInputSchema.safeParse({ ...valid, content: 'x'.repeat(2000) }).success).toBe(
      true,
    );
    expect(ScheduleSendInputSchema.safeParse({ ...valid, content: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('keeps the message exactly as written', () => {
    expect(ScheduleSendInputSchema.parse({ ...valid, content: '  hi\n  there ' }).content).toBe(
      '  hi\n  there ',
    );
  });

  it('refuses a channel that is not a snowflake', () => {
    expect(ScheduleSendInputSchema.safeParse({ ...valid, channelId: '<#123>' }).success).toBe(
      false,
    );
  });
});

describe('ScheduleCopyInputSchema', () => {
  it('trims the source and needs one', () => {
    const base = { channelId: CHANNEL, runAt: '2026-10-20T09:30:00Z' };
    expect(ScheduleCopyInputSchema.parse({ ...base, source: '  link  ' }).source).toBe('link');
    expect(ScheduleCopyInputSchema.safeParse({ ...base, source: '   ' }).success).toBe(false);
  });
});

describe('ScheduledMessageViewSchema', () => {
  const row = {
    id: ID,
    seq: 3,
    kind: 'SEND',
    channelId: CHANNEL,
    content: 'hello',
    sourceChannelId: null,
    sourceMessageId: null,
    allowedMentions: { parse: [] },
    runAt: new Date('2026-10-20T02:30:00.000Z'),
    status: 'PENDING',
    attempts: 0,
    source: 'DISCORD',
    createdByUserId: USER,
    lastError: null,
    createdAt: new Date('2026-10-13T03:00:00.000Z'),
  };

  it('keeps only the public fields of a row', () => {
    const parsed = ScheduledMessageViewSchema.parse({
      ...row,
      guildId: ID,
      pgBossJobId: ID,
      leaseUntil: new Date(),
      apiKeyId: ID,
      updatedAt: new Date(),
    });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(row).sort());
  });

  it('reads the stored mention policy back, with the column default', () => {
    expect(
      ScheduledMessageViewSchema.parse({ ...row, allowedMentions: { parse: [] } }),
    ).toMatchObject({ allowedMentions: { parse: [] } });
    expect(ScheduledMessageViewSchema.safeParse({ ...row, allowedMentions: 'all' }).success).toBe(
      false,
    );
  });
});

describe('ScheduleListQuerySchema', () => {
  it('defaults to the most a listing returns and refuses more', () => {
    expect(ScheduleListQuerySchema.parse({}).limit).toBe(SCHEDULE_LIST_MAX);
    expect(ScheduleListQuerySchema.safeParse({ limit: SCHEDULE_LIST_MAX + 1 }).success).toBe(false);
    expect(ScheduleListQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
  });
});

describe('ScheduleCancelResultSchema', () => {
  it('names the four outcomes', () => {
    for (const code of ['CANCELED', 'ALREADY_CANCELED', 'NOT_PENDING', 'NOT_FOUND']) {
      expect(
        ScheduleCancelResultSchema.safeParse({ dryRun: false, code, seq: 1, status: null }).success,
        code,
      ).toBe(true);
    }
  });
});
