import type { ChatbotQuotaListQuery, ChatbotTurnListQuery } from '@sab/shared';
import type { ChatbotHistoryService } from './chatbot-history.service.js';
import type { ChatbotNamesService } from './chatbot-names.service.js';
import type { ChatbotQuotaService } from './chatbot-quota.service.js';

/**
 * The list pages REST and MCP both answer, assembled once so the two cannot
 * drift: the month and the default come from the quota query itself, and the
 * names are resolved for the rows on the page only.
 */
export async function quotaPage(
  quota: Pick<ChatbotQuotaService, 'list'>,
  guildId: string,
  query: ChatbotQuotaListQuery,
) {
  const { items, total, period, defaultLimit } = await quota.list(guildId, query);
  return {
    items,
    pagination: { page: query.page, pageSize: query.pageSize, total },
    period,
    defaultLimit,
  };
}

export async function turnPage(
  history: Pick<ChatbotHistoryService, 'list'>,
  guildId: string,
  query: ChatbotTurnListQuery,
) {
  const { items, total } = await history.list(guildId, query);
  return { items, pagination: { page: query.page, pageSize: query.pageSize, total } };
}

/** Each row with the member's server name, `null` when it could not be found. */
export async function withDisplayNames<Row extends { userId: string }>(
  names: Pick<ChatbotNamesService, 'resolve'>,
  guildId: string,
  rows: readonly Row[],
): Promise<(Row & { displayName: string | null })[]> {
  const found = await names.resolve(guildId, [...new Set(rows.map((row) => row.userId))]);
  return rows.map((row) => ({ ...row, displayName: found.get(row.userId) ?? null }));
}
