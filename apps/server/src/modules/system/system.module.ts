import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { CommandsCatalogService } from './commands-catalog.service.js';
import { DiscordLookupService } from './discord-lookup.service.js';
import { SystemCommands } from './system.commands.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

/**
 * Needs `DiscordModule` (global) for the client, the command registry, the
 * environment and the guild language lookup, so it must be left out of the
 * application together with it while `MIGRATION_PENDING` is set.
 */
@Module({
  imports: [AuditModule, ...restImports()],
  providers: [SystemService, CommandsCatalogService, DiscordLookupService, SystemCommands],
  controllers: restControllers([SystemController]),
  exports: [SystemService, CommandsCatalogService],
})
export class SystemModule {}
