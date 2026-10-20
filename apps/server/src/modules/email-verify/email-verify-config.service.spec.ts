import { describe, expect, it, vi } from 'vitest';
import { EmailVerifyConfigService } from './email-verify-config.service.js';

const GUILD = '300000000000000001';
const ROW = '0190a000-0000-7000-8000-0000000000a1';
const ROLE = '300000000000000021';
const actor = { source: 'HTTP', userId: '300000000000000099' } as const;

const CHANNEL = '300000000000000031';

function setup(stored: Record<string, unknown> | null = null) {
  const tx = {
    emailVerifyConfig: { upsert: vi.fn() },
    accessRule: { deleteMany: vi.fn(), createMany: vi.fn() },
    emailBlockPattern: { deleteMany: vi.fn(), createMany: vi.fn() },
    $executeRaw: vi.fn(),
  };
  const prisma = {
    guild: { findUnique: vi.fn(() => Promise.resolve({ id: ROW })) },
    emailVerifyConfig: { findFirst: vi.fn(() => Promise.resolve(stored)) },
    accessRule: { findMany: vi.fn(() => Promise.resolve([])) },
    emailList: { findMany: vi.fn(() => Promise.resolve([{ name: 'k21' }])) },
    emailBlockPattern: { findMany: vi.fn(() => Promise.resolve([])) },
    $transaction: vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const channelAccess = { check: vi.fn(() => Promise.resolve('ok')) };
  const service = new EmailVerifyConfigService(
    prisma as never,
    audit as never,
    { ensureGuild: vi.fn(() => Promise.resolve({ id: ROW })) } as never,
    { ready: vi.fn(() => Promise.resolve(false)) } as never,
    { available: true } as never,
    channelAccess as never,
  );
  return { service, prisma, tx, audit, channelAccess };
}

const rule = (value: string, field = 'list') => ({
  roleIds: [ROLE, ROLE],
  condition: { combinator: 'and', rules: [{ field, operator: '=', value }] },
});

describe('setRules', () => {
  it('stores the rules in order with unique roles, audits counts only, and reports missing lists', async () => {
    const { service, tx, audit } = setup();
    await service.setRules(GUILD, { rules: [rule('k21'), rule('ghost')] }, actor);
    expect(tx.accessRule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ guildId: ROW, position: 0, roleIds: [ROLE] }),
        expect.objectContaining({ position: 1 }),
      ],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'email_verify.rules_set',
        params: { ruleCount: 2, termCount: 2 },
      }),
      tx,
    );
  });

  it('previews without writing and shows the text form and the missing lists', async () => {
    const { service, prisma } = setup();
    const view = await service.setRules(GUILD, { rules: [rule('ghost')] }, actor, { dryRun: true });
    expect(view.rules[0]).toMatchObject({ text: 'list:ghost', missingLists: ['ghost'] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('names the rule that is not valid', async () => {
    const { service } = setup();
    await expect(
      service.setRules(GUILD, { rules: [rule('k21'), rule('bad value!', 'domain')] }, actor),
    ).rejects.toMatchObject({
      code: 'EMAIL_RULE_INVALID',
      // The text that was wrong and a plain reason, not a path into the request body.
      params: { rule: 2, term: 'bad value!', reason: 'invalid domain value' },
    });
  });

  it('says why a rule with too many conditions or roles is refused', async () => {
    const { service } = setup();
    const many = {
      roleIds: [ROLE],
      condition: {
        combinator: 'or',
        rules: Array.from({ length: 21 }, (_, i) => ({ field: 'list', value: `l${i}` })),
      },
    };
    await expect(service.setRules(GUILD, { rules: [many] }, actor)).rejects.toMatchObject({
      code: 'EMAIL_RULE_INVALID',
      params: { rule: 1 },
    });
    const roles = {
      ...rule('k21'),
      roleIds: Array.from(
        { length: 26 },
        (_, i) => `3000000000000001${String(i).padStart(2, '0')}`,
      ),
    };
    await expect(service.setRules(GUILD, { rules: [roles] }, actor)).rejects.toMatchObject({
      code: 'EMAIL_RULE_INVALID',
      params: { rule: 1, term: 'roles' },
    });
  });
});

describe('patch', () => {
  it('refuses to turn verification on while no mail account is usable', async () => {
    const { service } = setup();
    await expect(service.patch(GUILD, { enabled: true }, actor)).rejects.toMatchObject({
      code: 'SMTP_NOT_CONFIGURED',
    });
  });

  it('does not look at the mail account or the log channel again when they do not change', async () => {
    const { service, channelAccess } = setup({
      enabled: true,
      defaultRoleIds: [],
      unverifiedRoleId: null,
      logChannelId: CHANNEL,
      verifyMessage: null,
      autoVerifyOnJoin: false,
      autoUnverifiedOnJoin: false,
    });
    // The mail account is unusable (see above), yet other settings can still change.
    await expect(
      service.patch(GUILD, { enabled: true, logChannelId: CHANNEL, autoVerifyOnJoin: true }, actor),
    ).resolves.toBeDefined();
    expect(channelAccess.check).not.toHaveBeenCalled();
  });

  it('checks the log channel when it changes', async () => {
    const { service, channelAccess } = setup();
    await service.patch(GUILD, { logChannelId: CHANNEL }, actor);
    expect(channelAccess.check).toHaveBeenCalledWith(CHANNEL, 'send', GUILD);
  });

  it('refuses an empty patch', async () => {
    const { service } = setup();
    await expect(service.patch(GUILD, {}, actor)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('setBlocklist', () => {
  it('replaces the list with distinct patterns and audits the count', async () => {
    const { service, tx, audit } = setup();
    const result = await service.setBlocklist(
      GUILD,
      { patterns: ['*@b.test', '*@a.test', '*@b.test'] },
      actor,
    );
    expect(result.patterns).toEqual(['*@a.test', '*@b.test']);
    expect(tx.emailBlockPattern.createMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ params: { patternCount: 2 } }),
      tx,
    );
  });
});
