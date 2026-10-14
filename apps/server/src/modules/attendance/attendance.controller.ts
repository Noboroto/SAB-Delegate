import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  AttendanceCheckSchema,
  AttendanceResultSchema,
  type AttendanceCheck,
  type AttendanceResult,
} from '@sab/shared';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { AttendanceService } from './attendance.service.js';

/** Who of a role is in a voice channel right now. Read-only. */
@Controller('api/guilds/:guildId/attendance')
@UseGuards(ManageGuildGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  async check(
    @Param('guildId') guildId: string,
    @Query({ schema: AttendanceCheckSchema }) query: AttendanceCheck,
  ): Promise<AttendanceResult> {
    return AttendanceResultSchema.parse(await this.attendance.checkByRole(guildId, query));
  }
}
