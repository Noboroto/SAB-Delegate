import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { GuildAccessModule } from '../../common/guild-access/guild-access.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { PgBossModule } from '../../jobs/pg-boss.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import {
  ScheduleCancelAutocompleteInterceptor,
  ScheduleWhenAutocompleteInterceptor,
} from './schedule.autocomplete.js';
import { ScheduleCommands } from './schedule.commands.js';
import { ScheduleController } from './schedule.controller.js';
import { ScheduleDelivery } from './schedule.delivery.js';
import { ScheduleService } from './schedule.service.js';
import { ScheduleWorker } from './schedule.worker.js';
import { SchedulerCommands } from './scheduler-get.commands.js';

/**
 * Needs the Discord client (sending, channel checks) and the ready signal from
 * the global `DiscordModule`, so it is left out of the application while a
 * migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [
    AuditModule,
    GuildAccessModule,
    GuildConfigModule,
    I18nModule,
    PgBossModule,
    ...restImports(),
  ],
  controllers: restControllers([ScheduleController]),
  providers: [
    ScheduleService,
    ScheduleDelivery,
    ScheduleWorker,
    ScheduleCommands,
    SchedulerCommands,
    ScheduleWhenAutocompleteInterceptor,
    ScheduleCancelAutocompleteInterceptor,
  ],
  exports: [ScheduleService],
})
export class ScheduleModule {}
