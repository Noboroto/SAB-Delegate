import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext, type ChannelGame } from '@sab/shared';
import { Client } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GameChannelService } from '../game-core/game-channel.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { CountingService } from './counting.service.js';
import { formatOpening } from './mini-game.format.js';
import type { Opening } from './mini-game.types.js';
import { ScrambleService } from './scramble.service.js';
import { WordleService } from './wordle.service.js';

const UNKNOWN_CHANNEL = 10003;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

/** Why a round is started over; set up is audited by the channel change itself. */
export type RestartReason = 'configure' | 'reset' | 'skip';

type Restarted = { channelId: string; opening: Opening };

/**
 * Starting rounds of the channel games, for the slash commands: a new round
 * after `/game set`, `reset` or `skip`, and its opening posted in the channel.
 */
@Injectable()
export class MiniGameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly channels: GameChannelService,
    private readonly locales: GuildLocaleService,
    private readonly client: Client,
    private readonly counting: CountingService,
    private readonly scramble: ScrambleService,
    private readonly wordle: WordleService,
  ) {}

  /**
   * A new round of `game`, replacing the one in play. `null` when the game has
   * no channel in this server. The round commits before anything is posted.
   */
  async restart(
    guildId: string,
    game: ChannelGame,
    actor: ActorContext,
    reason: RestartReason,
  ): Promise<Restarted | null> {
    const channelId = await this.channels.channelOf(guildId, game);
    if (channelId === null) return null;
    const opening = await this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(guildId, undefined, tx);
      const started = await this.roundOf(game).restart(tx, guild.id);
      if (reason !== 'configure') {
        await this.audit.record(
          {
            guildId,
            actor,
            action: reason === 'skip' ? AUDIT_ACTIONS.miniGameSkip : AUDIT_ACTIONS.miniGameReset,
            params: { game, channelId },
          },
          tx,
        );
      }
      return started;
    });
    return { channelId, opening };
  }

  /** Posts the opening of a round in its channel. */
  async announce(guildId: string, { channelId, opening }: Restarted): Promise<void> {
    const t = translatorFor(await this.locales.resolve(guildId));
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel === null || !channel.isSendable()) {
        throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      }
      await channel.send({ ...formatOpening(t, opening), allowedMentions: { parse: [] } });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const code = discordErrorCode(error);
      if (code === UNKNOWN_CHANNEL) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      if (code === MISSING_ACCESS || code === MISSING_PERMISSIONS) {
        throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
      }
      throw error;
    }
  }

  private roundOf(game: ChannelGame): Pick<CountingService, 'restart'> {
    switch (game) {
      case 'COUNTING':
        return this.counting;
      case 'SCRAMBLE':
        return this.scramble;
      case 'WORDLE':
        return this.wordle;
    }
  }
}
