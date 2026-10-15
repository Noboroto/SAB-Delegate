import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { GameChannelService } from './game-channel.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const ALICE = '300000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: ALICE };

type Row = { channelId: string; game: string };

type Setup = {
  rows?: Row[];
  access?: 'ok' | 'not-found' | 'forbidden';
  wordChannelId?: string | null;
  /** What `gameChannel.findUnique` finds for the target channel. */
  holder?: { game: string } | null;
  createError?: Error;
  /** What the fresh lookup finds after the create failed. */
  holderAfterError?: { game: string } | null;
};

afterEach(() => {
  vi.restoreAllMocks();
});

function build(setup: Setup = {}) {
  const gameChannel = {
    findMany: vi.fn(() => Promise.resolve(setup.rows ?? [])),
    findFirst: vi.fn(() => Promise.resolve(null as { channelId: string } | null)),
    findUnique: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn(() =>
      setup.createError === undefined ? Promise.resolve({}) : Promise.reject(setup.createError),
    ),
  };
  gameChannel.findUnique
    .mockResolvedValueOnce(setup.holder ?? null)
    .mockResolvedValue(setup.holderAfterError ?? null);
  const guildConfig = {
    findFirst: vi.fn(({ where }: { where: { wordChannelId: string } }) =>
      Promise.resolve(setup.wordChannelId === where.wordChannelId ? { id: 'config' } : null),
    ),
  };
  const tx = { gameChannel, guildConfig };
  const prisma = {
    gameChannel,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const guilds = {
    ensureGuild: vi.fn().mockResolvedValue({ id: 'guild-key' }),
  };
  const access = { check: vi.fn().mockResolvedValue(setup.access ?? 'ok') };
  const service = new GameChannelService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    guilds as unknown as GuildConfigService,
    access as unknown as ChannelAccessService,
  );
  return { service, prisma, gameChannel, guildConfig, audit, guilds, access };
}

describe('GameChannelService.routeOf', () => {
  it('names the game of a channel and null for any other channel', async () => {
    const { service } = build({
      rows: [
        { channelId: CHANNEL, game: 'COUNTING' },
        { channelId: OTHER_CHANNEL, game: 'WORDLE' },
      ],
    });
    await expect(service.routeOf(GUILD, CHANNEL)).resolves.toBe('COUNTING');
    await expect(service.routeOf(GUILD, OTHER_CHANNEL)).resolves.toBe('WORDLE');
    await expect(service.routeOf(GUILD, '200000000000000009')).resolves.toBeNull();
  });

  it('leaves the word chain to its own listener', async () => {
    const { service } = build({ rows: [{ channelId: CHANNEL, game: 'WORD_CHAIN' }] });
    await expect(service.routeOf(GUILD, CHANNEL)).resolves.toBeNull();
  });

  it('reads the database once for every message after the first', async () => {
    const { service, gameChannel } = build({ rows: [{ channelId: CHANNEL, game: 'COUNTING' }] });
    for (let i = 0; i < 5; i += 1) await service.routeOf(GUILD, CHANNEL);
    expect(gameChannel.findMany).toHaveBeenCalledTimes(1);
  });

  it('caches a server without any game channel too', async () => {
    const { service, gameChannel } = build();
    await service.routeOf(GUILD, CHANNEL);
    await service.routeOf(GUILD, CHANNEL);
    expect(gameChannel.findMany).toHaveBeenCalledTimes(1);
  });

  it('reads again after forget', async () => {
    const { service, gameChannel } = build();
    await service.routeOf(GUILD, CHANNEL);
    service.forget(GUILD);
    await service.routeOf(GUILD, CHANNEL);
    expect(gameChannel.findMany).toHaveBeenCalledTimes(2);
  });

  it('reads again after the one-minute lifetime', async () => {
    let now = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { service, gameChannel } = build();
    await service.routeOf(GUILD, CHANNEL);
    // lru-cache reuses a reading of the clock for one millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    now += 59_000;
    await service.routeOf(GUILD, CHANNEL);
    expect(gameChannel.findMany).toHaveBeenCalledTimes(1);
    now += 2_000;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.routeOf(GUILD, CHANNEL);
    expect(gameChannel.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not keep an answer read while a write was committing', async () => {
    const { service, gameChannel } = build();
    let release: () => void = () => undefined;
    gameChannel.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([{ channelId: CHANNEL, game: 'COUNTING' }]);
        }),
    );
    const first = service.routeOf(GUILD, CHANNEL);
    service.forget(GUILD);
    release();
    // Served once, but not cached: the next message reads again.
    await expect(first).resolves.toBe('COUNTING');
    gameChannel.findMany.mockResolvedValue([]);
    await expect(service.routeOf(GUILD, CHANNEL)).resolves.toBeNull();
    expect(gameChannel.findMany).toHaveBeenCalledTimes(2);
  });

  it('keeps the servers apart', async () => {
    const { service, gameChannel } = build();
    await service.routeOf(GUILD, CHANNEL);
    await service.routeOf('100000000000000002', CHANNEL);
    expect(gameChannel.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a server id that is not a snowflake', async () => {
    const { service } = build();
    await expect(service.routeOf('guild', CHANNEL)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });
});

