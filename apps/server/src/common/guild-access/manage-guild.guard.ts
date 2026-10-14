import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { SnowflakeSchema } from '@sab/shared';
import type { PrincipalRequest } from '../../auth/principal.decorator.js';
import { SessionService } from '../../auth/session.service.js';
import { GuildAccessService, GuildNotFoundError } from './guild-access.service.js';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The gate of every `/api/guilds/:guildId/...` route: the caller must be signed
 * in (401) and must hold Manage Server in that guild on Discord's side. A
 * server that does not exist, one the bot is not in and one the caller may not
 * manage all answer the same 404 `GUILD_NOT_FOUND`, so the response cannot be
 * used to learn which servers the bot has joined.
 *
 * Reads accept a permission answer up to 30 seconds old; every other method
 * asks Discord again (`fresh`), so a revoked right stops writes at once. The
 * Origin check (`OriginGuard`) already ran as a global guard.
 */
@Injectable()
export class ManageGuildGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: GuildAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    const principal = await this.sessions.requirePrincipal(request);

    const params = request.params as { guildId?: unknown } | undefined;
    const guildId = SnowflakeSchema.safeParse(params?.guildId);
    if (!guildId.success) throw new GuildNotFoundError();

    await this.access.assertManageGuild(principal.discordUserId, guildId.data, {
      fresh: !SAFE_METHODS.has(request.method),
    });
    return true;
  }
}
