import { CommandCatalogEntrySchema, z, type CommandCatalogEntry } from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import type { SupportedLocale } from '@/lib/locale';
import { guildApiPath } from '@/lib/guild-path';

/** The bot's slash commands with descriptions in the visitor's language. */
export function getCommands(
  guildId: string,
  locale: SupportedLocale,
): Promise<CommandCatalogEntry[]> {
  return serverFetch(`${guildApiPath(guildId, 'commands')}?locale=${locale}`, {
    parser: z.array(CommandCatalogEntrySchema),
  });
}
