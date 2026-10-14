import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { ApiError } from '../common/errors/http-error.js';
import type { PrincipalRequest } from './principal.decorator.js';
import { SessionService } from './session.service.js';

/** How recent the login must be for the actions that can do lasting damage. */
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
 * five minutes. A stateless cookie cannot be revoked, so what bounds a stolen
 * one is asking for a new Discord login before the actions that matter; the web
 * app answers this code by sending the person through Discord again.
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
