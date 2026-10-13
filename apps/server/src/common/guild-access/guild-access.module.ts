import { Module } from '@nestjs/common';
import { GuildAccessService } from './guild-access.service.js';

/** Needs the discord.js `Client`, which `DiscordModule` (global) provides. */
@Module({
  providers: [GuildAccessService],
  exports: [GuildAccessService],
})
export class GuildAccessModule {}
