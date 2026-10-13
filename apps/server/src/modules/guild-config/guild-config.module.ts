import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GuildConfigCommands } from './guild-config.commands.js';
import { GuildConfigService } from './guild-config.service.js';
import { GuildSyncListener } from './guild-sync.listener.js';

/**
 * Needs the Discord client (channel checks, events), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule],
  providers: [GuildConfigService, GuildConfigCommands, GuildSyncListener],
  exports: [GuildConfigService],
})
export class GuildConfigModule {}
