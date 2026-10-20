import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_CODE_MAX_ATTEMPTS, EMAIL_USER_DAILY_MAIL_CAP } from '@sab/shared';
import { ADDRESS_CHECK_MAX, EmailActionLimiter, TEST_MAIL_MAX } from './email-action-limiter.js';
import { EmailCryptoService } from './email-crypto.js';
import { businessDay } from './email-verify-data.js';
import { EmailVerifyService } from './email-verify.service.js';

const GUILD = '300000000000000001';
const GUILD_ROW = '0190a000-0000-7000-8000-0000000000a1';
const USER = '300000000000000010';
const OTHER = '300000000000000011';
const ROLE_DEFAULT = '300000000000000021';
const ROLE_RULE = '300000000000000022';
const UNVERIFIED = '300000000000000023';
const secret = randomBytes(24).toString('hex');

type Pending = {
  id: string;
  guildId: string;
  userId: string;
  emailEnc: string;
  emailHash: string;
  codeHash: string;
  attempts: number;
  sendCount: number;
  expiresAt: Date;
  lastSentAt: Date;
};

const eduRule = {
  roleIds: [ROLE_RULE],
  condition: { combinator: 'or', rules: [{ field: 'domain', operator: '=', value: '*.edu.test' }] },
};

type Throttle = { day: Date; count: number; lastSentAt: Date };

