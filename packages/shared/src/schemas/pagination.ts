import { z } from 'zod';

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/**
 * Bounds `page` so the row offset `(page - 1) * pageSize` stays within a signed
 * 32-bit integer (2^31 - 1), which Postgres OFFSET handling and driver
 * parameters cope with; 2^31 / 100 rows is far beyond any real list.
 */
export const PAGE_MAX = Math.floor((2 ** 31 - 1) / PAGE_SIZE_MAX);

/** Query-string paging; the values arrive as text, hence the coercion. */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(PAGE_MAX).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export const PaginationSchema = z.object({
  page: z.number().int().min(1).max(PAGE_MAX),
  pageSize: z.number().int().min(1).max(PAGE_SIZE_MAX),
  total: z.number().int().min(0),
});

/**
 * List envelope. `pagination` is a sibling of `items` because a parse that
 * strips unknown keys would otherwise drop it.
 */
export const PaginatedSchema = <Item extends z.ZodType>(item: Item) =>
  z.object({
    items: z.array(item),
    pagination: PaginationSchema,
  });
