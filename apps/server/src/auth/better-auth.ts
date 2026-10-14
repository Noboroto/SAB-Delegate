import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { RestSettings } from '../config/env.js';

/** Absolute lifetime of a login. Writes that matter ask for a newer one (`FreshAuthGuard`). */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * Prefix of every cookie Better Auth sets. Fixed here so the Origin guard can
 * recognise "this request is authenticated by cookie" by the same constant.
 */
export const AUTH_COOKIE_PREFIX = 'better-auth';

/** Injection token for the Better Auth instance. */
export const AUTH = Symbol('AUTH');

/** Injection token for the validated REST settings (`restSettingsOf`). */
export const REST_SETTINGS = Symbol('REST_SETTINGS');

/**
 * Default-deny: the only Better Auth endpoints reachable over HTTP. `ctx.path`
 * is the route pattern without the `/api/auth` base, so the callback is always
 * `/callback/:id`. Everything else (`/update-user`, `/sign-up/*`,
 * `/link-social`, `/get-access-token` that returns the Discord token to the
 * browser, ...) answers 404. In-process `auth.api.*` calls carry no
 * `ctx.request` and are not affected.
 */
export const ALLOWED_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/social',
  '/callback/:id',
  '/get-session',
  '/sign-out',
]);

/** User fields a request must never change; `discordId` is the identity the guards trust. */
const PROTECTED_USER_FIELDS = ['name', 'image', 'discordId'] as const;

/**
 * Stateless Better Auth: no `database`, so the whole login lives in encrypted
 * cookies and nothing about a person is stored. Without a database Better Auth
 * forces `cookieCache` (jwe) and `storeAccountCookie`; the Discord access token
 * used for the server picker stays in the encrypted `account_data` cookie and
 * is read server-side only (`SessionService.discordAccessToken`). A stolen
 * cookie cannot be revoked before it expires; the 8 hour lifetime and the
 * fresh-login requirement on important writes bound that.
 */
export function createAuth(settings: RestSettings) {
  return betterAuth({
    appName: 'SAB',
    baseURL: settings.appUrl,
    secret: settings.authSecret,
    trustedOrigins: [settings.appUrl],
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      // `maxAge` must not outlive the session, and `refreshCache: false` keeps
      // the expiry absolute: reading the cookie never extends it.
      cookieCache: {
        enabled: true,
        strategy: 'jwe',
        maxAge: SESSION_TTL_SECONDS,
        refreshCache: false,
      },
    },
    account: { storeStateStrategy: 'cookie', storeAccountCookie: true },
    // `/error` is behind the default-deny list, so errors land on a web page.
    onAPIError: { errorURL: `${settings.appUrl}/auth-error` },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      // The origin check is skipped by default when NODE_ENV=test, which would
      // make a test with a foreign Origin pass by luck.
      disableOriginCheck: false,
      // Without the hop list a multi-hop X-Forwarded-For is dropped and every
      // request shares one rate-limit address.
      ipAddress:
        settings.trustedProxies.length > 0 ? { trustedProxies: [...settings.trustedProxies] } : {},
    },
    user: {
      additionalFields: {
        // `input: true` is required: the provider profile mapping is discarded
        // for `input: false` fields. Nothing can write it afterwards: the
        // endpoints that would are denied below.
        discordId: { type: 'string', required: true, input: true },
      },
    },
    databaseHooks: {
      user: {
        update: {
          before: (data) =>
            Promise.resolve(
              PROTECTED_USER_FIELDS.some((field) => field in data) ? false : { data },
            ),
        },
      },
    },
    socialProviders: {
      discord: {
        clientId: settings.discordClientId,
        clientSecret: settings.discordClientSecret,
        // The default scope adds `email`; the dashboard needs the identity and
        // the guild list, nothing else.
        disableDefaultScope: true,
        scope: ['identify', 'guilds'],
        // Name and avatar are not stored. The user model requires an email, so
        // a non-routable placeholder derived from the snowflake stands in.
        // `image: undefined` is explicit: the provider's own avatar URL is
        // spread into the user before this result otherwise.
        mapProfileToUser: (profile) => ({
          name: '',
          image: undefined,
          email: `${profile.id}@discord.invalid`,
          emailVerified: false,
          discordId: profile.id,
        }),
      },
    },
    hooks: {
      before: createAuthMiddleware((ctx) => {
        if (ctx.request && !ALLOWED_AUTH_PATHS.has(ctx.path)) {
          throw new APIError('NOT_FOUND', { message: 'Not Found' });
        }
        return Promise.resolve();
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