function setup(options: { rules?: unknown[]; blocks?: string[] } = {}) {
  const crypto = new EmailCryptoService({ secret, adminGuildId: GUILD });
  let pending: Pending | null = null;
  const order: string[] = [];
  const state = {
    holder: null as { userId: string } | null,
    verifiedUser: false,
    dayCount: 1,
    enabled: true,
  };
  const throttle: { row: Throttle | null } = { row: null };
  const verifiedAddress = 'a@lab.edu.test';

  const prisma = {
    emailVerifyConfig: {
      findFirst: vi.fn(() => Promise.resolve({ guildId: GUILD_ROW, enabled: state.enabled })),
      findUnique: vi.fn(() =>
        Promise.resolve({
          enabled: state.enabled,
          defaultRoleIds: [ROLE_DEFAULT],
          unverifiedRoleId: UNVERIFIED,
        }),
      ),
    },
    guild: { findUnique: vi.fn(() => Promise.resolve({ id: GUILD_ROW })) },
    accessRule: { findMany: vi.fn(() => Promise.resolve(options.rules ?? [])) },
    emailBlockPattern: {
      findMany: vi.fn(() =>
        Promise.resolve((options.blocks ?? []).map((pattern) => ({ pattern }))),
      ),
    },
    emailListEntry: { findMany: vi.fn(() => Promise.resolve([])) },
    memberJoinInvite: { findUnique: vi.fn(() => Promise.resolve(null)) },
    emailVerification: {
      findUnique: vi.fn((args: { where: Record<string, unknown> }) => {
        if ('guildId_userId' in args.where) {
          return Promise.resolve(
            state.verifiedUser
              ? {
                  emailEnc: crypto.encrypt(verifiedAddress),
                  emailHash: crypto.hashEmail(verifiedAddress),
                  domain: 'lab.edu.test',
                }
              : null,
          );
        }
        return Promise.resolve(state.holder);
      }),
      create: vi.fn(() => Promise.resolve({})),
    },
    emailVerifyPending: {
      findUnique: vi.fn(() => Promise.resolve(pending)),
      create: vi.fn((args: { data: Omit<Pending, 'id' | 'attempts' | 'sendCount'> }) => {
        pending = { id: 'pending-1', attempts: 0, sendCount: 1, ...args.data };
        return Promise.resolve({ id: pending.id });
      }),
      update: vi.fn((args: { data: Partial<Pending> }) => {
        pending = { ...(pending as Pending), ...args.data };
        return Promise.resolve(pending);
      }),
      delete: vi.fn(() => {
        pending = null;
        return Promise.resolve({});
      }),
      deleteMany: vi.fn(() => {
        const count = pending === null ? 0 : 1;
        pending = null;
        return Promise.resolve({ count });
      }),
      updateMany: vi.fn(
        (args: { data: { attempts?: { increment: number }; lastSentAt?: Date } }) => {
          if (pending === null) return Promise.resolve({ count: 0 });
          if (args.data.attempts !== undefined) {
            if (pending.attempts >= 5) return Promise.resolve({ count: 0 });
            pending = { ...pending, attempts: pending.attempts + 1 };
          }
          if (args.data.lastSentAt !== undefined) {
            pending = { ...pending, lastSentAt: args.data.lastSentAt };
          }
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    emailSendDay: {
      createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      updateMany: vi.fn(() => Promise.resolve({ count: state.dayCount })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    emailSendThrottle: {
      findUnique: vi.fn(() => Promise.resolve(throttle.row)),
      upsert: vi.fn((args: { create: Throttle; update: Throttle }) => {
        throttle.row = throttle.row === null ? args.create : args.update;
        return Promise.resolve({});
      }),
      updateMany: vi.fn((args: { data: { lastSentAt: Date } }) => {
        if (throttle.row !== null) throttle.row = { ...throttle.row, ...args.data };
        return Promise.resolve({ count: throttle.row === null ? 0 : 1 });
      }),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    $executeRaw: vi.fn(() => Promise.resolve(0)),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push('tx-start');
      const result = await fn(prisma);
      order.push('tx-commit');
      return result;
    }),
  };
  const mailer = {
    sendVerificationCode: vi.fn(() => {
      order.push('mail');
      return Promise.resolve();
    }),
    sendTestMail: vi.fn(),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const discord = {
    guildName: vi.fn(() => Promise.resolve('Study')),
    locale: vi.fn(() => Promise.resolve('en')),
    grantRoles: vi.fn(),
    postLog: vi.fn(() => Promise.resolve()),
  };
  const service = new EmailVerifyService(
    prisma as never,
    audit as never,
    { ensureGuild: vi.fn(() => Promise.resolve({ id: GUILD_ROW })) } as never,
    crypto,
    { ready: vi.fn(() => Promise.resolve(true)) } as never,
    mailer as never,
    discord as never,
    new EmailActionLimiter(),
  );
  return {
    service,
    prisma,
    mailer,
    audit,
    discord,
    order,
    state,
    throttle,
    getPending: () => pending,
    dropPending: () => {
      pending = null;
    },
  };
}

const sentCode = (mailer: { sendVerificationCode: { mock: { calls: unknown[][] } } }) =>
  (mailer.sendVerificationCode.mock.calls[0]?.[0] as { code: string }).code;

describe('requestCode', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup({ rules: [eduRule] });
  });

  it('mails a code only after the pending row committed, and masks the address', async () => {
    const result = await ctx.service.requestCode(GUILD, USER, ' Ann@Lab.EDU.test ', 'en');
    expect(result).toMatchObject({ status: 'SENT', maskedEmail: 'a***@lab.edu.test' });
    expect(ctx.order).toEqual(['tx-start', 'tx-commit', 'mail']);
    expect(sentCode(ctx.mailer)).toMatch(/^\d{6}$/);
    // The code is stored only as a hash, the address only encrypted.
    const stored = JSON.stringify(ctx.getPending());
    expect(stored).not.toContain(sentCode(ctx.mailer));
    expect(stored).not.toContain('lab.edu.test');
  });

  it('refuses an address no rule accepts, before any mail', async () => {
    await expect(ctx.service.requestCode(GUILD, USER, 'a@gmail.test', 'en')).rejects.toMatchObject({
      code: 'EMAIL_NOT_ACCEPTED',
    });
    expect(ctx.mailer.sendVerificationCode).not.toHaveBeenCalled();
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a blocked address even when a rule accepts it', async () => {
    const blocked = setup({ rules: [eduRule], blocks: ['*@spam.edu.test'] });
    await expect(
      blocked.service.requestCode(GUILD, USER, 'x@spam.edu.test', 'en'),
    ).rejects.toMatchObject({ code: 'EMAIL_BLOCKED' });
  });

  it('refuses an invalid address and a disabled server', async () => {
    await expect(ctx.service.requestCode(GUILD, USER, 'nope', 'en')).rejects.toMatchObject({
      code: 'EMAIL_INVALID',
    });
    ctx.prisma.emailVerifyConfig.findFirst.mockResolvedValue({
      guildId: GUILD_ROW,
      enabled: false,
    });
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).rejects.toMatchObject({
      code: 'EMAIL_VERIFY_DISABLED',
    });
  });

  it('refuses an address that belongs to another member, and answers a verified member', async () => {
    ctx.state.holder = { userId: OTHER };
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_USED',
    });
    ctx.state.verifiedUser = true;
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).resolves.toEqual({
      status: 'ALREADY_VERIFIED',
      verified: {
        status: 'VERIFIED',
        domain: 'lab.edu.test',
        addRoleIds: [ROLE_DEFAULT, ROLE_RULE],
        removeRoleId: UNVERIFIED,
      },
    });
    expect(ctx.mailer.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('stops at the daily cap and leaves no mail', async () => {
    ctx.state.dayCount = 0;
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).rejects.toMatchObject({
      code: 'EMAIL_DAILY_CAP',
    });
    expect(ctx.mailer.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('holds a second request back for the cooldown', async () => {
    await ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en');
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).rejects.toMatchObject({
      code: 'EMAIL_RESEND_COOLDOWN',
    });
  });

  it('keeps the wait between mails when the pending verification is gone', async () => {
    await ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en');
    ctx.dropPending();
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).rejects.toMatchObject({
      code: 'EMAIL_RESEND_COOLDOWN',
    });
    expect(ctx.mailer.sendVerificationCode).toHaveBeenCalledTimes(1);
  });

  it('caps the mails one member can ask for in a day, pending verification or not', async () => {
    ctx.throttle.row = {
      day: businessDay(new Date()),
      count: EMAIL_USER_DAILY_MAIL_CAP,
      lastSentAt: new Date(Date.now() - 3_600_000),
    };
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).rejects.toMatchObject({
      code: 'EMAIL_USER_DAILY_CAP',
    });
    expect(ctx.mailer.sendVerificationCode).not.toHaveBeenCalled();
    // Yesterday's count no longer limits anyone.
    ctx.throttle.row = { ...ctx.throttle.row, day: new Date(Date.now() - 2 * 86_400_000) };
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).resolves.toMatchObject(
      { status: 'SENT' },
    );
    expect(ctx.throttle.row.count).toBe(1);
  });

  it('answers only a few addresses per window, so the allowlist cannot be mapped', async () => {
    for (let i = 0; i < ADDRESS_CHECK_MAX; i += 1) {
      await expect(
        ctx.service.requestCode(GUILD, USER, `try${i}@gmail.test`, 'en'),
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_ACCEPTED' });
    }
    await expect(
      ctx.service.requestCode(GUILD, USER, 'one@gmail.test', 'en'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // Another member has their own budget.
    await expect(
      ctx.service.requestCode(GUILD, OTHER, 'one@gmail.test', 'en'),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_ACCEPTED' });
  });

  it('lifts the cooldown when the mail could not be sent', async () => {
    ctx.mailer.sendVerificationCode.mockRejectedValueOnce(new Error('down'));
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).rejects.toThrow(
      'down',
    );
    await expect(ctx.service.requestCode(GUILD, USER, 'a@b.edu.test', 'en')).resolves.toMatchObject(
      { status: 'SENT' },
    );
  });
});

describe('confirmCode', () => {
  it('verifies with the right code and returns the roles to change', async () => {
    const ctx = setup({ rules: [eduRule] });
    await ctx.service.requestCode(GUILD, USER, 'a@lab.edu.test', 'en');
    const result = await ctx.service.confirmCode(GUILD, USER, ` ${sentCode(ctx.mailer)} `);
    expect(result).toEqual({
      status: 'VERIFIED',
      domain: 'lab.edu.test',
      addRoleIds: [ROLE_DEFAULT, ROLE_RULE],
      removeRoleId: UNVERIFIED,
    });
    expect(ctx.prisma.emailVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        method: 'CODE',
        domain: 'lab.edu.test',
        userId: USER,
      }) as unknown,
    });
    expect(ctx.getPending()).toBeNull();
    // The audit row names the domain, never the address.
    expect(JSON.stringify(ctx.audit.record.mock.calls)).not.toContain('a@lab');
    expect(JSON.stringify(ctx.audit.record.mock.calls)).toContain('lab.edu.test');
  });

  it('counts a wrong code and keeps the verification spent until it expires', async () => {
    const ctx = setup();
    await ctx.service.requestCode(GUILD, USER, 'a@b.test', 'en');
    const right = sentCode(ctx.mailer);
    const wrong = right === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i += 1) {
      await expect(ctx.service.confirmCode(GUILD, USER, wrong)).rejects.toMatchObject({
        code: 'EMAIL_CODE_INVALID',
      });
    }
    await expect(ctx.service.confirmCode(GUILD, USER, wrong)).rejects.toMatchObject({
      code: 'EMAIL_TOO_MANY_ATTEMPTS',
    });
    // Closing it would hand out five fresh guesses at once: even the right code is refused now.
    expect(ctx.getPending()).not.toBeNull();
    await expect(ctx.service.confirmCode(GUILD, USER, right)).rejects.toMatchObject({
      code: 'EMAIL_TOO_MANY_ATTEMPTS',
    });
  });

  it('answers NO_PENDING when nothing was started and rejects a malformed code without counting', async () => {
    const ctx = setup();
    await expect(ctx.service.confirmCode(GUILD, USER, '123456')).resolves.toEqual({
      status: 'NO_PENDING',
    });
    await ctx.service.requestCode(GUILD, USER, 'a@b.test', 'en');
    await expect(ctx.service.confirmCode(GUILD, USER, 'abc')).rejects.toMatchObject({
      code: 'EMAIL_CODE_INVALID',
    });
    expect(ctx.getPending()?.attempts).toBe(0);
  });

  it('expires a pending verification', async () => {
    const ctx = setup();
    await ctx.service.requestCode(GUILD, USER, 'a@b.test', 'en');
    ctx.prisma.emailVerifyPending.findUnique.mockResolvedValueOnce({
      ...(ctx.getPending() as Pending),
      expiresAt: new Date(Date.now() - 1_000),
    });
    await expect(ctx.service.confirmCode(GUILD, USER, '123456')).rejects.toMatchObject({
      code: 'EMAIL_CODE_EXPIRED',
    });
  });
});

