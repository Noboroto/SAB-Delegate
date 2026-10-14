import { AUDIT_ACTIONS, GuildSettingsPatchSchema, SnowflakeSchema } from '@sab/shared';
import { GuildConfigService } from '../../modules/guild-config/guild-config.service.js';
import { defineTool, type AnyToolRow } from '../tool-definition.js';
import { toolInputSchema } from '../write-guard.js';

const guildId = SnowflakeSchema.describe('Discord id of the server.');

export const GUILD_CONFIG_TOOLS: readonly AnyToolRow[] = [
  defineTool({
    name: 'guild_config_get',
    class: 'R',
    service: 'GuildConfigService.get',
    inputSchema: toolInputSchema('R', { guildId }),
    description:
      "Reads the server's settings: the intro, log and birthday channels, the activity category, the word-game channel and word limit, and the language the bot answers in. Read only, no side effects.",
    handler: ({ args, service }) => service(GuildConfigService).get(args.guildId),
  }),
  defineTool({
    name: 'guild_config_set',
    class: 'C',
    service: 'GuildConfigService.patch',
    inputSchema: toolInputSchema('C', { guildId, ...GuildSettingsPatchSchema.shape }),
    parity: { rest: GuildSettingsPatchSchema },
    description:
      'Changes server settings; only the fields you give are changed, and null clears a channel. Channels must belong to this server and be usable by the bot. Takes effect at once for the bot and the dashboard. It can be undone by setting the previous values again, which dryRun shows under "before". Call with dryRun first to get the confirmToken.',
    audit: AUDIT_ACTIONS.guildConfigUpdate,
    effect: 'change server settings',
    handler: ({ args, dryRun, actor, service }) => {
      const { guildId: id, ...patch } = args;
      return service(GuildConfigService).patch(id, patch, actor, { dryRun });
    },
  }),
];
