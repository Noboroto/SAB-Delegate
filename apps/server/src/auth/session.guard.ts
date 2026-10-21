import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { PrincipalRequest } from './principal.decorator.js';
import { SessionService } from './session.service.js';

/** 401 `AUTH_UNAUTHENTICATED` unless the request carries a valid login; leaves the principal on the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessions.requirePrincipal(context.switchToHttp().getRequest<PrincipalRequest>());
    return true;
  }
}
