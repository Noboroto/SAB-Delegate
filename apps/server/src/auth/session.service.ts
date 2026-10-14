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

/**
 * Turns the cookies on a request into a principal. The server verifies the
 * stateless cookie itself with the shared secret; there is no token between
 * the web app and the server.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  /** `null` for no cookie, a tampered or expired one, or a session without a valid Discord id. */
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
    const parsed = SessionPrincipalSchema.safeParse({
      discordUserId: session.user.discordId,
      createdAt: session.session.createdAt,
    });
    return parsed.success ? parsed.data : null;
  }

  /**
   * The principal of this request, resolved once: guards that run one after
   * another (session, fresh login, manage-guild) share the decryption.
   */
  async requirePrincipal(request: PrincipalRequest): Promise<SessionPrincipal> {
    if (request.principal !== undefined) return request.principal;
    const principal = await this.getPrincipal(request.headers);
    if (principal === null) throw new ApiError(ErrorCode.AUTH_UNAUTHENTICATED);
    request.principal = principal;
    return principal;
  }

  /**
   * The Discord OAuth access token from the encrypted account cookie, for
   * calls made on the person's behalf (their server list). It never goes back
   * to the browser: `/get-access-token` is behind the default-deny list.
   * `null` when the cookie holds none.
   */
  async discordAccessToken(headers: IncomingHttpHeaders): Promise<string | null> {
    try {
      const { accessToken } = await this.auth.api.getAccessToken({
        headers: fromNodeHeaders(headers),
        body: { useAccountCookie: true },
      });
      return accessToken.length > 0 ? accessToken : null;
    } catch (error) {
      if (isAPIError(error)) return null;
      throw error;
    }
  }
}
