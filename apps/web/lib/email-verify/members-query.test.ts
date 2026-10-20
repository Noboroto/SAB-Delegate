import { describe, expect, it } from 'vitest';
import { membersQueryString, parseMembersQuery } from './members-query';

describe('members query', () => {
  it('lists the newest first, ten to a page, unless the link says otherwise', () => {
    expect(parseMembersQuery({})).toMatchObject({
      page: 1,
      pageSize: 10,
      sort: 'verifiedAt',
      order: 'desc',
    });
    expect(
      parseMembersQuery({ page: '3', sort: 'domain', order: 'asc', q: ' edu ' }),
    ).toMatchObject({
      page: 3,
      sort: 'domain',
      order: 'asc',
      q: 'edu',
    });
  });

  it('falls back to the default for a mangled link', () => {
    expect(parseMembersQuery({ page: '0', sort: 'email' })).toMatchObject({
      page: 1,
      sort: 'verifiedAt',
    });
  });

  it('writes the query string the route and the URL share', () => {
    const query = parseMembersQuery({ page: '2', q: 'edu' });
    expect(membersQueryString(query)).toBe('page=2&pageSize=10&order=desc&sort=verifiedAt&q=edu');
  });
});
