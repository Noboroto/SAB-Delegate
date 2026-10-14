import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ErrorCode, type ActorContext } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ScheduleService } from '../schedule/schedule.service.js';
import { ApiKeyService } from './api-key.service.js';

const USER = '5'.repeat(18);
const OTHER = '6'.repeat(18);
const KEY_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ACTOR: ActorContext = { source: 'HTTP', userId: USER };
const NOW = new Date('2026-10-14T03:00:00.000Z');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type Row = Record<string, unknown>;

function viewRow(over: Row = {}): Row {
  return {
    id: KEY_ID,
    name: 'agent',
    prefix: 'sab_AbCd',
    mode: 'READ',
    lastUsedIp: null,
    lastUsedAt: null,
    expiresAt: new Date(NOW.getTime() + 90 * 86_400_000),
    revokedAt: null,
    createdAt: NOW,
    ...over,
  };
}

function build() {
  const order: string[] = [];
  const apiKey = {
    count: vi.fn(() => {
      order.push('count');
      return Promise.resolve(0);
    }),
    create: vi.fn((args: { data: Row }) => {
      order.push('create');
      return Promise.resolve(viewRow({ ...args.data, id: KEY_ID }));
    }),
    findMany: vi.fn(() => Promise.resolve([viewRow()])),
    findFirst: vi.fn((): Promise<Row | null> => Promise.resolve(viewRow())),
    findUnique: vi.fn(),
    updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
  };
  const tx = {
    apiKey,
    $executeRaw: vi.fn(() => {
      order.push('lock');
      return Promise.resolve(1);
    }),
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const schedules = { cancelByApiKey: vi.fn(() => Promise.resolve({ count: 0 })) };
  const service = new ApiKeyService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    schedules as unknown as ScheduleService,
  );
  return { service, apiKey, prisma, tx, audit, schedules, order };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ApiKeyService.mint', () => {
  it('returns a sab_ secret once and stores only its hash and display prefix', async () => {
    const { service, apiKey, audit } = build();
    const result = await service.mint(USER, { name: 'agent', mode: 'READ' }, ACTOR);

    expect(result.plaintext).toMatch(/^sab_[A-Za-z0-9_-]{43}$/);
    const data = (apiKey.create.mock.calls[0]?.[0] as { data: Row }).data;
    expect(data).toMatchObject({
      discordUserId: USER,
      name: 'agent',
      mode: 'READ',
      prefix: result.plaintext.slice(0, 8),
      keyHash: sha256(result.plaintext),
    });
    expect(JSON.stringify(data)).not.toContain(result.plaintext);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(result.plaintext);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(sha256(result.plaintext));
    expect(result).not.toHaveProperty('keyHash');
  });

  it('gives different secrets to different keys', async () => {
    const { service } = build();
    const first = await service.mint(USER, { name: 'a', mode: 'READ' }, ACTOR);
    const second = await service.mint(USER, { name: 'b', mode: 'READ' }, ACTOR);
    expect(first.plaintext).not.toBe(second.plaintext);
  });

  it('takes the per-person lock before it counts, and counts before it inserts', async () => {
    const { service, order, tx } = build();
    await service.mint(USER, { name: 'agent', mode: 'READ' }, ACTOR);
    expect(order).toEqual(['lock', 'count', 'create']);
    // The lock is keyed on the person, so two people never wait on each other.
    const strings = (tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string])[1];
    expect(strings).toBe(`api-key:${USER}`);
  });

  it('counts only keys that are neither revoked nor expired', async () => {
    const { service, apiKey } = build();
    await service.mint(USER, { name: 'agent', mode: 'READ' }, ACTOR);
    expect(apiKey.count).toHaveBeenCalledWith({
      where: {
        discordUserId: USER,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
      },
    });
  });

  it('refuses the sixth active key and creates nothing', async () => {
    const { service, apiKey, audit } = build();
    apiKey.count.mockResolvedValueOnce(5);
    await expect(service.mint(USER, { name: 'agent', mode: 'READ' }, ACTOR)).rejects.toEqual(
      new ServiceError(ErrorCode.API_KEY_LIMIT_REACHED),
    );
    expect(apiKey.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sets the expiry from the days asked for, with the creation time from the same clock', async () => {
    const { service, apiKey } = build();
    await service.mint(USER, { name: 'w', mode: 'WRITE', expiresInDays: 30 }, ACTOR);
    const data = (apiKey.create.mock.calls[0]?.[0] as { data: Row }).data;
    expect(data['createdAt']).toEqual(NOW);
    expect(data['expiresAt']).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
  });

  it('defaults to 90 days for a read key and 30 for a write key', async () => {
    const { service, apiKey } = build();
    await service.mint(USER, { name: 'r', mode: 'READ' }, ACTOR);
    await service.mint(USER, { name: 'w', mode: 'WRITE' }, ACTOR);
    const expiries = apiKey.create.mock.calls.map(
      (call) => ((call as unknown[])[0] as { data: { expiresAt: Date } }).data.expiresAt,
    );
    expect(expiries).toEqual([
      new Date(NOW.getTime() + 90 * 86_400_000),
      new Date(NOW.getTime() + 30 * 86_400_000),
    ]);
  });

  it.each([
    ['a read key over 365 days', { name: 'k', mode: 'READ', expiresInDays: 366 }],
    ['a write key over 30 days', { name: 'k', mode: 'WRITE', expiresInDays: 31 }],
    ['an empty name', { name: ' ', mode: 'READ' }],
  ] as const)('refuses %s', async (_label, input) => {
    const { service, prisma } = build();
    await expect(service.mint(USER, input, ACTOR)).rejects.toEqual(
      new ServiceError(ErrorCode.VALIDATION_FAILED),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an owner id that is not a snowflake', async () => {
    const { service } = build();
    await expect(service.mint('someone', { name: 'k', mode: 'READ' }, ACTOR)).rejects.toEqual(
      new ServiceError(ErrorCode.VALIDATION_FAILED),
    );
  });

  it('audits the mint inside the same transaction without secret or hash', async () => {
    const { service, audit, tx } = build();
    const minted = await service.mint(USER, { name: 'agent', mode: 'WRITE' }, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actor: ACTOR,
        action: 'api_key.mint',
        params: { targetId: KEY_ID, keyPrefix: minted.plaintext.slice(0, 8), mode: 'WRITE' },
      },
      tx,
    );
  });
});

