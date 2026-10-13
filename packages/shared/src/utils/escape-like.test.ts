import { describe, expect, it } from 'vitest';
import { escapeLike } from './escape-like.js';

describe('escapeLike', () => {
  it('escapes the wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('Quy tắc chung')).toBe('Quy tắc chung');
    expect(escapeLike('')).toBe('');
  });
});
