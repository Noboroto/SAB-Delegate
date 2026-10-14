type Header = { key: string; value: string };

/**
 * The page-level policy of the dashboard. It cannot be stricter without a
 * per-request nonce: the App Router streams its hydration data in inline
 * `<script>` tags and Ant Design injects `<style>` tags at run time, so
 * `'unsafe-inline'` is what keeps pages working. A nonce would make every page
 * dynamic and is not worth that for a login-gated dashboard that renders no
 * user-written markup (see the markdown rule); the directives that matter here
 * are the ones that need no nonce:
 * - `frame-ancestors 'none'`: nobody can frame the dashboard (clickjacking);
 * - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`: no plugins,
 *   no rewritten relative URLs, no forms posting elsewhere;
 * - `img-src` allows only Discord's CDN, where server icons live.
 *
 * `next dev` evaluates code (`'unsafe-eval'`) and opens a hot-reload socket;
 * the production policy has neither.
 */
export function contentSecurityPolicy(production: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(production ? [] : ["'unsafe-eval'"])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(production ? [] : ['ws:', 'wss:'])],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * Headers for every page. HSTS is production only: sent over plain http on a
 * developer machine or a local compose run it is ignored by browsers, but a
 * preview served over https once would pin `localhost` for a year.
 */
export function securityHeaders(production: boolean): Header[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(production) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
  ];
}
