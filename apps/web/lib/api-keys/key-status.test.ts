import { describe, expect, it } from 'vitest';
import { apiKeyStatus, countActiveKeys } from './key-status';

const NOW = Date.parse('2026-10-14T00:00:00Z');
const DAY = 86_400_000;

describe('apiKeyStatus', () => {
  it('is active before the expiry and with no expiry', () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: new Date(NOW + DAY) }, NOW)).toBe('active');
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, NOW)).toBe('active');
  });

  it('is expired at and after the expiry', () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: new Date(NOW) }, NOW)).toBe('expired');
  });

  it('keeps a revoked key revoked even after its date passed', () => {
    expect(
      apiKeyStatus({ revokedAt: new Date(NOW - DAY), expiresAt: new Date(NOW - 2 * DAY) }, NOW),
    ).toBe('revoked');
  });
});

describe('countActiveKeys', () => {
  it('counts only the active ones', () => {
    const keys = [
      { revokedAt: null, expiresAt: new Date(NOW + DAY) },
      { revokedAt: new Date(NOW), expiresAt: null },
      { revokedAt: null, expiresAt: new Date(NOW - DAY) },
    ];
    expect(countActiveKeys(keys, NOW)).toBe(1);
  });
});
