import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { PgBossModule } from '../../jobs/pg-boss.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { BirthdayCommands } from './birthday.commands.js';
import { BirthdayController } from './birthday.controller.js';
import { BirthdayCron } from './birthday.cron.js';
import { BirthdayService } from './birthday.service.js';

/**
 * Needs the Discord client (greetings, channel checks) and the ready signal
 * from the global `DiscordModule`, so it is left out of the application while
 * a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, PgBossModule, GuildConfigModule, ...restImports()],
  providers: [BirthdayService, BirthdayCommands, BirthdayCron],
  controllers: restControllers([BirthdayController]),
  exports: [BirthdayService],
})
export class BirthdayModule {}
