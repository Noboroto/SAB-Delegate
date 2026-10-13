import type { ActorContext } from '@sab/shared';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { GuildAccessService } from '../../common/guild-access/guild-access.service.js';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { ErrorReporter } from '../../discord/error-reporter.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { MessageResolver } from '../../discord/services/message-resolver.service.js';
import type { PgBossService } from '../../jobs/pg-boss.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { ScheduleDelivery } from './schedule.delivery.js';
import { ScheduleService } from './schedule.service.js';

// Built from counters: literal 18-digit ids trip the secret scanner.
let nextGuild = 100000000000000100n;
let nextChannel = 200000000000000100n;
let nextUser = 500000000000000100n;
let nextMessage = 700000000000000100n;
let nextUuid = 1;

/** A UUID-shaped value that names nothing: for columns the test only needs to be unique. */
const fakeUuid = (): string => `00000000-0000-7000-8000-${String(nextUuid++).padStart(12, '0')}`;

const newId = (counter: 'guild' | 'channel' | 'user' | 'message'): string => {
  switch (counter) {
    case 'guild':
      return String((nextGuild += 1n));
    case 'channel':
      return String((nextChannel += 1n));
    case 'user':
      return String((nextUser += 1n));
    case 'message':
      return String((nextMessage += 1n));
  }
};

const inOneHour = () => new Date(Date.now() + 3_600_000);
const anHourAgo = () => new Date(Date.now() - 3_600_000);

/**
 * Registers the Postgres-backed schedule fixture's hooks; call it inside a `describe`.
 * `prisma`, `audit` and `service` exist only after `beforeAll`, hence the getters.
 */
