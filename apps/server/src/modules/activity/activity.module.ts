import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { ActivityCommands } from './activity.commands.js';
import { ActivityService } from './activity.service.js';

/**
 * Needs the Discord client to create roles and channels, so it is left out of
 * the application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, GuildConfigModule],
  providers: [ActivityService, ActivityCommands],
  exports: [ActivityService],
})
export class ActivityModule {}
