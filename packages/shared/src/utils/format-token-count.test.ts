import { describe, expect, it } from 'vitest';
import { formatTokenCount } from './format-token-count.js';

describe('formatTokenCount', () => {
  it('groups thousands with a dot in vi and a comma in en', () => {
    expect(formatTokenCount(12_345, 'vi')).toBe('12.345');
    expect(formatTokenCount(12_345, 'en')).toBe('12,345');
  });

  it('leaves small numbers and zero alone', () => {
    expect(formatTokenCount(0, 'vi')).toBe('0');
    expect(formatTokenCount(999, 'en')).toBe('999');
  });

  it('groups the largest allowed amount', () => {
    expect(formatTokenCount(1_000_000_000, 'vi')).toBe('1.000.000.000');
    expect(formatTokenCount(1_000_000_000, 'en')).toBe('1,000,000,000');
  });
});
