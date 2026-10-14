import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ActivityCreateResultSchema,
  ActivityCreateSchema,
  type ActivityCreate,
  type ActivityCreateResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { ActivityService } from './activity.service.js';

/** Sets up an activity: its roles and channels in the server's activity category. */
@Controller('api/guilds/:guildId/activity')
@UseGuards(ManageGuildGuard)
export class ActivityController {
  constructor(private readonly activities: ActivityService) {}

  @Post()
  async create(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ActivityCreateSchema }) body: ActivityCreate,
  ): Promise<ActivityCreateResult> {
    const result = await this.activities.createActivity(guildId, body, httpActor(principal));
    return ActivityCreateResultSchema.parse(result);
  }
}
