import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { BotProfileService } from './bot-profile.js';
import { GuildConfigCommands } from './guild-config.commands.js';
import { GuildConfigController } from './guild-config.controller.js';
import { GuildConfigService } from './guild-config.service.js';
import { GuildSyncListener } from './guild-sync.listener.js';

/**
 * Needs the Discord client (channel checks, events), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, ...restImports()],
  providers: [GuildConfigService, BotProfileService, GuildConfigCommands, GuildSyncListener],
  controllers: restControllers([GuildConfigController]),
  exports: [GuildConfigService, BotProfileService],
})
export class GuildConfigModule {}
