import { describe, expect, it } from 'vitest';
import { LOCAL_SITE_URL, siteUrl } from './site-url';

describe('siteUrl', () => {
  it('reduces SITE_URL to its origin', () => {
    expect(siteUrl({ SITE_URL: 'https://bot.example.test/servers?x=1' }).href).toBe(
      'https://bot.example.test/',
    );
  });

  it.each([undefined, '', 'not a url'])('falls back to the local address for %j', (value) => {
    expect(siteUrl({ SITE_URL: value }).href).toBe(`${LOCAL_SITE_URL}/`);
  });
});
