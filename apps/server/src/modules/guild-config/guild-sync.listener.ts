import { Logger } from '@nestjs/common';
import { Context, On, Once, type ContextOf } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { GuildConfigService } from './guild-config.service.js';

type GuildLike = { id: string; available: boolean; name: string };

/** An unavailable guild (outage) arrives as a stub without a name. */
function nameOf(guild: GuildLike): string | undefined {
  return guild.available ? guild.name : undefined;
}

/**
 * Keeps one row per server the bot is in, with its current name. Rows are
 * never deleted here: leaving a server (or a kick, or an outage that fires
 * `guildDelete`) must not erase its settings, birthdays or audit trail.
 */
@DiscordCommands()
export class GuildSyncListener {
  private readonly logger = new Logger(GuildSyncListener.name);

  constructor(private readonly guilds: GuildConfigService) {}

  @Once('clientReady')
  async onClientReady(@Context() [client]: ContextOf<'clientReady'>): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
      await this.sync(guild);
    }
  }

  @On('guildCreate')
  async onGuildCreate(@Context() [guild]: ContextOf<'guildCreate'>): Promise<void> {
    await this.sync(guild);
  }

  @On('guildUpdate')
  async onGuildUpdate(@Context() [, guild]: ContextOf<'guildUpdate'>): Promise<void> {
    await this.sync(guild);
  }

  /** One server failing must not leave the rest unrecorded, so nothing is rethrown. */
  private async sync(guild: GuildLike): Promise<void> {
    try {
      await this.guilds.ensureGuild(guild.id, nameOf(guild));
    } catch (error) {
      this.logger.error(`Could not record guild ${guild.id} (${errorLabel(error)})`);
    }
  }
}
