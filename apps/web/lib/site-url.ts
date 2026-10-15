/** Where `next dev` and `next start` listen when no public address is configured. */
export const LOCAL_SITE_URL = 'http://localhost:3101';

/**
 * The dashboard's public origin, from `SITE_URL`. Compose fills it from the
 * server's `APP_URL`, a name kept to the server because it switches REST on.
 * Link-preview scrapers (Messenger, Facebook, Zalo) ignore a relative
 * `og:image`, so metadata needs an absolute base. Read at request time, never
 * inlined at build, so one image serves every domain. A malformed value falls
 * back to the local address instead of breaking every page's metadata.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  try {
    return new URL(new URL(env['SITE_URL'] || LOCAL_SITE_URL).origin);
  } catch {
    return new URL(LOCAL_SITE_URL);
  }
}
