import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { ApiError } from '../common/errors/http-error.js';
import type { PrincipalRequest } from './principal.decorator.js';
import { SessionService } from './session.service.js';

/**
 * How recent the login must be where `FreshAuthGuard` is applied. Measured from
 * `session.createdAt`, which Better Auth 1.7.7 never rewrites when it refreshes a
 * session (the cookie refresh copies the session object, the stored refresh only
 * moves `expiresAt` and `updatedAt`); re-check after upgrading Better Auth.
 */
export const FRESH_AUTH_WINDOW_MS = 5 * 60_000;

/** 401 `AUTH_UNAUTHENTICATED` unless the request carries a valid login; leaves the principal on the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessions.requirePrincipal(context.switchToHttp().getRequest<PrincipalRequest>());
    return true;
  }
}

/**
 * 401 without a login, 403 `AUTH_REAUTH_REQUIRED` when the login is older than
 * five minutes. A stateless cookie cannot be revoked, so a stolen one stays
 * usable until it expires; this guard narrows that for the one action that
 * outlives a login, creating a write API key. No route uses it yet: the
 * destructive dashboard routes are bounded by the 8 hour lifetime and the fresh
 * Manage Server check of `ManageGuildGuard`. The web app answers this code by
 * sending the person through Discord again.
 */
@Injectable()
export class FreshAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = await this.sessions.requirePrincipal(
      context.switchToHttp().getRequest<PrincipalRequest>(),
    );
    if (Date.now() - principal.createdAt.getTime() > FRESH_AUTH_WINDOW_MS) {
      throw new ApiError(ErrorCode.AUTH_REAUTH_REQUIRED);
    }
    return true;
  }
}
