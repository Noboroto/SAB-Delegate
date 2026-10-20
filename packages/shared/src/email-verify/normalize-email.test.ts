import { describe, expect, it } from 'vitest';
import { emailDomain, normalizeEmail } from './normalize-email.js';
import { wildcardMatch } from './wildcard-match.js';

describe('normalizeEmail', () => {
  it('trims and lower-cases a valid address', () => {
    expect(normalizeEmail('  Ann.Lee@HCMUS.edu.vn ')).toBe('ann.lee@hcmus.edu.vn');
  });

  it('refuses what is not an address', () => {
    const tooLong = `${'a'.repeat(250)}@x.com`;
    for (const bad of ['', 'plain', 'a@', '@x.com', 'a b@x.com', tooLong]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });

  it('takes the domain after the last @', () => {
    expect(emailDomain('a@b.edu')).toBe('b.edu');
  });
});

describe('wildcardMatch', () => {
  it('matches the whole value, not a part of it', () => {
    expect(wildcardMatch('hcmus.edu.vn', 'hcmus.edu.vn')).toBe(true);
    expect(wildcardMatch('hcmus.edu.vn', 'mail.hcmus.edu.vn')).toBe(false);
    expect(wildcardMatch('edu', 'edu.vn')).toBe(false);
  });

  it('lets * stand for any run, including none', () => {
    expect(wildcardMatch('*.edu', 'hcmus.edu')).toBe(true);
    expect(wildcardMatch('*.edu', '.edu')).toBe(true);
    expect(wildcardMatch('*.edu', 'edu')).toBe(false);
    expect(wildcardMatch('*@hcmus.edu.vn', 'a@hcmus.edu.vn')).toBe(true);
    expect(wildcardMatch('a*b*c', 'axxbyyc')).toBe(true);
    expect(wildcardMatch('a*b*c', 'axxbyy')).toBe(false);
    expect(wildcardMatch('*', '')).toBe(true);
    expect(wildcardMatch('**x', 'abx')).toBe(true);
  });

  it('treats every other character literally', () => {
    expect(wildcardMatch('a.b', 'axb')).toBe(false);
    expect(wildcardMatch('a+b@x', 'a+b@x')).toBe(true);
    expect(wildcardMatch('(a)', '(a)')).toBe(true);
  });

  it('stays fast on a pattern built to blow up a backtracking regex', () => {
    const started = Date.now();
    expect(wildcardMatch('*a*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(5000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
