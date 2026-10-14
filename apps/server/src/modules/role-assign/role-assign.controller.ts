import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  RoleAssignMembersInputSchema,
  RoleAssignReactorsInputSchema,
  RoleAssignResultSchema,
  type RoleAssignResult,
  type z,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { destructiveFlags, requireConfirmation } from '../../common/rest/rest-support.js';
import { RoleAssignService } from './role-assign.service.js';

const MembersBodySchema = requireConfirmation(
  RoleAssignMembersInputSchema.safeExtend(destructiveFlags),
);
const ReactorsBodySchema = requireConfirmation(
  RoleAssignReactorsInputSchema.safeExtend(destructiveFlags),
);

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
    @Body({ schema: MembersBodySchema }) body: z.infer<typeof MembersBodySchema>,
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
    @Body({ schema: ReactorsBodySchema }) body: z.infer<typeof ReactorsBodySchema>,
  ): Promise<RoleAssignResult> {
    const result = await this.roleAssign.applyToReactors(guildId, body, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return RoleAssignResultSchema.parse(result);
  }
}