describe('ApiKeyService.verify', () => {
  const SECRET = `sab_${'A'.repeat(43)}`;
  const live = (over: Row = {}) => ({
    id: KEY_ID,
    discordUserId: USER,
    mode: 'WRITE',
    revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    ...over,
  });

  it.each(['', 'sab_short', 'Bearer abc', `sab_${'A'.repeat(44)}`, `xyz_${'A'.repeat(43)}`])(
    'rejects %j without a database lookup',
    async (bearer) => {
      const { service, apiKey } = build();
      await expect(service.verify(bearer)).resolves.toBeNull();
      expect(apiKey.findUnique).not.toHaveBeenCalled();
    },
  );

  it('looks the key up by the hash of what was presented', async () => {
    const { service, apiKey } = build();
    apiKey.findUnique.mockResolvedValue(live());
    await service.verify(SECRET);
    expect(apiKey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keyHash: sha256(SECRET) } }),
    );
  });

  it('returns the principal of a live key', async () => {
    const { service, apiKey } = build();
    apiKey.findUnique.mockResolvedValue(live());
    await expect(service.verify(SECRET, '203.0.113.7')).resolves.toEqual({
      discordUserId: USER,
      apiKeyId: KEY_ID,
      mode: 'WRITE',
    });
  });

  it.each([
    ['unknown', null],
    ['revoked', live({ revokedAt: new Date(NOW.getTime() - 1000) })],
    ['expired', live({ expiresAt: new Date(NOW.getTime() - 1000) })],
    ['expiring right now', live({ expiresAt: NOW })],
  ])('rejects a key that is %s and records no use', async (_label, row) => {
    const { service, apiKey } = build();
    apiKey.findUnique.mockResolvedValue(row);
    await expect(service.verify(SECRET)).resolves.toBeNull();
    expect(apiKey.updateMany).not.toHaveBeenCalled();
  });

  it('records the use only when the last one is older than a minute, as one conditional write', async () => {
    const { service, apiKey } = build();
    apiKey.findUnique.mockResolvedValue(live());
    await service.verify(SECRET, '203.0.113.7');
    expect(apiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: KEY_ID,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(NOW.getTime() - 60_000) } }],
      },
      data: { lastUsedAt: NOW, lastUsedIp: '203.0.113.7' },
    });
  });

  it('still accepts a live key when recording its use fails, and logs no key material', async () => {
    const { service, apiKey } = build();
    apiKey.findUnique.mockResolvedValue(live());
    apiKey.updateMany.mockRejectedValueOnce(new Error(`connection lost near ${SECRET}`));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(service.verify(SECRET)).resolves.toEqual({
      discordUserId: USER,
      apiKeyId: KEY_ID,
      mode: 'WRITE',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain(KEY_ID);
    expect(logged).not.toContain(SECRET);
    warn.mockRestore();
  });

  it('keeps the address short and stores null when there is none', async () => {
    const { service, apiKey } = build();
    apiKey.findUnique.mockResolvedValue(live());
    await service.verify(SECRET, 'x'.repeat(200));
    await service.verify(SECRET);
    const data = apiKey.updateMany.mock.calls.map(
      (call) => ((call as unknown[])[0] as { data: { lastUsedIp: string | null } }).data.lastUsedIp,
    );
    expect(data).toEqual(['x'.repeat(64), null]);
  });

  it('rejects a key whose owner is not a valid Discord id', async () => {
    const { service, apiKey } = build();
    apiKey.findUnique.mockResolvedValue(live({ discordUserId: 'broken' }));
    await expect(service.verify(SECRET)).resolves.toBeNull();
  });
});

