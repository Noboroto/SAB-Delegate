import { randomBytes } from 'node:crypto';
import { AUDIT_ACTIONS, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { AuditService } from './audit.service.js';

// Fixture secrets are built at run time: a literal next to a key like
// `password` or `token` reads as a leaked credential to secret scanners.
const fixtureSecret = (): string => `fx-${randomBytes(6).toString('hex')}`;

const GUILD = '100000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };

describe('AuditService against Postgres', () => {
  let database: TestDatabase;
  let service: AuditService;

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    service = new AuditService(database.prisma as unknown as PrismaService);
    await database.prisma.guild.create({ data: { discordId: GUILD, name: 'Test guild' } });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('leaves no row behind when the surrounding transaction rolls back', async () => {
    const before = await database.prisma.auditLog.count();
    await expect(
      database.prisma.$transaction(async (tx) => {
        await service.record(
          { guildId: GUILD, actor: ACTOR, action: AUDIT_ACTIONS.guildConfigUpdate },
          tx,
        );
        throw new Error('the change itself failed');
      }),
    ).rejects.toThrow('the change itself failed');
    await expect(database.prisma.auditLog.count()).resolves.toBe(before);
  });

  it('commits the row together with the transaction and stores only allowlisted params', async () => {
    await database.prisma.$transaction(async (tx) => {
      await service.record(
        {
          guildId: GUILD,
          actor: ACTOR,
          action: AUDIT_ACTIONS.messageSend,
          params: {
            channelId: '300000000000000001',
            content: 'text that must not be stored',
            apiKey: fixtureSecret(),
            before: { logChannelId: null, token: fixtureSecret() },
          },
        },
        tx,
      );
    });
    const row = await database.prisma.auditLog.findFirstOrThrow({
      where: { action: 'message.send' },
    });
    expect(row.params).toEqual({
      channelId: '300000000000000001',
      before: { logChannelId: null },
    });
    expect(row).toMatchObject({
      source: 'DISCORD',
      actorDiscordId: ACTOR.userId,
      ok: true,
      error: null,
    });
    const guild = await database.prisma.guild.findUniqueOrThrow({ where: { discordId: GUILD } });
    expect(row.guildId).toBe(guild.id);
  });

  it('keeps a row of a global action without a server', async () => {
    await service.record({ actor: { source: 'SYSTEM' }, action: AUDIT_ACTIONS.apiKeyRevoke });
    const row = await database.prisma.auditLog.findFirstOrThrow({
      where: { action: 'api_key.revoke' },
    });
    expect(row).toMatchObject({ guildId: null, actorDiscordId: null, source: 'SYSTEM' });
  });

  it('lists newest first, pages by cursor without repeats, and filters by action and time', async () => {
    for (let index = 0; index < 5; index += 1) {
      await service.record({
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.noteUpsert,
        params: { count: index },
      });
    }

    const first = await service.list({
      guildId: GUILD,
      limit: 3,
      action: AUDIT_ACTIONS.noteUpsert,
    });
    expect(first.items.map((item) => item.params)).toEqual([
      { count: 4 },
      { count: 3 },
      { count: 2 },
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.list({
      guildId: GUILD,
      limit: 3,
      action: AUDIT_ACTIONS.noteUpsert,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });
    expect(second.items.map((item) => item.params)).toEqual([{ count: 1 }, { count: 0 }]);
    expect(second.nextCursor).toBeNull();

    const none = await service.list({
      guildId: GUILD,
      since: new Date(Date.now() + 60_000),
    });
    expect(none.items).toEqual([]);
  });

  it('filters by the source of the change', async () => {
    await service.record({
      guildId: GUILD,
      actor: { source: 'MCP', userId: '100000000000000002' },
      action: AUDIT_ACTIONS.noteRemove,
    });
    const mcp = await service.list({ guildId: GUILD, source: 'MCP' });
    expect(mcp.items).toHaveLength(1);
    expect(mcp.items[0]).toMatchObject({ source: 'MCP', action: 'note.remove' });
    const system = await service.list({ guildId: GUILD, source: 'SYSTEM' });
    expect(system.items).toEqual([]);
  });

  it('shows a server only its own rows', async () => {
    const other = await service.list({ guildId: '100000000000000099' });
    expect(other.items).toEqual([]);
  });

  it('does not expose the internal server key', async () => {
    const page = await service.list({ guildId: GUILD, limit: 1 });
    expect(Object.keys(page.items[0] ?? {})).not.toContain('guildId');
  });
});
