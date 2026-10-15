import {
  AUDIT_ACTIONS,
  AuditActionSchema,
  AuditLogPageSchema,
  AuditLogViewSchema,
  ActorSourceSchema,
  z,
  type AuditAction,
} from '@sab/shared';

export const AUDIT_PAGE_SIZE = 20;

/** The server sends `createdAt` as text; the browser and the page both read it as a date. */
export const WebAuditLogPageSchema = AuditLogPageSchema.extend({
  items: z.array(AuditLogViewSchema.extend({ createdAt: z.coerce.date() })),
});

export type WebAuditLogPage = z.infer<typeof WebAuditLogPageSchema>;

export type ActorSource = z.output<typeof ActorSourceSchema>;

export interface AuditLogsFilter {
  action?: AuditAction | undefined;
  source?: ActorSource | undefined;
  cursor?: string | undefined;
}

const CursorSchema = z.uuid();

/** Reads the page's query string; a value the server would refuse is dropped, not shown as an error. */
export function parseAuditLogsFilter(
  params: Record<string, string | string[] | undefined>,
): AuditLogsFilter {
  const action = AuditActionSchema.safeParse(params['action']);
  const source = ActorSourceSchema.safeParse(params['source']);
  const cursor = CursorSchema.safeParse(params['cursor']);
  return {
    ...(action.success ? { action: action.data } : {}),
    ...(source.success ? { source: source.data } : {}),
    ...(cursor.success ? { cursor: cursor.data } : {}),
  };
}

/** `?action=...&source=...&cursor=...` of the logs page for `filter`; empty when there is nothing to keep. */
export function auditLogsQueryString(filter: AuditLogsFilter): string {
  const query = new URLSearchParams();
  if (filter.action !== undefined) query.set('action', filter.action);
  if (filter.source !== undefined) query.set('source', filter.source);
  if (filter.cursor !== undefined) query.set('cursor', filter.cursor);
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

/** Message-catalog key of each stored action value (`guild_config.update` -> `guildConfigUpdate`). */
export const AUDIT_ACTION_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(AUDIT_ACTIONS).map(([key, value]) => [value, key]),
);