describe('GameChannelService.channelOf', () => {
  it('reads fresh each time and returns null without a channel', async () => {
    const { service, gameChannel } = build();
    await expect(service.channelOf(GUILD, 'WORDLE')).resolves.toBeNull();
    gameChannel.findFirst.mockResolvedValueOnce({ channelId: CHANNEL });
    await expect(service.channelOf(GUILD, 'WORDLE')).resolves.toBe(CHANNEL);
    expect(gameChannel.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('GameChannelService.set', () => {
  it('moves the game to the channel and audits it', async () => {
    const { service, gameChannel, audit } = build();
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).resolves.toEqual({ status: 'OK' });
    expect(gameChannel.deleteMany).toHaveBeenCalledWith({
      where: { guildId: 'guild-key', game: 'COUNTING' },
    });
    expect(gameChannel.create).toHaveBeenCalledWith({
      data: { guildId: 'guild-key', game: 'COUNTING', channelId: CHANNEL },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.miniGameConfigure,
        params: { game: 'COUNTING', channelId: CHANNEL },
      }),
      expect.anything(),
    );
  });

  it('is TAKEN when the channel is the word chain channel, read inside the transaction', async () => {
    const { service, prisma, gameChannel, guildConfig, audit } = build({ wordChannelId: CHANNEL });
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).resolves.toEqual({
      status: 'TAKEN',
      game: 'WORD_CHAIN',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(guildConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { wordChannelId: CHANNEL } }),
    );
    expect(gameChannel.deleteMany).not.toHaveBeenCalled();
    expect(gameChannel.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('is not TAKEN by a word chain channel that is a different channel', async () => {
    const { service } = build({ wordChannelId: OTHER_CHANNEL });
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).resolves.toEqual({ status: 'OK' });
  });

  it('is TAKEN when the channel already hosts another game', async () => {
    const { service, gameChannel, audit } = build({ holder: { game: 'WORDLE' } });
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).resolves.toEqual({
      status: 'TAKEN',
      game: 'WORDLE',
    });
    expect(gameChannel.deleteMany).not.toHaveBeenCalled();
    expect(gameChannel.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sets a channel that already hosts this very game', async () => {
    const { service } = build({ holder: { game: 'COUNTING' } });
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).resolves.toEqual({ status: 'OK' });
  });

  it('is TAKEN when a concurrent set wins the channel between the check and the insert', async () => {
    const { service } = build({
      createError: Object.assign(new Error('unique'), { code: 'P2002' }),
      holderAfterError: { game: 'SCRAMBLE' },
    });
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).resolves.toEqual({
      status: 'TAKEN',
      game: 'SCRAMBLE',
    });
  });

  it('rethrows a unique violation that no longer has a holder, and any other failure', async () => {
    const unique = Object.assign(new Error('unique'), { code: 'P2002' });
    await expect(
      build({ createError: unique }).service.set(GUILD, 'COUNTING', CHANNEL, ACTOR),
    ).rejects.toBe(unique);
    const down = new Error('db down');
    await expect(
      build({ createError: down }).service.set(GUILD, 'COUNTING', CHANNEL, ACTOR),
    ).rejects.toBe(down);
  });

  it('checks the channel with Discord before opening a transaction', async () => {
    const { service, prisma, access } = build({ access: 'not-found' });
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
    expect(access.check).toHaveBeenCalledWith(CHANNEL, 'send');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a channel the bot cannot send in', async () => {
    const { service, prisma } = build({ access: 'forbidden' });
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects ids that are not snowflakes', async () => {
    const { service } = build();
    await expect(service.set('guild', 'COUNTING', CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.set(GUILD, 'COUNTING', 'here', ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });

  it('drops the cached routes of the server after a change, and after a failed one', async () => {
    const { service, gameChannel } = build({
      rows: [{ channelId: CHANNEL, game: 'COUNTING' }],
      createError: new Error('db down'),
    });
    await service.routeOf(GUILD, CHANNEL);
    await expect(service.set(GUILD, 'COUNTING', CHANNEL, ACTOR)).rejects.toThrow('db down');
    await service.routeOf(GUILD, CHANNEL);
    expect(gameChannel.findMany).toHaveBeenCalledTimes(2);
  });
});
