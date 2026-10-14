import { CommandsQuerySchema } from '@sab/shared';
import { CommandsCatalogService } from '../../modules/system/commands-catalog.service.js';
import { defineTool, type AnyToolRow } from '../tool-definition.js';
import { toolInputSchema } from '../write-guard.js';

export const COMMANDS_TOOLS: readonly AnyToolRow[] = [
  defineTool({
    name: 'commands_list',
    class: 'R',
    service: 'CommandsCatalogService.list',
    inputSchema: toolInputSchema('R', { locale: CommandsQuerySchema.shape.locale }),
    parity: { rest: CommandsQuerySchema },
    description:
      'Lists the slash commands the bot offers: name, description in the chosen language, default permission, whether it is server-only, and subcommand paths. The same for every server. Read only, no side effects.',
    handler: ({ args, service }) =>
      Promise.resolve(service(CommandsCatalogService).list(args.locale)),
  }),
];
