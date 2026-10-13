import {
  ALLOWED_MENTIONS_ALL,
  ALLOWED_MENTIONS_NONE,
  ErrorCode,
  type ActorContext,
} from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { MessageResolver } from '../../discord/services/message-resolver.service.js';
import type { PgBossService } from '../../jobs/pg-boss.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import type { ScheduleDelivery } from './schedule.delivery.js';
import { ScheduleService } from './schedule.service.js';

// Built at runtime: literal 18-digit ids trip the secret scanner.
const GUILD = '1'.repeat(18);
const OTHER_GUILD = '9'.repeat(18);
const CHANNEL = '2'.repeat(18);
const SOURCE_CHANNEL = '3'.repeat(18);
const SOURCE_MESSAGE = '4'.repeat(18);
const USER = '5'.repeat(18);

const SLASH: ActorContext = { source: 'DISCORD', userId: USER };
const API: ActorContext = {
  source: 'HTTP',
  userId: USER,
  apiKeyId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
};

const inOneHour = () => new Date(Date.now() + 3_600_000);

/** Any use of the database, the queue or the audit trail fails the test: these paths must not reach them. */
function forbidden(name: string): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`${name}.${String(property)} must not be used here`);
      },
    },
  );
}

type SourceMessage = {
  id: string;
  channelId: string;
  guildId: string | null;
  content: string;
  attachments: { values(): Iterable<{ name: string }> };
};

function sourceMessage(overrides: Partial<SourceMessage> = {}): SourceMessage {
  return {
    id: SOURCE_MESSAGE,
    channelId: SOURCE_CHANNEL,
    guildId: GUILD,
    content: 'Original text',
    attachments: { values: () => [] },
    ...overrides,
  };
}

function build(options: { prisma?: unknown; channelGuild?: string | null; access?: string } = {}) {
  const channels = { check: vi.fn().mockResolvedValue(options.access ?? 'ok') };
  const client = {
    channels: {
      fetch: vi
        .fn()
        .mockResolvedValue(
          options.channelGuild === null ? null : { guildId: options.channelGuild ?? GUILD },
        ),
    },
  };
  const resolver = {
    fetch: vi.fn().mockResolvedValue({ status: 'OK', message: sourceMessage() }),
  };
  const delivery = { run: vi.fn().mockResolvedValue(true) };
  const service = new ScheduleService(
    (options.prisma ?? forbidden('prisma')) as PrismaService,
    forbidden('audit') as AuditService,
    forbidden('guilds') as GuildConfigService,
    forbidden('boss') as PgBossService,
    client as never,
    channels as unknown as ChannelAccessService,
    resolver as unknown as MessageResolver,
    delivery as unknown as ScheduleDelivery,
    { isStopping: () => false } as unknown as DiscordReadyService,
  );
  return { service, channels, client, resolver, delivery };
}

const refusal = (code: ErrorCode, params?: Record<string, string | number>): unknown =>
  expect.objectContaining({ name: 'ServiceError', code, ...(params ? { params } : {}) });

