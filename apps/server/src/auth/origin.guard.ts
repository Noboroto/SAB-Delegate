import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../common/errors/http-error.js';
import type { RestSettings } from '../config/env.js';
import { AUTH_COOKIE_PREFIX, REST_SETTINGS } from './better-auth.js';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
// Browsers prepend these to a Secure cookie's name on HTTPS.
const COOKIE_NAME_PREFIXES = /^__(?:Secure|Host)-/;

function carriesLogin(cookies: Readonly<Record<string, string | undefined>>): boolean {
  return Object.keys(cookies).some((name) =>
    name.replace(COOKIE_NAME_PREFIXES, '').startsWith(`${AUTH_COOKIE_PREFIX}.`),
  );
}

/**
 * Cross-site request forgery defence for every route behind the cookie login:
 * a write that carries the login cookie must come from the application's own
 * origin. SameSite=Lax already withholds the cookie from most cross-site
 * writes; this holds if a browser or a future change lets one through.
 *
 * `Sec-Fetch-Site` is checked when the browser sends it. A write with the cookie
 * and no Origin is refused: browsers always send Origin on POST/PUT/PATCH/DELETE.
 * Requests without the login cookie are left to the authentication guards, which
 * answer 401. Registered globally, so a new controller cannot forget it.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(@Inject(REST_SETTINGS) settings: Pick<RestSettings, 'appUrl'>) {
    this.allowedOrigin = settings.appUrl;
  }

  canActivate(context: ExecutionContext): boolean {
    // Discord interactions and jobs run through the same global guards.
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    // Without the cookie plugin every write would look unauthenticated and skip
    // this check: stop instead of failing open.
    if (request.cookies === undefined) {
      throw new Error('OriginGuard needs @fastify/cookie to be registered');
    }
    if (!carriesLogin(request.cookies)) return true;

    const site = request.headers['sec-fetch-site'];
    if (
      request.headers.origin !== this.allowedOrigin ||
      (site !== undefined && site !== 'same-origin')
    ) {
      throw new ApiError(ErrorCode.AUTH_ORIGIN_REJECTED);
    }
    return true;
  }
}
