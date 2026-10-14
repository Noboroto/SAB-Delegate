import { describe, expect, it } from 'vitest';
import {
  API_KEY_READ_DEFAULT_DAYS,
  API_KEY_WRITE_DEFAULT_DAYS,
  ApiKeyMintResultSchema,
  ApiKeyMintSchema,
  ApiKeyViewSchema,
} from './api-key.js';

describe('ApiKeyMintSchema', () => {
  it('gives a read key 90 days and reads by default', () => {
    expect(ApiKeyMintSchema.parse({ name: 'ci' })).toEqual({
      name: 'ci',
      mode: 'READ',
      expiresInDays: API_KEY_READ_DEFAULT_DAYS,
    });
  });

  it('gives a write key 30 days', () => {
    expect(ApiKeyMintSchema.parse({ name: 'ci', mode: 'WRITE' }).expiresInDays).toBe(
      API_KEY_WRITE_DEFAULT_DAYS,
    );
  });

  it.each([
    ['READ', 365, true],
    ['READ', 366, false],
    ['WRITE', 30, true],
    ['WRITE', 31, false],
    ['READ', 0, false],
    ['READ', 1.5, false],
  ] as const)('%s key for %s days: accepted %s', (mode, days, accepted) => {
    expect(ApiKeyMintSchema.safeParse({ name: 'k', mode, expiresInDays: days }).success).toBe(
      accepted,
    );
  });

  it('trims the name and refuses an empty or long one', () => {
    expect(ApiKeyMintSchema.parse({ name: '  agent  ' }).name).toBe('agent');
    expect(ApiKeyMintSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(ApiKeyMintSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('strips fields it does not know', () => {
    const parsed = ApiKeyMintSchema.parse({ name: 'k', keyHash: 'abc', discordUserId: '1' });
    expect(Object.keys(parsed).sort()).toEqual(['expiresInDays', 'mode', 'name']);
  });
});

const ROW = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  discordUserId: '1'.repeat(18),
  name: 'ci',
  prefix: 'sab_AbCd',
  keyHash: 'f'.repeat(64),
  mode: 'READ',
  lastUsedIp: null,
  lastUsedAt: null,
  expiresAt: new Date('2027-01-01T00:00:00Z'),
  revokedAt: null,
  createdAt: new Date('2026-10-14T00:00:00Z'),
};

describe('ApiKeyViewSchema', () => {
  it('shows the listing columns and never the hash or the owner', () => {
    const view = ApiKeyViewSchema.parse(ROW);
    expect(view).toEqual({
      id: ROW.id,
      name: 'ci',
      prefix: 'sab_AbCd',
      mode: 'READ',
      lastUsedIp: null,
      lastUsedAt: null,
      expiresAt: ROW.expiresAt,
      revokedAt: null,
      createdAt: ROW.createdAt,
    });
    expect(view).not.toHaveProperty('keyHash');
    expect(view).not.toHaveProperty('discordUserId');
  });

  it('reads the ISO dates the API sends back', () => {
    const view = ApiKeyViewSchema.parse({ ...ROW, expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(view.expiresAt).toEqual(ROW.expiresAt);
  });
});

describe('ApiKeyMintResultSchema', () => {
  it('adds the plaintext to the listing columns', () => {
    const result = ApiKeyMintResultSchema.parse({ ...ROW, plaintext: 'sab_secret' });
    expect(result.plaintext).toBe('sab_secret');
    expect(result).not.toHaveProperty('keyHash');
  });
});
