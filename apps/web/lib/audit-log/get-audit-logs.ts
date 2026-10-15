import { serverFetch } from '@/lib/api/server-fetch';
import {
  AUDIT_PAGE_SIZE,
  WebAuditLogPageSchema,
  type AuditLogsFilter,
  type WebAuditLogPage,
} from './audit-logs';
import { guildApiPath } from '@/lib/guild-path';

export function getAuditLogs(guildId: string, filter: AuditLogsFilter): Promise<WebAuditLogPage> {
  const query = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
  if (filter.action !== undefined) query.set('action', filter.action);
  if (filter.source !== undefined) query.set('source', filter.source);
  if (filter.cursor !== undefined) query.set('cursor', filter.cursor);
  return serverFetch(`${guildApiPath(guildId, 'audit-logs')}?${query.toString()}`, {
    parser: WebAuditLogPageSchema,
  });
}
