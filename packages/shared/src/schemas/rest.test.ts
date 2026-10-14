import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BirthdayRemoveQuerySchema,
  BotProfileSetRequestSchema,
  MentionReactorsRequestSchema,
  PurgeRequestSchema,
  ThreadCreateRequestSchema,
  requireConfirmation,
} from './rest.js';

const ID = '1'.repeat(18);

describe('requireConfirmation', () => {
  const schema = requireConfirmation(
    z.object({
      name: z.string(),
      dryRun: z.boolean().default(false),
      confirm: z.boolean().default(false),
    }),
  );

  it('accepts a preview or a confirmed run', () => {
    expect(schema.parse({ name: 'a', dryRun: true })).toEqual({
      name: 'a',
      dryRun: true,
      confirm: false,
    });
    expect(schema.parse({ name: 'a', confirm: true })).toMatchObject({ dryRun: false });
  });

  it('refuses neither, pointing at confirm', () => {
    const result = schema.safeParse({ name: 'a' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirm']);
  });
});

describe('BirthdayRemoveQuerySchema', () => {
  it('takes a student ID or a Discord user, one of them', () => {
    expect(
      BirthdayRemoveQuerySchema.safeParse({ studentId: 'SE123456', confirm: 'true' }).success,
    ).toBe(true);
    expect(BirthdayRemoveQuerySchema.safeParse({ discordId: ID, dryRun: 'true' }).success).toBe(
      true,
    );
  });

  it('refuses both and neither', () => {
    const both = BirthdayRemoveQuerySchema.safeParse({
      studentId: 'SE123456',
      discordId: ID,
      confirm: 'true',
    });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.path).toEqual(['studentId']);
    expect(BirthdayRemoveQuerySchema.safeParse({ confirm: 'true' }).success).toBe(false);
  });

  it('still needs confirm or dryRun', () => {
    expect(BirthdayRemoveQuerySchema.safeParse({ discordId: ID }).success).toBe(false);
  });
});

describe('request schemas shared with the REST controllers', () => {
  const last = { mode: 'last', channelId: ID, count: 5 };

  it('purge needs confirm or dryRun and a known mode', () => {
    expect(PurgeRequestSchema.safeParse({ mode: 'nope' }).success).toBe(false);
    expect(PurgeRequestSchema.safeParse(last).success).toBe(false);
    expect(PurgeRequestSchema.safeParse({ ...last, dryRun: true }).success).toBe(true);
    expect(PurgeRequestSchema.safeParse({ ...last, confirm: true }).success).toBe(true);
  });

  it('a thread is created without a byline', () => {
    const parsed = ThreadCreateRequestSchema.parse({
      channelId: ID,
      name: 'x',
      message: 'hello',
      byline: 'someone',
    });
    expect(parsed).not.toHaveProperty('byline');
  });

  it('a mention preview flag defaults to a real run', () => {
    expect(MentionReactorsRequestSchema.shape.dryRun.parse(undefined)).toBe(false);
  });

  it('the bot nickname may be cleared with null but not emptied or overlong', () => {
    expect(BotProfileSetRequestSchema.safeParse({ nick: null }).success).toBe(true);
    expect(BotProfileSetRequestSchema.safeParse({ nick: '' }).success).toBe(false);
    expect(BotProfileSetRequestSchema.safeParse({ nick: 'x'.repeat(33) }).success).toBe(false);
    expect(BotProfileSetRequestSchema.safeParse({ nick: 'x'.repeat(32) }).success).toBe(true);
    expect(BotProfileSetRequestSchema.safeParse({ avatar: null }).success).toBe(true);
  });
});