describe('ScheduleService.scheduleSend', () => {
  const input = () => ({ channelId: CHANNEL, content: 'Hello', runAt: inOneHour() });

  it('with dryRun reports the message as it would be stored and touches nothing', async () => {
    const { service } = build();
    const runAt = inOneHour();
    const result = await service.scheduleSend(
      GUILD,
      { channelId: CHANNEL, content: 'Hello @everyone', runAt },
      SLASH,
      { dryRun: true },
    );
    expect(result).toEqual({
      dryRun: true,
      kind: 'SEND',
      channelId: CHANNEL,
      runAt,
      content: 'Hello @everyone',
      attachmentCount: 0,
      allowedMentions: ALLOWED_MENTIONS_ALL,
      schedule: null,
    });
  });

  it('reads runAt as an ISO string with an offset', async () => {
    const { service } = build();
    const future = new Date(Date.now() + 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${future.getUTCFullYear()}-${pad(future.getUTCMonth() + 1)}-${pad(future.getUTCDate())}T${pad(future.getUTCHours())}:${pad(future.getUTCMinutes())}:00Z`;
    const result = await service.scheduleSend(GUILD, { ...input(), runAt: iso }, API, {
      dryRun: true,
    });
    expect(result.runAt.toISOString()).toBe(iso.replace(':00Z', ':00.000Z'));
  });

  it('keeps the old behaviour for a slash command and notifies nobody for the API', async () => {
    const { service } = build();
    const asked = { parse: ['everyone'] as const };
    const dry = { dryRun: true };

    const slash = await service.scheduleSend(GUILD, input(), SLASH, dry);
    expect(slash.allowedMentions).toEqual(ALLOWED_MENTIONS_ALL);

    const slashNarrowed = await service.scheduleSend(
      GUILD,
      { ...input(), allowedMentions: { parse: [] } },
      SLASH,
      dry,
    );
    expect(slashNarrowed.allowedMentions).toEqual(ALLOWED_MENTIONS_NONE);

    // An API key asking for more than nothing does not get it.
    for (const actor of [API, { ...API, source: 'MCP' as const }]) {
      const result = await service.scheduleSend(
        GUILD,
        { ...input(), content: '@everyone <@&123456789012345678>', allowedMentions: asked },
        actor,
        dry,
      );
      expect(result.allowedMentions).toEqual(ALLOWED_MENTIONS_NONE);
    }
  });

  it('refuses a moment that is not in the future', async () => {
    const { service } = build();
    for (const runAt of [new Date(Date.now() - 1000), new Date()]) {
      await expect(
        service.scheduleSend(GUILD, { ...input(), runAt }, SLASH, { dryRun: true }),
      ).rejects.toEqual(refusal(ErrorCode.VALIDATION_FAILED, { reason: 'PAST' }));
    }
  });

  it('refuses input that is not valid before looking at Discord', async () => {
    const { service, channels } = build();
    const bad: unknown[] = [
      { ...input(), content: '   ' },
      { ...input(), content: 'x'.repeat(2001) },
      { ...input(), channelId: '<#123>' },
      { ...input(), runAt: 'tomorrow' },
      { channelId: CHANNEL, content: 'x' },
      null,
    ];
    for (const value of bad) {
      await expect(service.scheduleSend(GUILD, value, SLASH, { dryRun: true })).rejects.toEqual(
        refusal(ErrorCode.VALIDATION_FAILED),
      );
    }
    await expect(
      service.scheduleSend('not-a-guild', input(), SLASH, { dryRun: true }),
    ).rejects.toEqual(refusal(ErrorCode.VALIDATION_FAILED));
    expect(channels.check).not.toHaveBeenCalled();
  });

  it('refuses a channel of another server as if it did not exist', async () => {
    const { service } = build({ channelGuild: OTHER_GUILD });
    await expect(service.scheduleSend(GUILD, input(), API, { dryRun: true })).rejects.toEqual(
      refusal(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
  });

  it('refuses a channel the bot cannot find, or cannot post in', async () => {
    await expect(
      build({ access: 'not-found' }).service.scheduleSend(GUILD, input(), SLASH, { dryRun: true }),
    ).rejects.toEqual(refusal(ErrorCode.DISCORD_CHANNEL_NOT_FOUND));
    await expect(
      build({ access: 'missing-permissions' }).service.scheduleSend(GUILD, input(), SLASH, {
        dryRun: true,
      }),
    ).rejects.toEqual(refusal(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' }));
    await expect(
      build({ channelGuild: null }).service.scheduleSend(GUILD, input(), SLASH, { dryRun: true }),
    ).rejects.toEqual(refusal(ErrorCode.DISCORD_CHANNEL_NOT_FOUND));
  });

  it('refuses to create without a person to answer for it', async () => {
    const { service } = build();
    await expect(service.scheduleSend(GUILD, input(), { source: 'SYSTEM' })).rejects.toEqual(
      refusal(ErrorCode.VALIDATION_FAILED),
    );
  });
});

describe('ScheduleService.scheduleCopy', () => {
  const input = () => ({
    channelId: CHANNEL,
    source: `https://discord.com/channels/${GUILD}/${SOURCE_CHANNEL}/${SOURCE_MESSAGE}`,
    runAt: inOneHour(),
  });
  const dry = { dryRun: true };

  it('with dryRun shows the source as it is now and touches nothing', async () => {
    const { service, resolver } = build();
    const result = await service.scheduleCopy(
      GUILD,
      { ...input(), sourceChannelId: SOURCE_CHANNEL },
      SLASH,
      dry,
    );
    expect(result).toMatchObject({
      dryRun: true,
      kind: 'COPY',
      channelId: CHANNEL,
      content: 'Original text',
      attachmentCount: 0,
      schedule: null,
    });
    expect(resolver.fetch).toHaveBeenCalledWith(input().source, { channelId: SOURCE_CHANNEL });
  });

  it('copies a message that has only files', async () => {
    const { service, resolver } = build();
    resolver.fetch.mockResolvedValue({
      status: 'OK',
      message: sourceMessage({
        content: '',
        attachments: { values: () => [{ name: 'a.png' }, { name: 'b.png' }] },
      }),
    });
    const result = await service.scheduleCopy(GUILD, input(), SLASH, dry);
    expect(result).toMatchObject({ content: null, attachmentCount: 2 });
  });

  it('refuses a source with neither text nor files', async () => {
    const { service, resolver } = build();
    resolver.fetch.mockResolvedValue({
      status: 'OK',
      message: sourceMessage({ content: '' }),
    });
    await expect(service.scheduleCopy(GUILD, input(), SLASH, dry)).rejects.toEqual(
      refusal(ErrorCode.VALIDATION_FAILED, { reason: 'EMPTY_SOURCE' }),
    );
  });

  it('follows a link into another server for a slash command only', async () => {
    const { service, resolver } = build();
    resolver.fetch.mockResolvedValue({
      status: 'OK',
      message: sourceMessage({ guildId: OTHER_GUILD }),
    });
    await expect(service.scheduleCopy(GUILD, input(), SLASH, dry)).resolves.toMatchObject({
      kind: 'COPY',
    });
    for (const actor of [API, { ...API, source: 'MCP' as const }]) {
      await expect(service.scheduleCopy(GUILD, input(), actor, dry)).rejects.toEqual(
        refusal(ErrorCode.DISCORD_MESSAGE_NOT_FOUND),
      );
    }
  });

  it('refuses a message from a direct message for the API', async () => {
    const { service, resolver } = build();
    resolver.fetch.mockResolvedValue({
      status: 'OK',
      message: sourceMessage({ guildId: null }),
    });
    await expect(service.scheduleCopy(GUILD, input(), API, dry)).rejects.toEqual(
      refusal(ErrorCode.DISCORD_MESSAGE_NOT_FOUND),
    );
  });

  it('tells apart a link that cannot be read, a message that is gone, and one the bot cannot see', async () => {
    const { service, resolver } = build();
    resolver.fetch.mockResolvedValueOnce({ status: 'INVALID_LINK', reason: 'MALFORMED' });
    await expect(service.scheduleCopy(GUILD, input(), SLASH, dry)).rejects.toEqual(
      refusal(ErrorCode.VALIDATION_FAILED, { reason: 'MALFORMED' }),
    );
    resolver.fetch.mockResolvedValueOnce({ status: 'NOT_FOUND' });
    await expect(service.scheduleCopy(GUILD, input(), SLASH, dry)).rejects.toEqual(
      refusal(ErrorCode.DISCORD_MESSAGE_NOT_FOUND),
    );
    resolver.fetch.mockResolvedValueOnce({ status: 'NO_ACCESS' });
    await expect(service.scheduleCopy(GUILD, input(), SLASH, dry)).rejects.toEqual(
      refusal(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'view' }),
    );
  });

  it('checks the destination before reading the source', async () => {
    const { service, resolver } = build({ access: 'missing-permissions' });
    await expect(service.scheduleCopy(GUILD, input(), SLASH, dry)).rejects.toEqual(
      refusal(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' }),
    );
    expect(resolver.fetch).not.toHaveBeenCalled();
  });

  it('refuses a destination of another server', async () => {
    const { service } = build({ channelGuild: OTHER_GUILD });
    await expect(service.scheduleCopy(GUILD, input(), API, dry)).rejects.toEqual(
      refusal(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
  });
});

describe('ScheduleService.cancel', () => {
  function withRow(row: { id: string; status: string; kind?: string; channelId?: string } | null) {
    const prisma = {
      scheduledMessage: { findFirst: vi.fn().mockResolvedValue(row) },
    };
    return { ...build({ prisma }), prisma };
  }
  const row = (status: string) => ({
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    status,
    kind: 'SEND',
    channelId: CHANNEL,
  });

  it('refuses a number that cannot be one', async () => {
    const { service } = build();
    for (const seq of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
      await expect(service.cancel(GUILD, seq, SLASH)).rejects.toEqual(
        refusal(ErrorCode.VALIDATION_FAILED),
      );
    }
    await expect(service.cancel('nope', 1, SLASH)).rejects.toEqual(
      refusal(ErrorCode.VALIDATION_FAILED),
    );
  });

  it('answers NOT_FOUND for a number the server does not have', async () => {
    const { service } = withRow(null);
    await expect(service.cancel(GUILD, 9, SLASH)).resolves.toEqual({
      dryRun: false,
      code: 'NOT_FOUND',
      seq: 9,
      status: null,
    });
  });

  it('answers ALREADY_CANCELED, not an error, for a message canceled before', async () => {
    const { service } = withRow(row('CANCELED'));
    await expect(service.cancel(GUILD, 3, SLASH)).resolves.toEqual({
      dryRun: false,
      code: 'ALREADY_CANCELED',
      seq: 3,
      status: 'CANCELED',
    });
  });

  it.each(['SENDING', 'SENT', 'FAILED'])('answers NOT_PENDING for a %s message', async (status) => {
    const { service } = withRow(row(status));
    await expect(service.cancel(GUILD, 3, SLASH)).resolves.toEqual({
      dryRun: false,
      code: 'NOT_PENDING',
      seq: 3,
      status,
    });
  });

  it('with dryRun says it would cancel a pending message and changes nothing', async () => {
    // `prisma` offers only a read: any write, transaction or audit would throw.
    const { service, prisma } = withRow(row('PENDING'));
    await expect(service.cancel(GUILD, 3, SLASH, { dryRun: true })).resolves.toEqual({
      dryRun: true,
      code: 'CANCELED',
      seq: 3,
      status: 'PENDING',
    });
    expect(prisma.scheduledMessage.findFirst).toHaveBeenCalledTimes(1);
  });

  it('with dryRun reports the other outcomes too', async () => {
    const { service } = withRow(row('SENT'));
    await expect(service.cancel(GUILD, 3, SLASH, { dryRun: true })).resolves.toMatchObject({
      dryRun: true,
      code: 'NOT_PENDING',
    });
  });
});

describe('ScheduleService, the rest of the contract', () => {
  it('refuses a listing query that is not valid', async () => {
    const { service } = build();
    await expect(service.list(GUILD, { limit: 1000 })).rejects.toEqual(
      refusal(ErrorCode.VALIDATION_FAILED),
    );
    await expect(service.list(GUILD, { status: 'DONE' })).rejects.toEqual(
      refusal(ErrorCode.VALIDATION_FAILED),
    );
    await expect(service.list('nope')).rejects.toEqual(refusal(ErrorCode.VALIDATION_FAILED));
  });

  it('suggests nothing, without a read, for a server id that is not one', async () => {
    const { service } = build();
    await expect(service.autocompletePending('nope', '1')).resolves.toEqual([]);
  });

  it('refuses a key id that is not a UUID', async () => {
    const { service } = build();
    await expect(service.cancelByApiKey('not-a-uuid', SLASH)).rejects.toEqual(
      refusal(ErrorCode.VALIDATION_FAILED),
    );
  });

  it('hands a job to the delivery and reports whether it took the message', async () => {
    const { service, delivery } = build();
    await expect(service.handleJob('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).resolves.toBe(true);
    delivery.run.mockResolvedValueOnce(false);
    await expect(service.handleJob('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).resolves.toBe(false);
  });

  it('is a ServiceError, not a bug, when it refuses', async () => {
    const { service } = build();
    await expect(service.cancel(GUILD, 0, SLASH)).rejects.toBeInstanceOf(ServiceError);
  });
});
