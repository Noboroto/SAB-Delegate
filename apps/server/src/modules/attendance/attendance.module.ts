import { Module } from '@nestjs/common';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { AttendanceCommands } from './attendance.commands.js';
import { AttendanceService } from './attendance.service.js';

/**
 * Needs the Discord client to read members and voice states, so it is left out
 * of the application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [I18nModule],
  providers: [AttendanceService, AttendanceCommands],
  exports: [AttendanceService],
})
export class AttendanceModule {}
