/**
 * Where the Nest server listens inside the stack. The service alias is a
 * constant on purpose: `rewrites()` is evaluated at build time and baked into
 * the routes manifest, so an origin that only exists at runtime would be wrong
 * in the image. `SERVER_INTERNAL_URL` exists for local dev (`localhost:3100`)
 * and must hold the same value at build and at run time.
 */
export const DEFAULT_SERVER_ORIGIN = 'http://sab-server:3100';

export function serverOrigin(): string {
  // `||`: an unset build arg arrives as an empty string.
  return process.env['SERVER_INTERNAL_URL'] || DEFAULT_SERVER_ORIGIN;
}
