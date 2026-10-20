import { randomBytes } from 'node:crypto';
import { EMAIL_LIST_ENTRIES_MAX } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { EmailCryptoService } from './email-crypto.js';
import { EmailListService } from './email-list.service.js';

const GUILD = '300000000000000001';
const LIST = '0190a000-0000-7000-8000-0000000000c1';
const secret = randomBytes(24).toString('hex');
const actor = { source: 'HTTP', userId: '300000000000000099' } as const;

function setup(existing: string[] = []) {
  const crypto = new EmailCryptoService({ secret, adminGuildId: GUILD });
  const tx = {
    emailListEntry: {
      findMany: vi.fn(() =>
        Promise.resolve(existing.map((email) => ({ emailHash: crypto.hashEmail(email) }))),
      ),
      count: vi.fn(() => Promise.resolve(existing.length)),
      createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      deleteMany: vi.fn(() => Promise.resolve({ count: existing.length })),
    },
    $executeRaw: vi.fn(),
  };
  const prisma = {
    emailList: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: LIST,
          name: 'k21',
          createdAt: new Date(),
          _count: { entries: existing.length },
        }),
      ),
    },
    emailListEntry: tx.emailListEntry,
    $transaction: vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const service = new EmailListService(prisma as never, audit as never, {} as never, crypto);
  return { service, tx, audit, crypto };
}

describe('addEntries', () => {
  it('counts new, skipped and invalid, and stores hashes only', async () => {
    const { service, tx, audit, crypto } = setup(['old@example.test']);
    const result = await service.addEntries(
      GUILD,
      LIST,
      { emails: ['Old@Example.test', 'new@example.test', 'NEW@example.test', 'not an address'] },
      actor,
    );
    expect(result).toEqual({ changed: 1, skipped: 2, invalid: 1 });
    expect(tx.emailListEntry.createMany).toHaveBeenCalledWith({
      data: [{ listId: LIST, emailHash: crypto.hashEmail('new@example.test') }],
      skipDuplicates: true,
    });
    const audited = JSON.stringify(audit.record.mock.calls);
    expect(audited).not.toContain('example.test');
  });

  it('answers EMAIL_LIST_FULL, not a generic validation error, when the list would overflow', async () => {
    const { service, tx } = setup();
    tx.emailListEntry.count.mockResolvedValue(EMAIL_LIST_ENTRIES_MAX);
    await expect(
      service.addEntries(GUILD, LIST, { emails: ['a@example.test'] }, actor),
    ).rejects.toMatchObject({ code: 'EMAIL_LIST_FULL' });
    expect(tx.emailListEntry.createMany).not.toHaveBeenCalled();
  });

  it('writes nothing on a dry run', async () => {
    const { service, tx } = setup();
    const result = await service.addEntries(GUILD, LIST, { emails: ['a@example.test'] }, actor, {
      dryRun: true,
    });
    expect(result.changed).toBe(1);
    expect(tx.emailListEntry.createMany).not.toHaveBeenCalled();
  });
});

describe('removeEntries and clearEntries', () => {
  it('reports what was removed and skipped', async () => {
    const { service } = setup(['a@example.test']);
    const result = await service.removeEntries(
      GUILD,
      LIST,
      { emails: ['a@example.test', 'b@example.test'] },
      actor,
    );
    expect(result).toEqual({ changed: 1, skipped: 1, invalid: 0 });
  });

  it('says what a clear would cost on a dry run', async () => {
    const { service, tx } = setup(['a@example.test', 'b@example.test']);
    await expect(service.clearEntries(GUILD, LIST, actor, { dryRun: true })).resolves.toEqual({
      listName: 'k21',
      entries: 2,
    });
    expect(tx.emailListEntry.deleteMany).not.toHaveBeenCalled();
  });
});
