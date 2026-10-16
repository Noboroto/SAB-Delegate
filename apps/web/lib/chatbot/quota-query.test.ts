import { describe, expect, it } from 'vitest';
import { parseQuotaQuery, quotaQueryString } from './quota-query';

describe('parseQuotaQuery', () => {
  it('lists the biggest spenders first, ten to a page, when the URL says nothing', () => {
    expect(parseQuotaQuery({})).toMatchObject({
      page: 1,
      pageSize: 10,
      sort: 'used',
      order: 'desc',
    });
  });

  it('reads page, size, sort and order from the URL, the first value of a repeated one', () => {
    expect(
      parseQuotaQuery({ page: ['3', '9'], pageSize: '20', sort: 'limit', order: 'asc' }),
    ).toMatchObject({ page: 3, pageSize: 20, sort: 'limit', order: 'asc' });
  });

  it('falls back to the default list for a mangled link instead of failing', () => {
    expect(parseQuotaQuery({ page: 'x', sort: 'password' })).toMatchObject({
      page: 1,
      sort: 'used',
      order: 'desc',
    });
  });
});

describe('quotaQueryString', () => {
  it('writes what the usage route and the page URL share', () => {
    const query = parseQuotaQuery({ page: '2', sort: 'limit', order: 'asc' });
    expect(quotaQueryString(query)).toBe('page=2&pageSize=10&order=asc&sort=limit');
  });

  it('leaves the sort out when there is none', () => {
    expect(quotaQueryString({ page: 1, pageSize: 10, order: 'asc' })).toBe(
      'page=1&pageSize=10&order=asc',
    );
  });
});
