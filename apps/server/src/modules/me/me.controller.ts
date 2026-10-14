import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  ErrorCode,
  GuildPickerItemSchema,
  MeSchema,
  z,
  type GuildPickerItem,
  type Me,
} from '@sab/shared';
import {
  Principal,
  type PrincipalRequest,
  type SessionPrincipal,
} from '../../auth/principal.decorator.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { SessionService } from '../../auth/session.service.js';
import { GuildAccessService } from '../../common/guild-access/guild-access.service.js';
import { ApiError } from '../../common/errors/http-error.js';
import { GUILD_LIST_RATE_LIMIT } from '../../common/rate-limit/rate-limit.util.js';

/** Routes that are about the caller, not about one server: no `ManageGuildGuard`. */
@Controller('api')
@UseGuards(SessionGuard)
export class MeController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: GuildAccessService,
  ) {}

  @Get('me')
  me(@Principal() principal: SessionPrincipal): Me {
    return MeSchema.parse({ discordUserId: principal.discordUserId });
  }

  /**
   * The server picker: servers the caller may manage where the bot is. Only a
   * convenience filter; each server route checks the permission again.
   */
  @Get('guilds')
  @RouteConfig({ rateLimit: GUILD_LIST_RATE_LIMIT })
  async guilds(
    @Principal() principal: SessionPrincipal,
    @Req() request: PrincipalRequest,
  ): Promise<GuildPickerItem[]> {
    const accessToken = await this.sessions.discordAccessToken(request.headers);
    // A login without the Discord token cannot list servers: sign in again.
    if (accessToken === null) throw new ApiError(ErrorCode.AUTH_REAUTH_REQUIRED);
    const guilds = await this.access.listManageableGuilds(principal.discordUserId, accessToken);
    return z.array(GuildPickerItemSchema).parse(guilds);
  }
}
