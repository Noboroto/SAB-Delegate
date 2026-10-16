import { ChatbotTurnListQuerySchema, type ChatbotTurnListQuery } from '@sab/shared';

type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_PAGE_SIZE = 10;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A filter that is not valid is dropped, so one mangled field does not throw the others away. */
function parseFiltered(raw: Record<string, string | undefined>): ChatbotTurnListQuery {
  const parsed = ChatbotTurnListQuerySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const blamed = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
  const kept = Object.fromEntries(Object.entries(raw).filter(([key]) => !blamed.has(key)));
  const retry = ChatbotTurnListQuerySchema.safeParse(kept);
  return retry.success
    ? retry.data
    : ChatbotTurnListQuerySchema.parse({ pageSize: DEFAULT_PAGE_SIZE });
}

/** The history list's query from the page URL; newest first unless the link says otherwise. */
export function parseTurnsQuery(searchParams: SearchParams): ChatbotTurnListQuery {
  const raw: Record<string, string | undefined> = {};
  for (const key of ['page', 'pageSize', 'order', 'userId', 'channelId', 'status', 'from', 'to']) {
    const value = first(searchParams[key]);
    if (value !== undefined && value !== '') raw[key] = value;
  }
  raw['pageSize'] ??= String(DEFAULT_PAGE_SIZE);
  return parseFiltered(raw);
}

/** The query string the history route and the page URL share; only the filters that are set. */
export function turnsQueryString(query: ChatbotTurnListQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    order: query.order,
  });
  if (query.userId !== undefined) params.set('userId', query.userId);
  if (query.channelId !== undefined) params.set('channelId', query.channelId);
  if (query.status !== undefined) params.set('status', query.status);
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  return params.toString();
}

/** Whether any filter narrows the list, which decides the wording of an empty table. */
export function hasTurnFilter(query: ChatbotTurnListQuery): boolean {
  return (
    query.userId !== undefined ||
    query.channelId !== undefined ||
    query.status !== undefined ||
    query.from !== undefined ||
    query.to !== undefined
  );
}
