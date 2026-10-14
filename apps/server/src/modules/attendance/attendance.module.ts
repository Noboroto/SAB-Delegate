import { Module } from '@nestjs/common';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { AttendanceCommands } from './attendance.commands.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

/**
 * Needs the Discord client to read members and voice states, so it is left out
 * of the application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [I18nModule, ...restImports()],
  providers: [AttendanceService, AttendanceCommands],
  controllers: restControllers([AttendanceController]),
  exports: [AttendanceService],
})
export class AttendanceModule {}
