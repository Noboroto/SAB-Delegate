import { describe, expect, it } from 'vitest';
import { PrincipalSchema } from './principal.js';

const VALID = {
  discordUserId: '1'.repeat(18),
  apiKeyId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  mode: 'READ',
};

describe('PrincipalSchema', () => {
  it('accepts a person, a key and a mode', () => {
    expect(PrincipalSchema.parse(VALID)).toEqual(VALID);
  });

  it('strips fields it does not know instead of keeping them', () => {
    expect(PrincipalSchema.parse({ ...VALID, keyHash: 'abc' })).toEqual(VALID);
  });

  it.each([
    ['a mode that does not exist', { mode: 'ADMIN' }],
    ['an id that is not a snowflake', { discordUserId: 'someone' }],
    ['a key id that is not a uuid', { apiKeyId: '42' }],
  ])('rejects %s', (_label, override) => {
    expect(PrincipalSchema.safeParse({ ...VALID, ...override }).success).toBe(false);
  });
});
