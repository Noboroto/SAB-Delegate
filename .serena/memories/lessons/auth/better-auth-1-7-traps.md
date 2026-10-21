# Better Auth 1.7.7 traps (measured 2026-10-14, server-side, stateless mode; DB mode 2026-10-21)

## DB mode (switched 2026-10-21: prismaAdapter, 30d sliding, owner dropped FreshAuthGuard)
- With a database adapter, 1.7.7 checks at request time that EVERY core table exists. A missing `verification` table means every login returns 500 `BetterAuthError SCHEMA_MISMATCH` ("Missing tables: verification"), even with `storeStateStrategy: 'cookie'`, which writes nothing there. Unit tests with the memory adapter do NOT catch it; only the real-Postgres spec (`auth-sessions.db.spec.ts`, `TEST_REQUIRE_DB=1`) did.
- The `getAccessToken` body is `{ accountId }` or `{ useAccountCookie }` (no `providerId`), so call `listUserAccounts` first. It refreshes within 5 s of expiry and persists Discord's rotated refresh token.
- `advanced.database.generateId: false` plus a Postgres `uuidv7()` default works: the factory omits an undefined id (verified by the DB spec).
- The account table has no `issuer` column in 1.7.7; it is keyed by `(providerId, accountId)`.
- `freshAge` is measured from `createdAt`, which never slides, so set `freshAge = expiresIn` (the JudgeHub incident).


- Stateless: no database → session and account live in encrypted cookies (cookieCache `jwe`, account cookie). No Prisma tables needed (matches the S4 spike). The Discord access token is read server-side only (`SessionService`); keep `/get-access-token` denied so it never reaches the browser.
- `instanceof APIError` is unreliable across module copies — use `isAPIError` from `better-auth/api`.
- `better-auth` and `@better-auth/core` do not export `./package.json`; read version files from disk for the version-pin guard.
- Origin check: Better Auth's own `disableOriginCheck: false` covers `/api/auth/*`; the app's OriginGuard covers other cookie-authenticated writes (strip the `__Secure-` prefix before matching `better-auth.*` cookies; fail closed if @fastify/cookie is missing).
- Mocked cookie total ≈2 KB (limit 3.5 KB); real Discord login, real `/users/@me/guilds` and Traefik header limits are still UNMEASURED — measure in the first live login.
- Tests: `vi.resetModules()` yields a fresh AppModule graph with new guard classes — compare guard identity against the freshly imported classes.
- `GuildActionLimiter` is a hand-written in-memory fixed window (HTTP limits come from @fastify/rate-limit); `rate-limiter-flexible` was considered and rejected as unnecessary for one process.
