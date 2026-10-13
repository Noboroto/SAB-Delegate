import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { PurgeCommands } from './purge.commands.js';
import { PurgeContextMenu } from './purge.context-menu.js';
import { PurgeFlow } from './purge.flow.js';
import { PurgeService } from './purge.service.js';

/**
 * Needs the Discord client (channels, messages), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule],
  providers: [PurgeService, PurgeFlow, PurgeCommands, PurgeContextMenu],
  exports: [PurgeService],
})
export class PurgeModule {}
