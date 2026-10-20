import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMAIL_CODE_LENGTH } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { EmailCryptoService, hashCode, hashEmail, newCode, sameHash } from './email-crypto.js';

const secret = randomBytes(24).toString('hex');
const other = randomBytes(24).toString('hex');
const PENDING = '0190a000-0000-7000-8000-000000000001';

describe('hashEmail', () => {
  it('is a stable keyed hex hash that depends on the secret', () => {
    const hash = hashEmail('a@example.test', secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail('a@example.test', secret)).toBe(hash);
    expect(hashEmail('a@example.test', other)).not.toBe(hash);
    expect(hashEmail('b@example.test', secret)).not.toBe(hash);
  });
});

describe('hashCode', () => {
  it('binds the code to the pending row', () => {
    const hash = hashCode(PENDING, '123456', secret);
    expect(hashCode(PENDING, '123456', secret)).toBe(hash);
    expect(hashCode(PENDING.replace(/1$/, '2'), '123456', secret)).not.toBe(hash);
    expect(hashCode(PENDING, '123457', secret)).not.toBe(hash);
  });
});

describe('sameHash', () => {
  it('compares equal and unequal hashes, of any length', () => {
    expect(sameHash('abc', 'abc')).toBe(true);
    expect(sameHash('abc', 'abd')).toBe(false);
    expect(sameHash('abc', 'abcd')).toBe(false);
  });
});

describe('newCode', () => {
  it('is always the configured number of digits, zero padded', () => {
    for (let i = 0; i < 200; i += 1)
      expect(newCode()).toMatch(new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`));
  });
});

describe('EmailCryptoService', () => {
  const service = new EmailCryptoService({ secret, adminGuildId: '1' });

  it('encrypts and reads back, and gives null for a value another secret sealed', () => {
    const sealed = service.encrypt('a@example.test');
    expect(sealed).not.toContain('example');
    expect(service.decrypt(sealed)).toBe('a@example.test');
    expect(new EmailCryptoService({ secret: other, adminGuildId: '1' }).decrypt(sealed)).toBeNull();
  });

  it('is unavailable without the secret', () => {
    const bare = new EmailCryptoService({ secret: undefined, adminGuildId: '1' });
    expect(bare.available).toBe(false);
    expect(bare.decrypt('v1:x:y:z')).toBeNull();
    expect(() => bare.hashEmail('a@example.test')).toThrow(ServiceError);
    try {
      bare.encrypt('x');
    } catch (error) {
      expect((error as ServiceError).code).toBe('EMAIL_VERIFY_UNAVAILABLE');
    }
  });
});
