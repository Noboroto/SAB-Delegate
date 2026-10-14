import { createHash } from 'node:crypto';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PgBossService } from '../../jobs/pg-boss.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';
import { ApiKeyService } from './api-key.service.js';

// Built from counters: literal 18-digit ids trip the secret scanner.
let nextUser = 500000000000002000n;
let nextGuild = 100000000000002000n;
const newUser = () => String((nextUser += 1n));
const newGuild = () => String((nextGuild += 1n));
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('ApiKeyService against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let service: ApiKeyService;
  let guilds: GuildConfigService;
  const cancelledJobs: string[] = [];

  const actorOf = (userId: string): ActorContext => ({ source: 'HTTP', userId });
  const mint = (userId: string, mode: 'READ' | 'WRITE' = 'READ', name = 'agent') =>
    service.mint(userId, { name, mode }, actorOf(userId));
  const keyRow = (id: string) => prisma.apiKey.findUniqueOrThrow({ where: { id } });
  const activeCount = (userId: string) =>
    prisma.apiKey.count({ where: { discordUserId: userId, revokedAt: null } });

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const access = { check: vi.fn().mockResolvedValue('ok') } as unknown as ChannelAccessService;
    guilds = new GuildConfigService(prisma, audit, access);
    // Revoking only reaches the database, the audit trail and the job queue; the
    // Discord-facing collaborators are not touched on that path.
    const boss = {
      cancel: vi.fn((_queue: string, id: string) => {
        cancelledJobs.push(id);
        return Promise.resolve(1);
      }),
    } as unknown as PgBossService;
    const schedules = new ScheduleService(
      prisma,
      audit,
      guilds,
      boss,
      {} as never,
      access,
      {} as never,
      {} as never,
      {} as never,
    );
    service = new ApiKeyService(prisma, audit, schedules);
  });

  afterAll(async () => {
    await database.dispose();
  });

  describe('mint', () => {
    it('keeps the hash and the prefix and never the secret', async () => {
      const user = newUser();
      const minted = await mint(user);
      const row = await keyRow(minted.id);

      expect(row.keyHash).toBe(sha256(minted.plaintext));
      expect(row.prefix).toBe(minted.plaintext.slice(0, 8));
      expect(JSON.stringify(row)).not.toContain(minted.plaintext);
      const audits = await prisma.auditLog.findMany({ where: { actorDiscordId: user } });
      expect(audits.map((entry) => entry.action)).toEqual([AUDIT_ACTIONS.apiKeyMint]);
      expect(JSON.stringify(audits)).not.toContain(minted.plaintext);
      expect(JSON.stringify(audits)).not.toContain(row.keyHash);
    });

    it('accepts a write key at the longest lifetime the table allows', async () => {
      const user = newUser();
      const minted = await service.mint(
        user,
        { name: 'w', mode: 'WRITE', expiresInDays: 30 },
        actorOf(user),
      );
      const row = await keyRow(minted.id);
      expect(row.expiresAt!.getTime() - row.createdAt.getTime()).toBe(30 * 86_400_000);
    });

    it('allows five active keys and refuses the sixth', async () => {
      const user = newUser();
      for (let i = 0; i < 5; i += 1) await mint(user, 'READ', `key ${i}`);
      await expect(mint(user)).rejects.toEqual(new ServiceError(ErrorCode.API_KEY_LIMIT_REACHED));
      await expect(activeCount(user)).resolves.toBe(5);
    });

    it('never exceeds five when many mints run at once', async () => {
      const user = newUser();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, (_unused, i) => mint(user, 'READ', `race ${i}`)),
      );
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(5);
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(refused).toHaveLength(3);
      for (const outcome of refused) {
        expect(outcome.reason).toEqual(new ServiceError(ErrorCode.API_KEY_LIMIT_REACHED));
      }
      await expect(activeCount(user)).resolves.toBe(5);
    });

    it('counts per person, and not a revoked or an expired key', async () => {
      const user = newUser();
      const other = newUser();
      const first = await mint(user);
      for (let i = 0; i < 3; i += 1) await mint(user);
      const expiring = await mint(user);
      await prisma.apiKey.update({
        where: { id: expiring.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      // Four live keys and one expired: room for one more.
      await mint(user);
      await expect(mint(user)).rejects.toMatchObject({ code: ErrorCode.API_KEY_LIMIT_REACHED });
      await service.revoke(user, first.id, actorOf(user));
      await expect(mint(user)).resolves.toMatchObject({ mode: 'READ' });
      await expect(mint(other)).resolves.toMatchObject({ mode: 'READ' });
    });
  });

  describe('verify', () => {
    it('resolves a live key to its principal and records the use once a minute', async () => {
      const user = newUser();
      const minted = await mint(user, 'WRITE');
      await expect(service.verify(minted.plaintext, '203.0.113.7')).resolves.toEqual({
        discordUserId: user,
        apiKeyId: minted.id,
        mode: 'WRITE',
      });
      const first = await keyRow(minted.id);
      expect(first.lastUsedAt).not.toBeNull();
      expect(first.lastUsedIp).toBe('203.0.113.7');

      await service.verify(minted.plaintext, '198.51.100.9');
      const second = await keyRow(minted.id);
      expect(second.lastUsedAt).toEqual(first.lastUsedAt);
      expect(second.lastUsedIp).toBe('203.0.113.7');

      await prisma.apiKey.update({
        where: { id: minted.id },
        data: { lastUsedAt: new Date(Date.now() - 120_000) },
      });
      await service.verify(minted.plaintext, '198.51.100.9');
      const third = await keyRow(minted.id);
      expect(third.lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(third.lastUsedIp).toBe('198.51.100.9');
    });

    it('rejects an unknown, a revoked and an expired key', async () => {
      const user = newUser();
      await expect(service.verify(`sab_${'Z'.repeat(43)}`)).resolves.toBeNull();

      const revoked = await mint(user);
      await service.revoke(user, revoked.id, actorOf(user));
      await expect(service.verify(revoked.plaintext)).resolves.toBeNull();

      const expired = await mint(user);
      await prisma.apiKey.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(service.verify(expired.plaintext)).resolves.toBeNull();
    });
  });

  describe('revoke', () => {
    it('sets the time once, audits once and can be repeated', async () => {
      const user = newUser();
      const minted = await mint(user);
      const first = await service.revoke(user, minted.id, actorOf(user));
      const again = await service.revoke(user, minted.id, actorOf(user));
      expect(again.revokedAt).toEqual(first.revokedAt);
      const audits = await prisma.auditLog.findMany({
        where: { actorDiscordId: user, action: AUDIT_ACTIONS.apiKeyRevoke },
      });
      expect(audits).toHaveLength(1);
    });

    it('does not find the key of another person', async () => {
      const owner = newUser();
      const minted = await mint(owner);
      await expect(service.revoke(newUser(), minted.id, actorOf(owner))).rejects.toEqual(
        new ServiceError(ErrorCode.API_KEY_NOT_FOUND),
      );
      expect((await keyRow(minted.id)).revokedAt).toBeNull();
    });

    it('cancels what the key scheduled and leaves every other schedule alone', async () => {
      const user = newUser();
      const mine = await mint(user, 'WRITE');
      const theirs = await mint(user, 'WRITE');
      const guild = await guilds.ensureGuild(newGuild());
      let seq = 0;
      const schedule = (apiKeyId: string | null) => {
        seq += 1;
        return prisma.scheduledMessage.create({
          data: {
            guildId: guild.id,
            seq,
            kind: 'SEND',
            channelId: '200000000000002000',
            content: 'later',
            runAt: new Date(Date.now() + 3_600_000),
            status: 'PENDING',
            source: 'MCP',
            createdByUserId: user,
            apiKeyId,
          },
        });
      };
      const own = await schedule(mine.id);
      const sent = await prisma.scheduledMessage.update({
        where: { id: (await schedule(mine.id)).id },
        data: { status: 'SENT' },
      });
      const other = await schedule(theirs.id);
      const manual = await schedule(null);

      await service.revoke(user, mine.id, actorOf(user));

      const statusOf = async (id: string) =>
        (await prisma.scheduledMessage.findUniqueOrThrow({ where: { id } })).status;
      await expect(statusOf(own.id)).resolves.toBe('CANCELED');
      await expect(statusOf(sent.id)).resolves.toBe('SENT');
      await expect(statusOf(other.id)).resolves.toBe('PENDING');
      await expect(statusOf(manual.id)).resolves.toBe('PENDING');
      expect(cancelledJobs).toContain(own.id);
      expect(cancelledJobs).not.toContain(other.id);
    });
  });

  describe('list', () => {
    it("lists only the person's keys, newest first, revoked ones included", async () => {
      const user = newUser();
      const older = await mint(user, 'READ', 'older');
      const newer = await mint(user, 'READ', 'newer');
      await mint(newUser());
      await service.revoke(user, older.id, actorOf(user));
      const views = await service.list(user);
      expect(views.map((view) => view.id)).toEqual([newer.id, older.id]);
      expect(views[1]?.revokedAt).not.toBeNull();
      for (const view of views) expect(view).not.toHaveProperty('keyHash');
    });
  });
});
