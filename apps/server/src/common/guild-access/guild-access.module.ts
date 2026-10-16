import { Module } from '@nestjs/common';
import { GuildActionLimiter } from '../limiter/guild-action.limiter.js';
import { GuildAccessService } from './guild-access.service.js';
import { DiscordUserClient } from './discord-user.client.js';
import { UserGuildsClient } from './user-guilds.client.js';

/** Needs the discord.js `Client`, which `DiscordModule` (global) provides. */
@Module({
  providers: [GuildAccessService, UserGuildsClient, DiscordUserClient, GuildActionLimiter],
  exports: [GuildAccessService, DiscordUserClient, GuildActionLimiter],
})
export class GuildAccessModule {}
