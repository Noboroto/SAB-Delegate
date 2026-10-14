export const DEFAULT_AFTER_LOGIN = '/servers';

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
