import {
  BotProfileSchema,
  GuildSettingsSchema,
  type BotProfile,
  type GuildSettings,
} from '@sab/shared';
import { ApiRequestError } from '@/lib/api/api-response';
import { serverFetch } from '@/lib/api/server-fetch';
import { guildApiPath } from '@/lib/guild-path';

export interface SettingsPageData {
  settings: GuildSettings;
  /** `undefined` when the bot could not be asked how it looks (restarting, unreachable). */
  botProfile: BotProfile | undefined;
}

/**
 * The server's settings and the bot's name and picture there. The settings
 * are the page, so a failure reaches the route's error screen; the bot's look
 * is read from Discord and may be briefly unavailable, which the page shows
 * in its own section instead of failing as a whole.
 * `guildId` must already be known to be one of the visitor's servers.
 */
export async function getSettingsPageData(guildId: string): Promise<SettingsPageData> {
  const [settings, botProfile] = await Promise.all([
    serverFetch(guildApiPath(guildId, 'settings'), { parser: GuildSettingsSchema }),
    serverFetch(guildApiPath(guildId, 'bot-profile'), { parser: BotProfileSchema }).catch(
      (error: unknown) => {
        if (error instanceof ApiRequestError) return undefined;
        throw error;
      },
    ),
  ]);
  return { settings, botProfile };
}