describe('rolesForJoin', () => {
  it('grants the roles of rules that hold for the invite alone', async () => {
    const inviteRule = {
      roleIds: [ROLE_RULE],
      condition: { combinator: 'and', rules: [{ field: 'invite', operator: '=', value: 'abc12' }] },
    };
    const ctx = setup({ rules: [inviteRule, eduRule] });
    await expect(ctx.service.rolesForJoin(GUILD, 'abc12')).resolves.toEqual([ROLE_RULE]);
    await expect(ctx.service.rolesForJoin(GUILD, 'zzz')).resolves.toEqual([]);
    await expect(ctx.service.rolesForJoin(GUILD, null)).resolves.toEqual([]);
  });
});

describe('resendCode', () => {
  it('judges the address again and closes the pending verification when it is refused', async () => {
    const blocks: string[] = [];
    const ctx = setup({ blocks });
    await ctx.service.requestCode(GUILD, USER, 'a@b.test', 'en');
    blocks.push('*@b.test');
    await expect(ctx.service.resendCode(GUILD, USER, 'en')).rejects.toMatchObject({
      code: 'EMAIL_BLOCKED',
    });
    expect(ctx.getPending()).toBeNull();
  });

  it('refuses once the server turned verification off', async () => {
    const ctx = setup();
    await ctx.service.requestCode(GUILD, USER, 'a@b.test', 'en');
    ctx.state.enabled = false;
    await expect(ctx.service.resendCode(GUILD, USER, 'en')).rejects.toMatchObject({
      code: 'EMAIL_VERIFY_DISABLED',
    });
  });

  it('gives no new code to a pending verification whose attempts are spent', async () => {
    const ctx = setup();
    await ctx.service.requestCode(GUILD, USER, 'a@b.test', 'en');
    const wrong = sentCode(ctx.mailer) === '000000' ? '000001' : '000000';
    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i += 1) {
      await expect(ctx.service.confirmCode(GUILD, USER, wrong)).rejects.toBeDefined();
    }
    await expect(ctx.service.resendCode(GUILD, USER, 'en')).rejects.toMatchObject({
      code: 'EMAIL_RESEND_COOLDOWN',
    });
    expect(ctx.mailer.sendVerificationCode).toHaveBeenCalledTimes(1);
  });
});

