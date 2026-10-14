import { WordGameWordsQuerySchema, type WordGameWordsQuery } from '@sab/shared';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The words list's query from the page URL. A link with a mangled `page` or `sort`
 * falls back to the first page in play order instead of an error page.
 */
export function parseWordsQuery(searchParams: SearchParams): WordGameWordsQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const parsed = WordGameWordsQuerySchema.safeParse({
    page: first(searchParams['page']),
    pageSize: first(searchParams['pageSize']),
    sort: first(searchParams['sort']),
    order: first(searchParams['order']),
  });
  return parsed.success ? parsed.data : WordGameWordsQuerySchema.parse({});
}

/** The query string the words route and the page URL share. */
export function wordsQueryString(query: WordGameWordsQuery): string {
  return new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    order: query.order,
  }).toString();
}
