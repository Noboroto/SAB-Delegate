import { describe, expect, it } from 'vitest';
import { parseWordsQuery, wordsQueryString } from './words-query';

describe('parseWordsQuery', () => {
  it('reads paging and order from the URL', () => {
    expect(parseWordsQuery({ page: '3', pageSize: '10', sort: 'word', order: 'desc' })).toEqual({
      page: 3,
      pageSize: 10,
      sort: 'word',
      order: 'desc',
    });
  });

  it('starts at the first page in play order when nothing is given', () => {
    expect(parseWordsQuery({})).toEqual({ page: 1, pageSize: 20, sort: 'played', order: 'asc' });
  });

  it('falls back to the defaults for a mangled link instead of failing', () => {
    expect(parseWordsQuery({ page: '-4', sort: 'nope' })).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'played',
      order: 'asc',
    });
  });

  it('takes the first of a repeated parameter', () => {
    expect(parseWordsQuery({ page: ['2', '9'] }).page).toBe(2);
  });
});

describe('wordsQueryString', () => {
  it('writes every field so the URL and the server call agree', () => {
    expect(wordsQueryString({ page: 2, pageSize: 20, sort: 'word', order: 'asc' })).toBe(
      'page=2&pageSize=20&sort=word&order=asc',
    );
  });
});
