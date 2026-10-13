import { Module } from '@nestjs/common';
import { CommandsCatalogService } from './commands-catalog.service.js';
import { SystemCommands } from './system.commands.js';
import { SystemService } from './system.service.js';

/**
 * Needs `DiscordModule` (global) for the client, the command registry, the
 * environment and the guild language lookup, so it must be left out of the
 * application together with it while `MIGRATION_PENDING` is set.
 */
@Module({
  providers: [SystemService, CommandsCatalogService, SystemCommands],
  exports: [SystemService, CommandsCatalogService],
})
export class SystemModule {}
