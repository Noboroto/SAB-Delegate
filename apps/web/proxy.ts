import { NextResponse, type NextRequest } from 'next/server';
import { CURRENT_PATH_HEADER } from '@/lib/auth/safe-next';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  isSupportedLocale,
} from '@/lib/locale';

/**
 * Better Auth's cookie prefix (`AUTH_COOKIE_PREFIX` in the server). A browser
 * adds `__Secure-` to the names on HTTPS.
 */
const AUTH_COOKIE_PREFIX = 'better-auth';
const COOKIE_NAME_PREFIXES = /^__(?:Secure|Host)-/;

/** Paths that only make sense signed in. */
const PROTECTED_PREFIXES = ['/servers'];

function hasLoginCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(({ name }) =>
      name.replace(COOKIE_NAME_PREFIXES, '').startsWith(`${AUTH_COOKIE_PREFIX}.`),
    );
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Next 16 uses `proxy.ts`, never `middleware.ts`: having both crashes the app.
 *
 * This is an OPTIMISTIC redirect, not an access gate: a visitor with no login
 * cookie skips the round trip to a page that would only answer 401. A forged or
 * expired cookie passes straight through, and the server (the guards in Nest)
 * decides. It deliberately does NOT bounce a logged-in visitor away from
 * `/login`: a stale cookie would then loop between the two pages.
 *
 * It also settles the language on a first visit, so the request config only
 * reads back what was decided here.
 */
export function proxy(request: NextRequest): NextResponse {
  // Client navigations ask for the same page with Next's own `_rsc` parameter,
  // which is not part of the address a person would return to.
  const url = request.nextUrl.clone();
  url.searchParams.delete('_rsc');
  const { pathname } = url;
  const path = `${pathname}${url.search}`;

  if (isProtected(pathname) && !hasLoginCookie(request)) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', path);
    return NextResponse.redirect(login);
  }

  // Set, not appended: whatever the browser sent under this name is replaced.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CURRENT_PATH_HEADER, path);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!isSupportedLocale(request.cookies.get(LOCALE_COOKIE)?.value)) {
    response.cookies.set(LOCALE_COOKIE, DEFAULT_LOCALE, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
      sameSite: 'lax',
      httpOnly: false,
    });
  }
  return response;
}

export const config = {
  // The API is the server's, static assets need no cookie, and the health probe
  // must answer without side effects.
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|healthz).*)'],
};
