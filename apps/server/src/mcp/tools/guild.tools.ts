import { GuildPickerItemSchema, z } from '@sab/shared';
import { Client } from 'discord.js';
import { GuildAccessService } from '../../common/guild-access/guild-access.service.js';
import { defineTool, type AnyToolRow } from '../tool-definition.js';
import { toolInputSchema } from '../write-guard.js';

/** The bot sits in a handful of servers; the cap bounds the Discord lookups one call can start. */
const MAX_GUILDS_CHECKED = 100;

export const GUILD_TOOLS: readonly AnyToolRow[] = [
  defineTool({
    name: 'guild_list',
    class: 'R',
    // A key carries no Discord login, so the OAuth server list is not available:
    // the answer is the bot's own servers filtered by the same Manage Server
    // check every other tool applies to the key's owner.
    service: 'GuildAccessService.canManage',
    inputSchema: toolInputSchema('R', {}),
    description:
      'Lists the Discord servers the bot is in where the owner of this API key has Manage Server. Returns id, name and icon hash of each; use the id as guildId in the other tools. Read only, no side effects.',
    handler: async ({ caller, service }) => {
      const access = service(GuildAccessService);
      const guilds = [...service(Client).guilds.cache.values()].slice(0, MAX_GUILDS_CHECKED);
      const checked = await Promise.all(
        guilds.map(async (guild) =>
          (await access.canManage(caller.discordUserId, guild.id))
            ? { id: guild.id, name: guild.name, icon: guild.icon }
            : null,
        ),
      );
      return z.array(GuildPickerItemSchema).parse(checked.filter((item) => item !== null));
    },
  }),
];