describe('confirmCode when verification is off or the member is verified', () => {
  it('refuses a code once the server turned verification off', async () => {
    const ctx = setup();
    await ctx.service.requestCode(GUILD, USER, 'a@b.test', 'en');
    ctx.state.enabled = false;
    await expect(ctx.service.confirmCode(GUILD, USER, sentCode(ctx.mailer))).rejects.toMatchObject({
      code: 'EMAIL_VERIFY_DISABLED',
    });
  });

  it('hands a verified member the roles of their verification again', async () => {
    const ctx = setup({ rules: [eduRule] });
    ctx.state.verifiedUser = true;
    await expect(ctx.service.confirmCode(GUILD, USER, '123456')).resolves.toMatchObject({
      status: 'ALREADY_VERIFIED',
      verified: { addRoleIds: [ROLE_DEFAULT, ROLE_RULE], removeRoleId: UNVERIFIED },
    });
  });
});

describe('applyVerified', () => {
  const verified = {
    status: 'VERIFIED' as const,
    domain: 'lab.edu.test',
    addRoleIds: [ROLE_DEFAULT, ROLE_RULE],
    removeRoleId: UNVERIFIED,
  };
  const result = (extra: Record<string, unknown>) => ({
    added: [],
    removed: [],
    refused: [],
    failure: null,
    memberGone: false,
    ...extra,
  });

  it('logs the roles that were given and names the ones Discord refused', async () => {
    const ctx = setup();
    ctx.discord.grantRoles.mockResolvedValue(
      result({ added: [ROLE_DEFAULT], refused: [ROLE_RULE], failure: 'Missing Permissions' }),
    );
    await ctx.service.applyVerified(GUILD, USER, verified);
    const line = (ctx.discord.postLog.mock.calls[0] as unknown as [string, string])[1];
    expect(line).toContain(`<@&${ROLE_DEFAULT}>`);
    expect(line.split('\n')[0]).not.toContain(`<@&${ROLE_RULE}>`);
    expect(line).toContain('Missing Permissions');
    expect(line).toContain(`<@&${ROLE_RULE}>`);
  });

  it('stays quiet when a repeat finds nothing to change, and speaks when it restores a role', async () => {
    const ctx = setup();
    ctx.discord.grantRoles.mockResolvedValue(result({}));
    await ctx.service.applyVerified(GUILD, USER, verified, { rerun: true });
    expect(ctx.discord.postLog).not.toHaveBeenCalled();
    ctx.discord.grantRoles.mockResolvedValue(result({ added: [ROLE_RULE] }));
    await ctx.service.applyVerified(GUILD, USER, verified, { rerun: true });
    expect(ctx.discord.postLog).toHaveBeenCalledTimes(1);
  });
});

