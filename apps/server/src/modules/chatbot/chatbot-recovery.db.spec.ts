import 'reflect-metadata';
import { CHATBOT_RECOVERY_MAX_AGE_MS } from '@sab/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotRecoveryService } from './chatbot-recovery.service.js';
import type { ChatbotListener } from './chatbot.listener.js';

const USER = '440000000000003001';
const MINUTE_MS = 60_000;
/** Quiet for longer than recovery's grace for turns still in the old process's hands. */
const IDLE_MS = 5 * MINUTE_MS;

describe('chatbot recovery against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let guilds: GuildConfigService;
  let quota: ChatbotQuotaService;
  let history: ChatbotHistoryService;
  let enabled: boolean;
  let nextGuild = 160000000000003000n;
  let nextMessage = 360000000000003000n;
  let nextChannel = 260000000000003000n;

  const enqueue = vi.fn((_message: unknown) => Promise.resolve(true));
  const newGuild = () => String((nextGuild += 1n));
  const newMessage = () => String((nextMessage += 1n));
  const newChannel = () => String((nextChannel += 1n));

  /** A recovery service as a fresh process would build it: everything below is older than it. */
  const boot = () =>
    new ChatbotRecoveryService(
      history,
      quota,
      {
        routeOf: vi.fn(() => Promise.resolve(enabled ? { enabled: true } : null)),
      } as unknown as ChatbotConfigService,
      { enqueue } as unknown as ChatbotListener,
      { isStopping: () => false } as unknown as DiscordReadyService,
      {
        user: { id: '940000000000003001' },
        channels: {
          fetch: vi.fn(() =>
            Promise.resolve({
              isThread: () => false,
              messages: {
                fetch: (arg: string | object) =>
                  Promise.resolve(typeof arg === 'string' ? { id: arg } : { values: () => [] }),
              },
            }),
          ),
        },
      } as unknown as ConstructorParameters<typeof ChatbotRecoveryService>[5],
    );

  /**
   * A pending turn taken in `ageMs` ago and idle since, optionally holding
   * tokens it reserved. Both clocks are set: any update resets `updatedAt`.
   */
  const pending = async (guildId: string, ageMs: number, hold = 0, idleMs = IDLE_MS) => {
    const triggerMessageId = newMessage();
    await history.claimPending({
      guildId,
      channelId: newChannel(),
      userId: USER,
      triggerMessageId,
      question: 'câu hỏi',
    });
    if (hold > 0) {
      const reserved = await quota.reserveForTurn(guildId, USER, hold, triggerMessageId);
      if ('exhausted' in reserved || !reserved.durable) throw new Error('the hold was not kept');
    }
    await age(triggerMessageId, ageMs, idleMs);
    return { triggerMessageId };
  };
  const age = (triggerMessageId: string, ageMs: number, idleMs = ageMs) =>
    prisma.chatbotTurn.update({
      where: { triggerMessageId },
      data: {
        createdAt: new Date(Date.now() - ageMs),
        updatedAt: new Date(Date.now() - idleMs),
      },
    });
  const statusOf = async (triggerMessageId: string) =>
    (await prisma.chatbotTurn.findUniqueOrThrow({ where: { triggerMessageId } })).status;

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    guilds = new GuildConfigService(prisma, audit, {
      check: vi.fn().mockResolvedValue('ok'),
    } as unknown as ChannelAccessService);
    quota = new ChatbotQuotaService(prisma, audit, guilds);
    history = new ChatbotHistoryService(prisma, audit, guilds);
  });

  // A sweep reads every pending turn of the schema, so each test starts with none.
  beforeEach(async () => {
    await prisma.chatbotTurn.deleteMany();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('refunds a hold once even when two sweeps run at the same time', async () => {
    enabled = true;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const cut = await pending(guild, MINUTE_MS, 500);
    // Another reply of the same member, still running, must keep its hold.
    const live = await quota.reserve(guild, USER, 300);
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 800 });

    await Promise.all([boot().sweep(), boot().sweep()]);
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 300 });
    expect(live).toMatchObject({ reserved: 300 });
    const row = await prisma.chatbotTurn.findUniqueOrThrow({
      where: { triggerMessageId: cut.triggerMessageId },
    });
    expect(row.reservedTokens).toBe(0);

    await boot().sweep();
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 300 });
  });

  it('replays a turn at the age limit through the listener and closes one a millisecond older', async () => {
    enabled = true;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const atLimit = await pending(guild, MINUTE_MS);
    const past = await pending(guild, MINUTE_MS);
    const now = new Date();
    for (const [trigger, extra] of [
      [atLimit.triggerMessageId, 0],
      [past.triggerMessageId, 1],
    ] as const) {
      const at = new Date(now.getTime() - CHATBOT_RECOVERY_MAX_AGE_MS - extra);
      await prisma.chatbotTurn.update({
        where: { triggerMessageId: trigger },
        data: { createdAt: at, updatedAt: at },
      });
    }
    enqueue.mockClear();

    await boot().sweep(now);
    const replayed = enqueue.mock.calls.map(([message]) => (message as { id: string }).id);
    expect(replayed).toContain(atLimit.triggerMessageId);
    expect(replayed).not.toContain(past.triggerMessageId);
    // A replayed turn stays pending: finishing it is the pipeline's job.
    expect(await statusOf(atLimit.triggerMessageId)).toBe('PENDING');
    expect(await statusOf(past.triggerMessageId)).toBe('EXPIRED');
  });

  it('closes a turn whose channel is no longer a chatbot channel, and refunds it', async () => {
    enabled = false;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const cut = await pending(guild, MINUTE_MS, 400);
    enqueue.mockClear();

    await boot().sweep();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await statusOf(cut.triggerMessageId)).toBe('EXPIRED');
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 0 });
    enabled = true;
  });

  it('closes an old turn without a reply and gives back its hold', async () => {
    enabled = true;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const old = await pending(guild, 2 * 60 * MINUTE_MS, 250);
    enqueue.mockClear();

    await boot().sweep();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await statusOf(old.triggerMessageId)).toBe('EXPIRED');
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 0 });
  });

  it('closes a turn that already has a reply without answering it again', async () => {
    enabled = true;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const sent = await pending(guild, MINUTE_MS);
    await history.markReplied(sent.triggerMessageId, newMessage());
    // Writing the reply id counts as activity; the turn has been quiet since.
    await age(sent.triggerMessageId, MINUTE_MS, IDLE_MS);
    enqueue.mockClear();

    await boot().sweep();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await statusOf(sent.triggerMessageId)).toBe('EXPIRED');
  });

  it('leaves a turn touched a moment ago to the process that may still be answering it', async () => {
    enabled = true;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const busy = await pending(guild, 2 * MINUTE_MS, 100, 10_000);
    enqueue.mockClear();

    await boot().sweep();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await statusOf(busy.triggerMessageId)).toBe('PENDING');
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 100 });

    // Once it has been quiet for the grace, a later sweep takes it up.
    await age(busy.triggerMessageId, 2 * MINUTE_MS, IDLE_MS);
    await boot().sweep();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 0 });
  });

  it('goes through more turns than one page holds, closing the ones it reads', async () => {
    enabled = true;
    const guild = newGuild();
    const key = (await guilds.ensureGuild(guild)).id;
    const old = new Date(Date.now() - 3_600_000);
    const ids = Array.from({ length: 120 }, () => newMessage());
    await prisma.chatbotTurn.createMany({
      data: ids.map((triggerMessageId, index) => ({
        guildId: key,
        channelId: newChannel(),
        userId: USER,
        triggerMessageId,
        status: 'PENDING' as const,
        question: 'q',
        context: { system: '' },
        // Many share one timestamp, so the id has to carry the page position.
        createdAt: new Date(old.getTime() + Math.floor(index / 10)),
        updatedAt: old,
      })),
    });

    await boot().sweep();
    expect(await prisma.chatbotTurn.count({ where: { status: 'PENDING' } })).toBe(0);
    expect(await prisma.chatbotTurn.count({ where: { status: 'EXPIRED' } })).toBe(120);
  });

  it('leaves turns taken in after this process started to their own pipeline', async () => {
    enabled = true;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const recovery = boot();
    const live = await pending(guild, 0, 100);
    await prisma.chatbotTurn.update({
      where: { triggerMessageId: live.triggerMessageId },
      data: { createdAt: new Date(Date.now() + 5_000) },
    });
    enqueue.mockClear();

    await recovery.sweep();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await statusOf(live.triggerMessageId)).toBe('PENDING');
    expect(await quota.limitOf(guild, USER)).toMatchObject({ used: 100 });
  });

  it('does not touch a turn that is already finished', async () => {
    enabled = true;
    const guild = newGuild();
    await guilds.ensureGuild(guild);
    const done = await pending(guild, MINUTE_MS);
    await prisma.chatbotTurn.update({
      where: { triggerMessageId: done.triggerMessageId },
      data: { status: 'FAILED' },
    });
    enqueue.mockClear();

    await boot().sweep();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await statusOf(done.triggerMessageId)).toBe('FAILED');
  });
});
