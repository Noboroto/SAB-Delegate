/**
 * How long a login lasts without activity, in seconds (30 days). It is also
 * the session's `freshAge`: Better Auth measures freshness from
 * `session.createdAt`, which never slides while `expiresAt` does, and its
 * default of one day would answer 403 `SESSION_NOT_FRESH` on the fresh-only
 * endpoints for every login older than a day. Using the full lifetime keeps
 * those endpoints usable for as long as the login exists.
 */
export const SESSION_EXPIRES_SECONDS = 60 * 60 * 24 * 30;

/**
 * How often an active login pushes its expiry forward, in seconds (1 day), so
 * a person who keeps using the dashboard is never signed out mid-work.
 */
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/**
 * How long the signed session cookie is trusted before the database is asked
 * again, in seconds. This bounds how long a revoked or deleted session keeps
 * working.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 60;
