import { describe, expect, it } from 'vitest';
import { copyProblem, uploadLimitForChannel, uploadLimitOf } from './message-copy.js';

const MIB = 1024 * 1024;

describe('copyProblem', () => {
  it('lets a message of 2000 characters with small files through', () => {
    expect(
      copyProblem({ content: 'a'.repeat(2000), files: [{ size: 5 * MIB }] }, 10 * MIB),
    ).toBeNull();
  });

  it('refuses text over 2000 characters, which a bot cannot post', () => {
    expect(copyProblem({ content: 'a'.repeat(2001), files: [] }, 10 * MIB)).toBe('TOO_LONG');
  });

  it('refuses files that together exceed the upload limit', () => {
    const files = [{ size: 6 * MIB }, { size: 6 * MIB }];
    expect(copyProblem({ content: '', files }, 10 * MIB)).toBe('FILES_TOO_LARGE');
    expect(copyProblem({ content: '', files }, 50 * MIB)).toBeNull();
  });
});

describe('uploadLimitOf', () => {
  it('follows the boost tier and falls back to the smallest limit', () => {
    expect(uploadLimitOf(0)).toBe(10 * MIB);
    expect(uploadLimitOf(2)).toBe(50 * MIB);
    expect(uploadLimitOf(3)).toBe(100 * MIB);
    expect(uploadLimitOf(undefined)).toBe(10 * MIB);
    expect(uploadLimitOf(9)).toBe(10 * MIB);
  });
});

describe('uploadLimitForChannel', () => {
  it('reads the tier of the channel guild and tolerates channels without one', () => {
    expect(uploadLimitForChannel({ guild: { premiumTier: 2 } })).toBe(50 * MIB);
    expect(uploadLimitForChannel({})).toBe(10 * MIB);
    expect(uploadLimitForChannel(null)).toBe(10 * MIB);
  });
});
