import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { PurgeCommands } from './purge.commands.js';
import { PurgeContextMenu } from './purge.context-menu.js';
import { PurgeController } from './purge.controller.js';
import { PurgeFlow } from './purge.flow.js';
import { PurgeService } from './purge.service.js';

/**
 * Needs the Discord client (channels, messages), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, ...restImports()],
  providers: [PurgeService, PurgeFlow, PurgeCommands, PurgeContextMenu],
  controllers: restControllers([PurgeController]),
  exports: [PurgeService],
})
export class PurgeModule {}
