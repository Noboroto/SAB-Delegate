import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ListQuerySchema } from './list-query.js';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, PaginatedSchema } from './pagination.js';
import { SnowflakeSchema } from './snowflake.js';

describe('SnowflakeSchema', () => {
  it('accepts 17 to 20 digits and trims surrounding whitespace', () => {
    expect(SnowflakeSchema.parse('1'.repeat(17))).toBe('1'.repeat(17));
    expect(SnowflakeSchema.parse('9'.repeat(20))).toBe('9'.repeat(20));
    expect(SnowflakeSchema.parse(' 123456789012345678 ')).toBe('123456789012345678');
  });

  it('rejects mentions, empty, short, long and non-string input', () => {
    for (const bad of [
      '<@123456789012345678>',
      '',
      '1'.repeat(16),
      '1'.repeat(21),
      '12345678901234567a',
    ]) {
      expect(SnowflakeSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(SnowflakeSchema.safeParse(123456789012345678n).success).toBe(false);
  });
});

describe('ListQuerySchema', () => {
  const Query = ListQuerySchema(['name', 'createdAt'] as const);

  it('coerces text from the URL and fills the defaults', () => {
    expect(Query.parse({})).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT, order: 'asc' });
    expect(
      Query.parse({ page: '3', pageSize: '50', sort: 'name', order: 'desc', q: ' ab ' }),
    ).toEqual({
      page: 3,
      pageSize: 50,
      sort: 'name',
      order: 'desc',
      q: 'ab',
    });
  });

  it('rejects a sort key outside the allowlist and out-of-range paging', () => {
    expect(Query.safeParse({ sort: 'password' }).success).toBe(false);
    expect(Query.safeParse({ page: '0' }).success).toBe(false);
    expect(Query.safeParse({ pageSize: String(PAGE_SIZE_MAX + 1) }).success).toBe(false);
    expect(Query.safeParse({ page: '1.5' }).success).toBe(false);
  });

  it('strips unknown keys instead of rejecting or passing them on', () => {
    expect(Query.parse({ page: '2', other: 'x' })).not.toHaveProperty('other');
  });
});

describe('PaginatedSchema', () => {
  const Page = PaginatedSchema(z.object({ id: z.string() }));

  it('keeps the pagination sibling and strips extra item fields', () => {
    const parsed = Page.parse({
      items: [{ id: 'a', secret: 'x' }],
      pagination: { page: 1, pageSize: 20, total: 1 },
    });
    expect(parsed).toEqual({
      items: [{ id: 'a' }],
      pagination: { page: 1, pageSize: 20, total: 1 },
    });
  });

  it('rejects an envelope without pagination', () => {
    expect(Page.safeParse({ items: [] }).success).toBe(false);
  });
});
