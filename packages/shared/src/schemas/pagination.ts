import { z } from 'zod';

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/** Query-string paging; the values arrive as text, hence the coercion. */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export const PaginationSchema = z.object({
  page: z.number().int().min(1),
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
