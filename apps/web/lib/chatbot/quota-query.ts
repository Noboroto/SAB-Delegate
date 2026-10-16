import { ChatbotQuotaListQuerySchema, type ChatbotQuotaListQuery } from '@sab/shared';

type SearchParams = Record<string, string | string[] | undefined>;

/** Ten rows fit a screen at 1440x900 without the page scrolling past the table. */
const DEFAULT_PAGE_SIZE = 10;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The usage list's query from the page URL. The biggest spenders come first
 * unless the link says otherwise; a mangled `page` or `sort` falls back to
 * that instead of an error page.
 */
export function parseQuotaQuery(searchParams: SearchParams): ChatbotQuotaListQuery {
  const parsed = ChatbotQuotaListQuerySchema.safeParse({
    page: first(searchParams['page']),
    pageSize: first(searchParams['pageSize']) ?? DEFAULT_PAGE_SIZE,
    sort: first(searchParams['sort']) ?? 'used',
    order: first(searchParams['order']) ?? 'desc',
  });
  return parsed.success
    ? parsed.data
    : ChatbotQuotaListQuerySchema.parse({
        pageSize: DEFAULT_PAGE_SIZE,
        sort: 'used',
        order: 'desc',
      });
}

/** The query string the usage route and the page URL share. */
export function quotaQueryString(query: ChatbotQuotaListQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    order: query.order,
  });
  if (query.sort !== undefined) params.set('sort', query.sort);
  return params.toString();
}
