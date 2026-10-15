import { LlmSettingsSchema, type LlmSettings } from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import { guildApiPath } from '@/lib/guild-path';

/** The LLM settings as this server's managers may see them; see `LlmSettings.adminServer`. */
export function getLlmSettings(guildId: string): Promise<LlmSettings> {
  return serverFetch(guildApiPath(guildId, 'llm'), { parser: LlmSettingsSchema });
}
