import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../common/errors/http-error.js';

/**
 * Keeps the key-management routes behind the browser login alone. A key must
 * not be able to mint or revoke keys, so a request that presents a credential
 * in the `Authorization` header is refused even when it also carries a valid
 * cookie; the login itself is checked by `SessionGuard` after this one.
 */
@Injectable()
export class SessionOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.headers.authorization !== undefined) {
      throw new ApiError(ErrorCode.AUTH_UNAUTHENTICATED);
    }
    return true;
  }
}
