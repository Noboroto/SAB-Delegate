import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EmailCryptoService } from './email-crypto.js';
import { EmailVerifyMembersService } from './email-verify-members.service.js';

vi.mock('write-excel-file/node', () => ({
  default: vi.fn(() => ({ toBuffer: () => Promise.resolve(Buffer.from('xlsx')) })),
}));

const GUILD = '300000000000000001';
const USER_A = '300000000000000010';
const USER_B = '300000000000000011';
const secret = randomBytes(24).toString('hex');
const actor = { source: 'HTTP', userId: '300000000000000099' } as const;

function setup(options: { total?: number; unresolved?: number } = {}) {
  const crypto = new EmailCryptoService({ secret, adminGuildId: GUILD });
  const rows = [USER_A, USER_B].map((userId, index) => ({
    userId,
    domain: 'lab.test',
    method: 'CODE',
    verifiedAt: new Date(Date.UTC(2026, 9, 1 + index)),
    emailEnc: crypto.encrypt(`m${index}@lab.test`),
  }));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prisma = {
    emailVerification: {
      count: vi.fn(() => Promise.resolve(options.total ?? rows.length)),
      findMany: vi.fn(() => gate.then(() => rows)),
    },
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const discord = {
    locale: vi.fn(() => Promise.resolve('en')),
    lookupManyMembers: vi.fn(() =>
      Promise.resolve({ found: new Map(), unresolved: options.unresolved ?? 0 }),
    ),
  };
  const service = new EmailVerifyMembersService(
    prisma as never,
    audit as never,
    {} as never,
    crypto,
    discord as never,
  );
  return { service, prisma, audit, discord, release };
}

describe('exportXlsx', () => {
  it('refuses a server with too many verified members before reading anything else', async () => {
    const { service, prisma, discord } = setup({ total: 20_001 });
    await expect(service.exportXlsx(GUILD, actor)).rejects.toMatchObject({
      code: 'EMAIL_EXPORT_TOO_LARGE',
      params: { max: 20_000 },
    });
    expect(prisma.emailVerification.findMany).not.toHaveBeenCalled();
    expect(discord.lookupManyMembers).not.toHaveBeenCalled();
  });

  it('says how many members Discord could not name', async () => {
    const { service, release } = setup({ unresolved: 2 });
    const pending = service.exportXlsx(GUILD, actor);
    release();
    await expect(pending).resolves.toMatchObject({ count: 2, unresolved: 2 });
  });

  it('builds one file per server at a time and audits every caller', async () => {
    const { service, prisma, audit, release } = setup();
    const first = service.exportXlsx(GUILD, actor);
    const second = service.exportXlsx(GUILD, { ...actor, userId: '300000000000000098' });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(prisma.emailVerification.findMany).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(2);
    // Once it is done, the next request builds a fresh file.
    await service.exportXlsx(GUILD, actor);
    expect(prisma.emailVerification.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not put an address in the audit row', async () => {
    const { service, audit, release } = setup();
    const pending = service.exportXlsx(GUILD, actor);
    release();
    await pending;
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('lab.test');
  });
});
