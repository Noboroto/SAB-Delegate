import { describe, expect, it } from 'vitest';
import { DEFAULT_AFTER_LOGIN, safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('keeps a path on this site, query and fragment included', () => {
    expect(safeNextPath('/servers/123/logs?page=2#top')).toBe('/servers/123/logs?page=2#top');
  });

  it.each([
    undefined,
    '',
    'servers',
    '//evil.example',
    '///evil.example',
    'https://evil.example/servers',
    'javascript:alert(1)',
    '/\\evil.example',
    '/servers\nSet-Cookie: a=b',
    '/login',
    '/login?next=/servers',
    '/auth-error',
  ])('falls back to the picker for %j', (value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it('uses the first value of a repeated parameter', () => {
    expect(safeNextPath(['/servers/1', '//evil.example'])).toBe('/servers/1');
    expect(safeNextPath(['//evil.example', '/servers/1'])).toBe(DEFAULT_AFTER_LOGIN);
  });
});
