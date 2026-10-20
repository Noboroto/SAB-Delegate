import { describe, expect, it } from 'vitest';
import {
  AccessRulesInputSchema,
  EmailBlocklistSchema,
  EmailListCreateSchema,
  EmailVerifyConfigPatchSchema,
  SmtpSettingsInputSchema,
} from './email-verify.js';

const ROLE = '123456789012345678';

describe('EmailVerifyConfigPatchSchema', () => {
  it('leaves a field that is not sent out of the result', () => {
    expect(EmailVerifyConfigPatchSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(EmailVerifyConfigPatchSchema.parse({ defaultRoleIds: [ROLE] })).toEqual({
      defaultRoleIds: [ROLE],
    });
  });

  it('still checks what is sent', () => {
    expect(EmailVerifyConfigPatchSchema.safeParse({ defaultRoleIds: ['x'] }).success).toBe(false);
    expect(
      EmailVerifyConfigPatchSchema.safeParse({ verifyMessage: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });
});

describe('AccessRulesInputSchema', () => {
  it('normalises the conditions and limits the rule count', () => {
    const rule = {
      condition: { combinator: 'or', rules: [{ field: 'domain', value: '@EDU.vn' }] },
      roleIds: [ROLE],
    };
    expect(AccessRulesInputSchema.parse({ rules: [rule] }).rules[0]?.condition.rules).toEqual([
      { field: 'domain', operator: '=', value: 'edu.vn' },
    ]);
    expect(AccessRulesInputSchema.safeParse({ rules: Array(26).fill(rule) }).success).toBe(false);
  });
});

describe('blocklist, list name and SMTP input', () => {
  it('lower-cases patterns and refuses spaces', () => {
    expect(EmailBlocklistSchema.parse({ patterns: ['*@Temp.com'] }).patterns).toEqual([
      '*@temp.com',
    ]);
    expect(EmailBlocklistSchema.safeParse({ patterns: ['a b'] }).success).toBe(false);
  });

  it('wants a list name of lower-case word characters', () => {
    expect(EmailListCreateSchema.parse({ name: ' K21 ' }).name).toBe('k21');
    expect(EmailListCreateSchema.safeParse({ name: 'a b' }).success).toBe(false);
  });

  it('keeps the password as typed and allows leaving it out', () => {
    const base = {
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      username: 'bot',
      fromAddress: 'Bot@Example.com',
      fromName: null,
      enabled: true,
    };
    expect(SmtpSettingsInputSchema.parse(base)).toMatchObject({ fromAddress: 'bot@example.com' });
    expect(SmtpSettingsInputSchema.parse({ ...base, password: ' pw ' }).password).toBe(' pw ');
    expect(SmtpSettingsInputSchema.safeParse({ ...base, port: 70000 }).success).toBe(false);
  });
});