describe('ApiKeyService.revoke', () => {
  it('revokes, audits once and withdraws what the key scheduled', async () => {
    const { service, apiKey, audit, schedules } = build();
    await service.revoke(USER, KEY_ID, ACTOR);
    expect(apiKey.updateMany).toHaveBeenCalledWith({
      where: { id: KEY_ID, discordUserId: USER, revokedAt: null },
      data: { revokedAt: NOW },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'api_key.revoke', actor: ACTOR }),
      expect.anything(),
    );
    expect(schedules.cancelByApiKey).toHaveBeenCalledWith(KEY_ID, ACTOR);
  });

  it('is idempotent: a second revoke writes no audit row but still withdraws schedules', async () => {
    const { service, apiKey, audit, schedules } = build();
    apiKey.updateMany.mockResolvedValue({ count: 0 });
    apiKey.findFirst.mockResolvedValue(viewRow({ revokedAt: NOW }));
    await expect(service.revoke(USER, KEY_ID, ACTOR)).resolves.toMatchObject({ revokedAt: NOW });
    expect(audit.record).not.toHaveBeenCalled();
    expect(schedules.cancelByApiKey).toHaveBeenCalledTimes(1);
  });

  it('answers not found for a key of someone else or one that does not exist', async () => {
    const { service, apiKey, schedules } = build();
    apiKey.updateMany.mockResolvedValue({ count: 0 });
    apiKey.findFirst.mockResolvedValue(null);
    await expect(service.revoke(OTHER, KEY_ID, ACTOR)).rejects.toEqual(
      new ServiceError(ErrorCode.API_KEY_NOT_FOUND),
    );
    expect(apiKey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: KEY_ID, discordUserId: OTHER } }),
    );
    expect(schedules.cancelByApiKey).not.toHaveBeenCalled();
  });

  it('answers not found for an id that is not a uuid without touching the database', async () => {
    const { service, prisma } = build();
    await expect(service.revoke(USER, 'not-a-uuid', ACTOR)).rejects.toEqual(
      new ServiceError(ErrorCode.API_KEY_NOT_FOUND),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ApiKeyService.list', () => {
  it("lists only the person's keys with the listing columns", async () => {
    const { service, apiKey } = build();
    const views = await service.list(USER);
    expect(apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { discordUserId: USER } }),
    );
    expect(views).toHaveLength(1);
    expect(views[0]).not.toHaveProperty('keyHash');
    expect(views[0]).not.toHaveProperty('discordUserId');
  });
});
