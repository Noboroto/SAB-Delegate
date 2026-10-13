import { z } from 'zod';
import { PaginationQuerySchema } from './pagination.js';

export const SEARCH_MAX_LENGTH = 100;

/**
 * The one query shape every list endpoint parses from the URL. Sorting is an
 * allowlist of column keys the endpoint passes in: a free-form key would reach
 * the ORM as a column name.
 */
export const ListQuerySchema = <const SortKey extends readonly [string, ...string[]]>(
  sortKeys: SortKey,
) =>
  PaginationQuerySchema.extend({
    sort: z.enum(sortKeys).optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
    q: z.string().trim().max(SEARCH_MAX_LENGTH).optional(),
  });
