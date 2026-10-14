# Better Auth 1.7.7 traps (measured 2026-10-14, server-side, stateless mode)

- Stateless: no database → session and account live in encrypted cookies (cookieCache `jwe`, account cookie). No Prisma tables needed (matches the S4 spike). The Discord access token is read server-side only (`SessionService`); keep `/get-access-token` denied so it never reaches the browser.
- `instanceof APIError` is unreliable across module copies — use `isAPIError` from `better-auth/api`.
- `better-auth` and `@better-auth/core` do not export `./package.json`; read version files from disk for the version-pin guard.
- Origin check: Better Auth's own `disableOriginCheck: false` covers `/api/auth/*`; the app's OriginGuard covers other cookie-authenticated writes (strip the `__Secure-` prefix before matching `better-auth.*` cookies; fail closed if @fastify/cookie is missing).
- Mocked cookie total ≈2 KB (limit 3.5 KB); real Discord login, real `/users/@me/guilds` and Traefik header limits are still UNMEASURED — measure in the first live login.
- Tests: `vi.resetModules()` yields a fresh AppModule graph with new guard classes — compare guard identity against the freshly imported classes.
- `GuildActionLimiter` is a hand-written in-memory fixed window (HTTP limits come from @fastify/rate-limit); `rate-limiter-flexible` was considered and rejected as unnecessary for one process.