export function useScheduleDb() {
  let database: TestDatabase;
  let prisma: PrismaService;
  let audit: AuditService;
  let guilds: GuildConfigService;
  let service: ScheduleService;

  // What the fake Discord, queue and permission check saw and how they should misbehave.
  type Delivered = { channelId: string; payload: Record<string, unknown> };
  const delivered: Delivered[] = [];
  const attemptsAt = new Map<string, number>();
  const failures = new Map<string, Error[]>();
  const channelGuild = new Map<string, string>();
  const unsendable = new Set<string>();
  const sources = new Map<string, unknown>();
  const manage = new Map<string, boolean | Error>();
  const jobs = new Map<string, { data: unknown; startAfter: Date | undefined }>();
  const cancelledJobs = new Set<string>();
  const state = { hold: undefined as Promise<void> | undefined, queueDown: false };
  let messageCounter = 0;

  const report = vi.fn().mockResolvedValue(undefined);
  const canManage = vi.fn((user: string) => {
    const answer = manage.get(user);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer ?? true);
  });

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    audit = new AuditService(prisma);
    const access = { check: vi.fn().mockResolvedValue('ok') } as unknown as ChannelAccessService;
    guilds = new GuildConfigService(prisma, audit, access);

    const client = {
      channels: {
        fetch: (channelId: string) => {
          const guildId = channelGuild.get(channelId);
          if (guildId === undefined) return Promise.resolve(null);
          return Promise.resolve({
            id: channelId,
            guildId,
            isSendable: () => !unsendable.has(channelId),
            send: async (payload: Record<string, unknown>) => {
              attemptsAt.set(channelId, (attemptsAt.get(channelId) ?? 0) + 1);
              const held = state.hold;
              state.hold = undefined;
              const failure = failures.get(channelId)?.shift();
              if (failure !== undefined) throw failure;
              delivered.push({ channelId, payload });
              if (held !== undefined) await held;
              messageCounter += 1;
              return { id: `message-${messageCounter}` };
            },
          });
        },
      },
    };

    const resolver = {
      fetch: (input: string) => Promise.resolve(sources.get(input) ?? { status: 'NOT_FOUND' }),
    } as unknown as MessageResolver;

    const boss = {
      send: vi.fn((_queue: string, data: unknown, options: { id: string; startAfter?: Date }) => {
        if (state.queueDown) return Promise.reject(new Error('queue is down'));
        if (jobs.has(options.id)) return Promise.resolve(null);
        jobs.set(options.id, { data, startAfter: options.startAfter });
        return Promise.resolve(options.id);
      }),
      cancel: vi.fn((_queue: string, id: string) => {
        if (jobs.has(id) && !cancelledJobs.has(id)) {
          cancelledJobs.add(id);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }),
    } as unknown as PgBossService;

    const delivery = new ScheduleDelivery(
      prisma,
      audit,
      client as never,
      resolver,
      { canManage } as unknown as GuildAccessService,
      { report } as unknown as ErrorReporter,
    );
    service = new ScheduleService(
      prisma,
      audit,
      guilds,
      boss,
      client as never,
      access,
      resolver,
      delivery,
      { isStopping: () => false } as unknown as DiscordReadyService,
    );
  });

  beforeEach(() => {
    delivered.length = 0;
    attemptsAt.clear();
    failures.clear();
    unsendable.clear();
    sources.clear();
    manage.clear();
    jobs.clear();
    cancelledJobs.clear();
    state.hold = undefined;
    state.queueDown = false;
    report.mockClear();
    canManage.mockClear();
  });

  afterAll(async () => {
    await database.dispose();
  });

  /** A server with a channel the bot can post in, and a person who runs the commands. */
  function world() {
    const guildId = newId('guild');
    const channelId = newId('channel');
    channelGuild.set(channelId, guildId);
    const userId = newId('user');
    const slash: ActorContext = { source: 'DISCORD', userId };
    return { guildId, channelId, userId, slash };
  }

  /** A key row, because a scheduled message points at the key that made it. */
  async function mintKey(userId: string): Promise<string> {
    const key = await prisma.apiKey.create({
      data: {
        discordUserId: userId,
        name: 'test key',
        prefix: 'abcd1234',
        keyHash: `hash-${fakeUuid()}`,
        mode: 'WRITE',
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    return key.id;
  }

  async function apiFor(
    w: ReturnType<typeof world>,
    source: 'HTTP' | 'MCP' = 'HTTP',
  ): Promise<ActorContext> {
    return { source, userId: w.userId, apiKeyId: await mintKey(w.userId) };
  }

  const rowOf = (id: string) => prisma.scheduledMessage.findUniqueOrThrow({ where: { id } });

  const auditRows = (guildId: string, action: string) =>
    prisma.auditLog.findMany({
      where: { action, guild: { discordId: guildId } },
      orderBy: { createdAt: 'asc' },
    });

  /** A row written straight to the table, for states the service refuses to create (a moment in the past, a dead sender). */
  async function insertRow(
    guildId: string,
    channelId: string,
    userId: string,
    data: Partial<{
      kind: 'SEND' | 'COPY';
      content: string | null;
      sourceChannelId: string | null;
      sourceMessageId: string | null;
      runAt: Date;
      status: 'PENDING' | 'SENDING' | 'SENT' | 'CANCELED' | 'FAILED';
      leaseUntil: Date | null;
      attempts: number;
      pgBossJobId: string | null;
      source: 'DISCORD' | 'HTTP' | 'MCP' | 'SYSTEM';
      allowedMentions: object;
    }> = {},
  ) {
    const guild = await guilds.ensureGuild(guildId);
    const last = await prisma.scheduledMessage.aggregate({
      where: { guildId: guild.id },
      _max: { seq: true },
    });
    const kind = data.kind ?? 'SEND';
    return prisma.scheduledMessage.create({
      data: {
        guildId: guild.id,
        seq: (last._max.seq ?? 0) + 1,
        kind,
        channelId,
        content: kind === 'SEND' ? (data.content ?? 'scheduled text') : null,
        sourceChannelId: data.sourceChannelId ?? null,
        sourceMessageId: data.sourceMessageId ?? null,
        runAt: data.runAt ?? inOneHour(),
        status: data.status ?? 'PENDING',
        leaseUntil: data.leaseUntil ?? null,
        attempts: data.attempts ?? 0,
        pgBossJobId: data.pgBossJobId ?? null,
        source: data.source ?? 'DISCORD',
        createdByUserId: userId,
        ...(data.allowedMentions === undefined ? {} : { allowedMentions: data.allowedMentions }),
      },
    });
  }

  async function schedule(w: ReturnType<typeof world>, content = 'Hello', actor = w.slash) {
    const result = await service.scheduleSend(
      w.guildId,
      { channelId: w.channelId, content, runAt: inOneHour() },
      actor,
    );
    if (result.schedule === null) throw new Error('A real run must return its row');
    return { result, id: result.schedule.id };
  }

  function registerSource(
    w: ReturnType<typeof world>,
    message: { content: string; files?: unknown[]; guildId?: string | null },
  ) {
    const channelId = newId('channel');
    const messageId = newId('message');
    const key = `${channelId}/${messageId}`;
    const make = (override: { content?: string; files?: unknown[] } = {}) => ({
      status: 'OK',
      message: {
        id: messageId,
        channelId,
        guildId: message.guildId === undefined ? w.guildId : message.guildId,
        content: override.content ?? message.content,
        attachments: { values: () => override.files ?? message.files ?? [] },
      },
    });
    sources.set(key, make());
    return {
      key,
      channelId,
      messageId,
      edit: (content: string) => sources.set(key, make({ content })),
    };
  }

  return {
    get prisma() {
      return prisma;
    },
    get audit() {
      return audit;
    },
    get service() {
      return service;
    },
    delivered,
    attemptsAt,
    failures,
    channelGuild,
    unsendable,
    sources,
    manage,
    jobs,
    cancelledJobs,
    state,
    report,
    canManage,
    fakeUuid,
    newId,
    inOneHour,
    anHourAgo,
    world,
    mintKey,
    apiFor,
    rowOf,
    auditRows,
    insertRow,
    schedule,
    registerSource,
  };
}
