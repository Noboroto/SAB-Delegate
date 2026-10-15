import type { MetadataRoute } from 'next';

/**
 * Meta's preview scraper wants a group of its own: with only a `User-agent: *`
 * group, JudgeHub measured (27/08/2026) the Sharing Debugger reporting 403
 * "could be due to a robots.txt block" while every request it made got 200,
 * and Messenger then showed a bare domain card. Messenger, Facebook,
 * Instagram and WhatsApp share that one cache.
 *
 * Allowing it everywhere exposes nothing: signed-in pages redirect to /login
 * without a session, and the server's guards decide every API answer.
 */
const META_PREVIEW_AGENTS = ['facebookexternalhit', 'Facebot'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...META_PREVIEW_AGENTS.map((userAgent) => ({ userAgent, allow: '/' })),
      // `/` reaches /login through /servers, so a scraper that checks robots.txt
      // at every redirect hop must be allowed there too.
      { userAgent: '*', allow: '/', disallow: ['/api/', '/mcp'] },
    ],
  };
}
