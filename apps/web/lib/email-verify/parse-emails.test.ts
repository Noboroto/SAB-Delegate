import { EMAIL_ADDRESS_MAX } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { chunk, parseEmailText } from './parse-emails';

describe('parseEmailText', () => {
  it('splits on white space, commas and semicolons and drops quotes', () => {
    expect(parseEmailText('a@x.com, "b@x.com";\n<c@x.com>\td@x.com').emails).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
    ]);
  });

  it('keeps one of each address regardless of case and counts what is not an address', () => {
    expect(parseEmailText('email,name\nA@x.com,An\na@X.com,Binh')).toEqual({
      emails: ['A@x.com'],
      ignored: 4,
    });
  });

  it('splits on a pipe too', () => {
    expect(parseEmailText('a@x.com|b@x.com | c@x.com').emails).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ]);
  });

  it('counts a piece longer than an address as not an address', () => {
    const long = `${'a'.repeat(EMAIL_ADDRESS_MAX)}@x.com`;
    expect(parseEmailText(`${long} ok@x.com`)).toEqual({ emails: ['ok@x.com'], ignored: 1 });
  });

  it('gives nothing for empty text', () => {
    expect(parseEmailText('  \n ')).toEqual({ emails: [], ignored: 0 });
  });
});

describe('chunk', () => {
  it('splits into runs of at most the size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
