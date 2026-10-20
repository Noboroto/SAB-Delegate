import { EmailMemberListQuerySchema, type EmailMemberListQuery } from '@sab/shared';

type SearchParams = Record<string, string | string[] | undefined>;

/** Ten rows fit a screen at 1440x900 without the page scrolling past the table. */
const DEFAULT_PAGE_SIZE = 10;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function fallback(): EmailMemberListQuery {
  return EmailMemberListQuerySchema.parse({
    pageSize: DEFAULT_PAGE_SIZE,
    sort: 'verifiedAt',
    order: 'desc',
  });
}

/**
 * The member list's query from the page URL. The newest come first unless the
 * link says otherwise; a mangled value falls back to that instead of an error page.
 */
export function parseMembersQuery(searchParams: SearchParams): EmailMemberListQuery {
  const parsed = EmailMemberListQuerySchema.safeParse({
    page: first(searchParams['page']),
    pageSize: first(searchParams['pageSize']) ?? DEFAULT_PAGE_SIZE,
    sort: first(searchParams['sort']) ?? 'verifiedAt',
    order: first(searchParams['order']) ?? 'desc',
    q: first(searchParams['q']) || undefined,
  });
  return parsed.success ? parsed.data : fallback();
}

/** The query string the members route and the page URL share. */
export function membersQueryString(query: EmailMemberListQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    order: query.order,
  });
  if (query.sort !== undefined) params.set('sort', query.sort);
  if (query.q !== undefined && query.q !== '') params.set('q', query.q);
  return params.toString();
}
