import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService, sanitizeAuditParams } from './audit.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const ACTOR: ActorContext = { source: 'DISCORD', userId: USER };

function build() {
  const prisma = {
    guild: { findUnique: vi.fn().mockResolvedValue({ id: 'guild-uuid' }) },
    auditLog: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new AuditService(prisma as unknown as PrismaService) };
}

describe('sanitizeAuditParams', () => {
  it('keeps allowlisted keys and drops everything else, at every depth', () => {
    expect(
      sanitizeAuditParams({
        channelId: '123',
        content: 'a private message',
        token: 'secret',
        before: { logChannelId: null, password: 'hunter2' },
        after: { logChannelId: '456' },
      }),
    ).toEqual({
      channelId: '123',
      before: { logChannelId: null },
      after: { logChannelId: '456' },
    });
  });

  it('stores only plain values: no functions, symbols, bigint, undefined or non-finite numbers', () => {
    expect(
      sanitizeAuditParams({
        count: Number.POSITIVE_INFINITY,
        total: 3,
        failed: undefined,
        skipped: () => 1,
        mode: Symbol('x'),
        kind: 10n,
        locale: 'vi',
      }),
    ).toEqual({ total: 3, locale: 'vi' });
  });

  it('truncates long strings and caps arrays', () => {
    const clean = sanitizeAuditParams({
      emoji: 'x'.repeat(500),
      scopes: Array.from({ length: 80 }, (_, index) => `scope-${index}`),
    }) as { emoji: string; scopes: string[] };
    expect(clean.emoji).toHaveLength(200);
    expect(clean.scopes).toHaveLength(50);
  });

  it('keeps the note topic and drops note content', () => {
    expect(sanitizeAuditParams({ topic: 'Quy tắc', content: 'secret body' })).toEqual({
      topic: 'Quy tắc',
    });
  });

  it('does not follow nesting past the depth limit', () => {
    const deep = { before: { after: { before: { after: { before: { count: 1 } } } } } };
    expect(JSON.stringify(sanitizeAuditParams(deep))).not.toContain('count');
  });

  it('drops keys that only exist on the prototype chain of the input', () => {
    const inherited = Object.create({ channelId: '1' }) as Record<string, unknown>;
    inherited['count'] = 2;
    expect(sanitizeAuditParams(inherited)).toEqual({ count: 2 });
  });
});

describe('AuditService.record', () => {
  it('writes one row naming the actor and resolves the server key from its Discord id', async () => {
    const { prisma, service } = build();
    await service.record({
      guildId: GUILD,
      actor: { ...ACTOR, apiKeyId: '0198f2f0-0000-7000-8000-000000000000' },
      action: AUDIT_ACTIONS.guildConfigUpdate,
      params: { logChannelId: '1', content: 'dropped' },
    });
    expect(prisma.guild.findUnique).toHaveBeenCalledWith({
      where: { discordId: GUILD },
      select: { id: true },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        guildId: 'guild-uuid',
        source: 'DISCORD',
        actorDiscordId: USER,
        apiKeyId: '0198f2f0-0000-7000-8000-000000000000',
        action: 'guild_config.update',
        params: { logChannelId: '1' },
        ok: true,
        error: null,
      },
    });
  });

  it('writes through the given transaction and never through the shared client', async () => {
    const { prisma, service } = build();
    const tx = {
      guild: { findUnique: vi.fn().mockResolvedValue({ id: 'tx-guild' }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await service.record(
      { guildId: GUILD, actor: ACTOR, action: AUDIT_ACTIONS.guildConfigUpdate },
      tx as never,
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.guild.findUnique).not.toHaveBeenCalled();
  });

  it('records a global action and an unknown server without a server key', async () => {
    const { prisma, service } = build();
    await service.record({ actor: { source: 'SYSTEM' }, action: AUDIT_ACTIONS.apiKeyMint });
    expect(prisma.guild.findUnique).not.toHaveBeenCalled();
    expect(prisma.auditLog.create.mock.calls[0]?.[0]).toMatchObject({
      data: { guildId: null, actorDiscordId: null, apiKeyId: null, params: undefined },
    });

    prisma.guild.findUnique.mockResolvedValueOnce(null);
    await service.record({ guildId: GUILD, actor: ACTOR, action: AUDIT_ACTIONS.messageSend });
    expect(prisma.auditLog.create.mock.calls[1]?.[0]).toMatchObject({ data: { guildId: null } });
  });

  it('stores a failed attempt with a bounded error code', async () => {
    const { prisma, service } = build();
    await service.record({
      actor: ACTOR,
      action: AUDIT_ACTIONS.messageSend,
      ok: false,
      error: 'E'.repeat(500),
    });
    const data = (prisma.auditLog.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(data['ok']).toBe(false);
    expect(String(data['error'])).toHaveLength(200);
  });

  it('lets a failed write reach the caller so its transaction rolls back', async () => {
    const { prisma, service } = build();
    prisma.auditLog.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      service.record({ actor: ACTOR, action: AUDIT_ACTIONS.messageSend }),
    ).rejects.toThrow('connection lost');
  });
});

describe('AuditService.list', () => {
  const row = (id: string) => ({ id, action: 'x' });

  it('asks for one row more than the page to learn whether another page exists', async () => {
    const { prisma, service } = build();
    prisma.auditLog.findMany.mockResolvedValueOnce([row('c'), row('b'), row('a')]);
    const page = await service.list({ guildId: GUILD, limit: 2 });
    expect(prisma.auditLog.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { guild: { discordId: GUILD } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    expect(page.items.map((item) => item.id)).toEqual(['c', 'b']);
    expect(page.nextCursor).toBe('b');
  });

  it('has no next cursor on the last page', async () => {
    const { prisma, service } = build();
    prisma.auditLog.findMany.mockResolvedValueOnce([row('b'), row('a')]);
    await expect(service.list({ guildId: GUILD, limit: 2 })).resolves.toMatchObject({
      nextCursor: null,
    });
  });

  it('applies the cursor, action and since filters', async () => {
    const { prisma, service } = build();
    const since = new Date('2026-10-01T00:00:00Z');
    const cursor = '0198f2f0-0000-7000-8000-000000000001';
    await service.list({
      guildId: GUILD,
      cursor,
      action: AUDIT_ACTIONS.noteRemove,
      since,
    });
    expect(prisma.auditLog.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        guild: { discordId: GUILD },
        action: 'note.remove',
        createdAt: { gte: since },
      },
      cursor: { id: cursor },
      skip: 1,
      take: 51,
    });
  });

  it.each([
    ['a guild id that is not a snowflake', { guildId: 'abc' }],
    ['a limit of zero', { guildId: GUILD, limit: 0 }],
    ['a limit above the page maximum', { guildId: GUILD, limit: 101 }],
    ['a cursor that is not an id', { guildId: GUILD, cursor: "x' OR 1=1" }],
    ['an action nobody records', { guildId: GUILD, action: 'drop.table' as never }],
  ])('rejects %s without querying', async (_label, query) => {
    const { prisma, service } = build();
    await expect(service.list(query)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.list(query)).rejects.toBeInstanceOf(ServiceError);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('is built by the container from the Prisma service', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: {} }],
    }).compile();
    expect(moduleRef.get(AuditService)).toBeInstanceOf(AuditService);
    await moduleRef.close();
  });
});