describe('testMail', () => {
  const actor = { source: 'DISCORD', userId: USER } as const;

  it('audits the domain only and counts the mail against the day', async () => {
    const ctx = setup();
    await ctx.service.testMail(GUILD, { email: 'Boss@Corp.Test' }, actor);
    expect(ctx.mailer.sendTestMail).toHaveBeenCalledTimes(1);
    const audited = JSON.stringify(ctx.audit.record.mock.calls);
    expect(audited).toContain('corp.test');
    expect(audited).not.toContain('boss');
  });

  it('gives the day count back when the mail cannot be sent', async () => {
    const ctx = setup();
    ctx.mailer.sendTestMail.mockRejectedValueOnce(new Error('down'));
    await expect(ctx.service.testMail(GUILD, { email: 'a@corp.test' }, actor)).rejects.toThrow(
      'down',
    );
    expect(ctx.prisma.emailSendDay.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { count: { decrement: 1 } } }),
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('lets one person send a few per window', async () => {
    const ctx = setup();
    for (let i = 0; i < TEST_MAIL_MAX; i += 1) {
      await ctx.service.testMail(GUILD, { email: 'a@corp.test' }, actor);
    }
    await expect(
      ctx.service.testMail(GUILD, { email: 'a@corp.test' }, actor),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('purgeExpired', () => {
  it('also removes the member throttles of days that can no longer limit anyone', async () => {
    const ctx = setup();
    await ctx.service.purgeExpired(new Date());
    expect(ctx.prisma.emailSendThrottle.deleteMany).toHaveBeenCalledTimes(1);
  });
});
