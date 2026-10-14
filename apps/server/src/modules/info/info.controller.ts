import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  IntroductionQuerySchema,
  IntroductionResultSchema,
  InviteCreateSchema,
  InviteResultSchema,
  ReactorIdsQuerySchema,
  ReactorIdsResultSchema,
  RoleMembersQuerySchema,
  RoleMembersResultSchema,
  type IntroductionQuery,
  type IntroductionResult,
  type InviteCreate,
  type InviteResult,
  type ReactorIdsQuery,
  type ReactorIdsResult,
  type RoleMembersQuery,
  type RoleMembersResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { InfoService } from './info.service.js';

/**
 * Lookups the `/get` commands offer. The reads are `GET`; creating an invite
 * changes the server, so it is a `POST` and gets a fresh permission check like
 * every other write. A message is only found inside this server.
 */
@Controller('api/guilds/:guildId/info')
@UseGuards(ManageGuildGuard)
export class InfoController {
  constructor(private readonly info: InfoService) {}

  @Get('introduction')
  async introduction(
    @Param('guildId') guildId: string,
    @Query({ schema: IntroductionQuerySchema }) query: IntroductionQuery,
  ): Promise<IntroductionResult> {
    return IntroductionResultSchema.parse(await this.info.getIntroduction(guildId, query));
  }

  @Get('reactors')
  async reactors(
    @Param('guildId') guildId: string,
    @Query({ schema: ReactorIdsQuerySchema }) query: ReactorIdsQuery,
  ): Promise<ReactorIdsResult> {
    return ReactorIdsResultSchema.parse(await this.info.listReactorIds(guildId, query));
  }

  @Get('role-members')
  async roleMembers(
    @Param('guildId') guildId: string,
    @Query({ schema: RoleMembersQuerySchema }) query: RoleMembersQuery,
  ): Promise<RoleMembersResult> {
    return RoleMembersResultSchema.parse(await this.info.listRoleMemberIds(guildId, query));
  }

  @Post('invite')
  async invite(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: InviteCreateSchema }) body: InviteCreate,
  ): Promise<InviteResult> {
    const result = await this.info.createInvite(guildId, body, httpActor(principal));
    return InviteResultSchema.parse(result);
  }
}
