import { Controller, Get, Inject, Logger, Req, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  ErrorCode,
  GuildPickerItemSchema,
  MeSchema,
  z,
  type GuildPickerItem,
  type Me,
} from '@sab/shared';
import { REST_SETTINGS } from '../../auth/better-auth.js';
import type { RestSettings } from '../../config/env.js';
import {
  Principal,
  type PrincipalRequest,
  type SessionPrincipal,
} from '../../auth/principal.decorator.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { SessionService } from '../../auth/session.service.js';
import {
  DiscordUserClient,
  type DiscordProfile,
} from '../../common/guild-access/discord-user.client.js';
import { GuildAccessService } from '../../common/guild-access/guild-access.service.js';
import { ApiError } from '../../common/errors/http-error.js';
import { GUILD_LIST_RATE_LIMIT } from '../../common/rate-limit/rate-limit.util.js';

/** Routes that are about the caller, not about one server: no `ManageGuildGuard`. */
@Controller('api')
@UseGuards(SessionGuard)
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly access: GuildAccessService,
    private readonly discordUser: DiscordUserClient,
    @Inject(REST_SETTINGS) private readonly settings: Pick<RestSettings, 'discordClientId'>,
  ) {}

  /**
   * The account the cookie proves, with the name and picture Discord shows for
   * it. Those are a convenience: when Discord cannot be asked (token expired,
   * outage) they are null and the answer is still 200, so the menu degrades to
   * an icon instead of the whole dashboard failing.
   */
  @Get('me')
  async me(
    @Principal() principal: SessionPrincipal,
    @Req() request: PrincipalRequest,
  ): Promise<Me> {
    const profile = await this.profileOf(principal.discordUserId, request);
    return MeSchema.parse({
      discordUserId: principal.discordUserId,
      username: profile?.username ?? null,
      globalName: profile?.globalName ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    });
  }

  /**
   * The server picker: servers the caller may manage, with and without the bot
   * (`botPresent`). Only a convenience filter; each server route checks the
   * permission again and treats a server without the bot as not found.
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
    const guilds = await this.access.listManageableGuilds(
      principal.discordUserId,
      accessToken,
      this.settings.discordClientId,
    );
    return z.array(GuildPickerItemSchema).parse(guilds);
  }

  private async profileOf(
    discordUserId: string,
    request: PrincipalRequest,
  ): Promise<DiscordProfile | null> {
    try {
      const accessToken = await this.sessions.discordAccessToken(request.headers);
      if (accessToken === null) return null;
      return await this.discordUser.profileOf(discordUserId, accessToken);
    } catch (error) {
      // The class only: an error message from the HTTP client may quote the request.
      this.logger.warn(
        `Could not read the Discord profile: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return null;
    }
  }
}
