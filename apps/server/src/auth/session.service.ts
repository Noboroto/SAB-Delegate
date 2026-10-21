import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { ApiError } from '../common/errors/http-error.js';
import { AUTH, type Auth } from './better-auth.js';
import {
  SessionPrincipalSchema,
  type PrincipalRequest,
  type SessionPrincipal,
} from './principal.decorator.js';

const DISCORD_PROVIDER_ID = 'discord';

/**
 * Turns the session cookie on a request into a principal. Better Auth checks
 * the signed cookie and, once its short cache lapses, the session row; there
 * is no token between the web app and the server.
 */
@Injectable()
export class SessionService {
  /** One Discord access-token read per account at a time (see `discordAccessToken`). */
  private readonly tokenReads = new Map<string, Promise<string | null>>();

  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  /** `null` for no cookie, a tampered, expired or revoked one, or a session without a valid Discord id. */
  async getPrincipal(headers: IncomingHttpHeaders): Promise<SessionPrincipal | null> {
    let session;
    try {
      session = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
    } catch (error) {
      // A cookie Better Auth cannot read is "not signed in"; anything else is a bug to surface.
      if (isAPIError(error)) return null;
      throw error;
    }
    if (session === null) return null;
    const parsed = SessionPrincipalSchema.safeParse({ discordUserId: session.user.discordId });
    return parsed.success ? parsed.data : null;
  }

  /**
   * The principal of this request, or `null`, resolved once: the rate limiter,
   * the guards that run one after another (session, manage-guild)
   * and the handler share the lookup. Only a found principal is kept.
   */
  async principalOf(request: PrincipalRequest): Promise<SessionPrincipal | null> {
    if (request.principal !== undefined) return request.principal;
    const principal = await this.getPrincipal(request.headers);
    if (principal !== null) request.principal = principal;
    return principal;
  }

  /** Like `principalOf`, but 401 `AUTH_UNAUTHENTICATED` when there is no valid login. */
  async requirePrincipal(request: PrincipalRequest): Promise<SessionPrincipal> {
    const principal = await this.principalOf(request);
    if (principal === null) throw new ApiError(ErrorCode.AUTH_UNAUTHENTICATED);
    return principal;
  }

  /**
   * The Discord OAuth access token of the signed-in person, for calls made on
   * their behalf (their server list). An expired one is refreshed with the
   * stored refresh token and the rotated pair is saved. It never goes back to
   * the browser: `/get-access-token` is behind the default-deny list. `null`
   * when there is no session, no Discord account, or Discord refuses the
   * refresh (the person revoked the app); the caller asks for a new sign-in.
   */
  async discordAccessToken(headers: IncomingHttpHeaders): Promise<string | null> {
    try {
      const requestHeaders = fromNodeHeaders(headers);
      const accounts = await this.auth.api.listUserAccounts({ headers: requestHeaders });
      const discord = accounts.find((account) => account.providerId === DISCORD_PROVIDER_ID);
      if (discord === undefined) return null;
      // Discord rotates the refresh token on use: two requests refreshing an
      // expired token at once would race, and the loser's single-use token
      // fails. Calls for one account share a single read while it is running.
      const running = this.tokenReads.get(discord.id);
      if (running !== undefined) return await running;
      const read = this.auth.api
        .getAccessToken({ headers: requestHeaders, body: { accountId: discord.id } })
        .then(({ accessToken }) => (accessToken.length > 0 ? accessToken : null))
        .finally(() => this.tokenReads.delete(discord.id));
      this.tokenReads.set(discord.id, read);
      return await read;
    } catch (error) {
      if (isAPIError(error)) return null;
      throw error;
    }
  }
}
