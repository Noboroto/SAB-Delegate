import { describe, expect, it } from 'vitest';
import { isBlockedAddress, SafePostError, safePostJson } from './safe-post.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows the public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('safePostJson', () => {
  it.each([
    'http://example.com/v1',
    'https://user:pass@example.com/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://169.254.169.254/latest',
  ])('refuses %s without connecting', async (url) => {
    await expect(safePostJson(url, {}, {}, 1000)).rejects.toEqual(new SafePostError('blocked'));
  });
});
