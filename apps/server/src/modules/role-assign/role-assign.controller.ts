import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  RoleAssignMembersRequestSchema,
  RoleAssignReactorsRequestSchema,
  RoleAssignResultSchema,
  type RoleAssignResult,
  type z,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { RoleAssignService } from './role-assign.service.js';

/**
 * Gives or takes a role for many members at once. Changing roles is hard to
 * undo in bulk, so a call must either preview (`dryRun`) or carry
 * `confirm: true`; the preview itself is the service's. The message read for
 * reactors must be in this server (no `crossGuild` here).
 */
@Controller('api/guilds/:guildId/role-assign')
@UseGuards(ManageGuildGuard)
export class RoleAssignController {
  constructor(private readonly roleAssign: RoleAssignService) {}

  @Post('members')
  @HttpCode(200)
  async members(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: RoleAssignMembersRequestSchema })
    body: z.infer<typeof RoleAssignMembersRequestSchema>,
  ): Promise<RoleAssignResult> {
    const result = await this.roleAssign.applyToMembers(guildId, body, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return RoleAssignResultSchema.parse(result);
  }

  @Post('reactors')
  @HttpCode(200)
  async reactors(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: RoleAssignReactorsRequestSchema })
    body: z.infer<typeof RoleAssignReactorsRequestSchema>,
  ): Promise<RoleAssignResult> {
    const result = await this.roleAssign.applyToReactors(guildId, body, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return RoleAssignResultSchema.parse(result);
  }
}
