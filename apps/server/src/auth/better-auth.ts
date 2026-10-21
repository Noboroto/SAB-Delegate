import {
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_EXPIRES_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from '@sab/shared';
import { betterAuth } from 'better-auth';
import type { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { RestSettings } from '../config/env.js';

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

/** What `database` takes here: an adapter instance, the Prisma one or the in-memory one of a test. */
export type AuthDatabase = ReturnType<typeof prismaAdapter>;

/**
 * Better Auth with logins in the database (`database` is the Prisma adapter in
 * the application). A login is a `Session` row that slides forward while the
 * person is active, and the Discord tokens live in `Account`, encrypted, so a
 * rotated Discord refresh token persists: a cookie only a server-side call
 * could rewrite cannot hold it. A session can be revoked by deleting its row;
 * the signed cookie cache bounds how long a deleted session keeps working.
 * Row ids come from the database (`uuidv7()`), not from Better Auth; only a
 * test with an in-memory `database`, which has no default for an id, passes
 * its own generator.
 */
export function createAuth(
  settings: RestSettings,
  database: AuthDatabase,
  generateId: false | (() => string) = false,
) {
  return betterAuth({
    appName: 'SAB',
    baseURL: settings.appUrl,
    secret: settings.authSecret,
    trustedOrigins: [settings.appUrl],
    database,
    session: {
      expiresIn: SESSION_EXPIRES_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      freshAge: SESSION_EXPIRES_SECONDS,
      // `refreshCache: false` (the default, pinned): a re-signed cache would keep a
      // deleted session alive past the 60 s revocation bound.
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS, refreshCache: false },
    },
    // The OAuth state rides an encrypted cookie, so nothing is written to `Verification`;
    // the table must still exist, Better Auth checks the schema at startup.
    // The Discord tokens are real credentials: encrypted at rest.
    account: { storeStateStrategy: 'cookie', encryptOAuthTokens: true },
    // `/error` is behind the default-deny list, so errors land on a web page.
    onAPIError: { errorURL: `${settings.appUrl}/auth-error` },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      database: { generateId },
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
