import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secret-box.js';

const SECRET = 'a'.repeat(40);

describe('secret box', () => {
  it('reads back what it stored, and never stores the plain text', () => {
    const stored = encryptSecret('sk-test-1234', SECRET);
    expect(stored).toMatch(/^v1:/u);
    expect(stored).not.toContain('sk-test-1234');
    expect(decryptSecret(stored, SECRET)).toBe('sk-test-1234');
  });

  it('gives two encryptions of one key different texts', () => {
    expect(encryptSecret('k', SECRET)).not.toBe(encryptSecret('k', SECRET));
  });

  it('answers null after the secret changed or the value was damaged', () => {
    const stored = encryptSecret('sk-test-1234', SECRET);
    expect(decryptSecret(stored, 'b'.repeat(40))).toBeNull();
    expect(decryptSecret(`${stored.slice(0, -4)}AAAA`, SECRET)).toBeNull();
    expect(decryptSecret('garbage', SECRET)).toBeNull();
  });
});
