export const DEFAULT_AFTER_LOGIN = '/servers';

/**
 * Request header the proxy sets to the path (and query) being rendered, so a
 * server component that must send the visitor to the login page can bring them
 * back. The proxy overwrites any value the browser sent.
 */
export const CURRENT_PATH_HEADER = 'x-current-path';

/**
 * The page to return to after signing in, taken from the `next` query
 * parameter. Only a path on this site is accepted: anything that could leave it
 * (`//host`, `https://host`, `/\host`) or loop back to the login page falls back
 * to the server picker, so the parameter cannot be used as an open redirect.
 */
export function safeNextPath(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !value.startsWith('/')) return DEFAULT_AFTER_LOGIN;
  if (value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_AFTER_LOGIN;
  }
  const path = value.split(/[?#]/, 1)[0] ?? '';
  if (path === '/login' || path === '/auth-error') return DEFAULT_AFTER_LOGIN;
  return value;
}

/**
 * The login page address for a visitor who was reading `current`: it carries
 * the page as `next` unless that is the default destination anyway. The value
 * passes the same check as the login page applies, so a forged header cannot
 * make the login page send anyone elsewhere.
 */
export function loginPathFor(current: string | null | undefined): string {
  const next = safeNextPath(current ?? undefined);
  return next === DEFAULT_AFTER_LOGIN ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
