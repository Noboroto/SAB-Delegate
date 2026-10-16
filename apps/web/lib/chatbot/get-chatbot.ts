import {
  ChatbotConfigSchema,
  ChatbotQuotaPageSchema,
  ChatbotTurnPageSchema,
  type ChatbotConfig,
  type ChatbotQuotaListQuery,
  type ChatbotQuotaPage,
  type ChatbotTurnListQuery,
  type ChatbotTurnPage,
} from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import { guildApiPath } from '@/lib/guild-path';
import { quotaQueryString } from './quota-query';
import { turnsQueryString } from './turns-query';

/** The chatbot's switch, limit, channels and model as this server's managers may see them. */
export function getChatbotConfig(guildId: string): Promise<ChatbotConfig> {
  return serverFetch(guildApiPath(guildId, 'chatbot'), { parser: ChatbotConfigSchema });
}

/** One page of this month's usage, with the month and the default limit it is counted against. */
export function getChatbotQuota(
  guildId: string,
  query: ChatbotQuotaListQuery,
): Promise<ChatbotQuotaPage> {
  return serverFetch(`${guildApiPath(guildId, 'chatbot', 'quota')}?${quotaQueryString(query)}`, {
    parser: ChatbotQuotaPageSchema,
  });
}

/** One page of the exchanges the bot logged, newest first unless asked otherwise. */
export function getChatbotTurns(
  guildId: string,
  query: ChatbotTurnListQuery,
): Promise<ChatbotTurnPage> {
  return serverFetch(`${guildApiPath(guildId, 'chatbot', 'turns')}?${turnsQueryString(query)}`, {
    parser: ChatbotTurnPageSchema,
  });
}
