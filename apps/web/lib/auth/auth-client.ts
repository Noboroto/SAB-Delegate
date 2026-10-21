import { createAuthClient } from 'better-auth/client';
import { DEFAULT_AFTER_LOGIN } from './safe-next';

/** Where Better Auth's server-side errors (denied consent, bad state) land. */
const AUTH_ERROR_PATH = '/auth-error';

type AuthClient = ReturnType<typeof createAuthClient>;
let client: AuthClient | undefined;

/**
 * Better Auth refuses a relative base URL, so it is built from the page's own
 * origin: the request goes to `/api/auth/*` on this site and Next rewrites it
 * to the server. Created on first use, in the browser only.
 */
function authClient(): AuthClient {
  client ??= createAuthClient({ baseURL: `${window.location.origin}/api/auth` });
  return client;
}

/** Thrown when Better Auth answers with an error; the text is the library's, never shown. */
export class AuthClientError extends Error {
  constructor(readonly code: string | undefined) {
    super(`Auth request failed${code === undefined ? '' : ` (${code})`}`);
    this.name = 'AuthClientError';
  }
}

/** Starts the Discord OAuth redirect; resolves when the browser is about to leave the page. */
export async function signInWithDiscord(callbackPath: string = DEFAULT_AFTER_LOGIN): Promise<void> {
  const { error } = await authClient().signIn.social({
    provider: 'discord',
    callbackURL: callbackPath,
    errorCallbackURL: AUTH_ERROR_PATH,
  });
  if (error) throw new AuthClientError(error.code);
}

/** Ends the login (the cookies are cleared by the response) and returns to the login page. */
export async function signOut(): Promise<void> {
  const { error } = await authClient().signOut();
  if (error) throw new AuthClientError(error.code);
  window.location.assign('/login');
}

/**
 * Reads the session through the browser, which is what makes Better Auth slide
 * the expiry and re-issue the cookie once `updateAge` has passed (the server
 * only reads it on page renders, where the response cannot set cookies).
 * Failures are ignored on purpose: other calls already handle a 401.
 */
export async function touchSession(): Promise<void> {
  try {
    await authClient().getSession();
  } catch {
    // Offline or the server restarting: the next focus or page load tries again.
  }
}
