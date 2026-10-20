import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  SnowflakeSchema,
  type ActorContext,
  type ChannelGame,
  type MiniGame,
} from '@sab/shared';
import { LRUCache } from 'lru-cache';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';

/** The game channels of one server, channel id to game. */
type Routes = ReadonlyMap<string, ChannelGame>;

export type SetChannelResult =
  | { status: 'OK' }
  /** The channel already hosts this other game, or the chatbot; nothing changed. */
  | { status: 'TAKEN'; game: MiniGame | 'CHATBOT' };

/**
 * Every message the bot sees asks for the route; a changed channel reaches this
 * process at once (`forget`), and the TTL bounds how long another process may
 * still serve the old one.
 */
const ROUTE_CACHE_MAX = 1_000;
const ROUTE_TTL_MS = 60_000;

function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Which channel of a server plays which channel game. A channel hosts one game
 * at most, the word chain included: two games judging the same messages would
 * answer each one twice.
 */
@Injectable()
export class GameChannelService {
  private readonly routes = new LRUCache<string, Routes>({
    max: ROUTE_CACHE_MAX,
    ttl: ROUTE_TTL_MS,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });
  /** Raised on every invalidation; a read that began before it must not be cached. */
  private epoch = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /**
   * The game played in a channel, `null` for any other channel. Only for
   * deciding whether a message can be a move: each game judges the move on a
   * fresh read of its channel.
   */
  async routeOf(guildId: string, channelId: string): Promise<ChannelGame | null> {
    const id = parseGuildId(guildId);
    let routes = this.routes.get(id);
    if (routes === undefined) {
      const epoch = this.epoch;
      const rows = await this.prisma.gameChannel.findMany({
        where: { guild: { discordId: id } },
        select: { channelId: true, game: true },
      });
      routes = new Map(
        rows.flatMap((row) =>
          row.game === 'WORD_CHAIN' ? [] : [[row.channelId, row.game] as const],
        ),
      );
      // A write that committed while the read was in flight may have left this
      // answer stale; serve it once, but do not keep it.
      if (epoch === this.epoch) this.routes.set(id, routes);
    }
    return routes.get(channelId) ?? null;
  }

  /** The channel of `game`, read fresh; `null` when it has none. */
  async channelOf(guildId: string, game: ChannelGame): Promise<string | null> {
    const row = await this.prisma.gameChannel.findFirst({
      where: { guild: { discordId: parseGuildId(guildId) }, game },
      select: { channelId: true },
    });
    return row?.channelId ?? null;
  }

  /**
   * Moves `game` to `channelId`. The channel is checked against Discord before
   * the transaction opens: a network call must not hold a database
   * transaction. The game's state is left alone; the caller starts a round.
   */
  async set(
    guildId: string,
    game: ChannelGame,
    channelId: string,
    actor: ActorContext,
  ): Promise<SetChannelResult> {
    const id = parseGuildId(guildId);
    const channel = SnowflakeSchema.safeParse(channelId);
    if (!channel.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);

    const access = await this.channelAccess.check(channel.data, 'send');
    if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    if (access !== 'ok') {
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    }
    try {
      const result = await this.prisma.$transaction(async (tx): Promise<SetChannelResult> => {
        const guild = await this.guilds.ensureGuild(id, undefined, tx);
        // Held until commit: a concurrent word-chain `/game set` or chatbot channel on the
        // same channel waits here, then reads this write instead of racing it.
        await this.guilds.lockChannelClaim(channel.data, tx);
        const word = await tx.guildConfig.findFirst({
          where: { wordChannelId: channel.data },
          select: { id: true },
        });
        if (word !== null) return { status: 'TAKEN', game: 'WORD_CHAIN' };
        const chatbot = await tx.chatbotChannel.findUnique({
          where: { channelId: channel.data },
          select: { id: true },
        });
        if (chatbot !== null) return { status: 'TAKEN', game: 'CHATBOT' };
        const holder = await tx.gameChannel.findUnique({
          where: { channelId: channel.data },
          select: { game: true },
        });
        if (holder !== null && holder.game !== game) return { status: 'TAKEN', game: holder.game };

        await tx.gameChannel.deleteMany({ where: { guildId: guild.id, game } });
        await tx.gameChannel.create({ data: { guildId: guild.id, game, channelId: channel.data } });
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.miniGameConfigure,
            params: { game, channelId: channel.data },
          },
          tx,
        );
        return { status: 'OK' };
      });
      return result;
    } catch (error) {
      // Another server's game, or a concurrent `set` that won the channel.
      if (isUniqueViolation(error)) {
        const holder = await this.prisma.gameChannel.findUnique({
          where: { channelId: channel.data },
          select: { game: true },
        });
        if (holder !== null) return { status: 'TAKEN', game: holder.game };
      }
      throw error;
    } finally {
      this.forget(id);
    }
  }

  /** Call after a write to the game channels of a server has committed. */
  forget(guildId: string): void {
    this.epoch += 1;
    this.routes.delete(guildId);
  }
}
