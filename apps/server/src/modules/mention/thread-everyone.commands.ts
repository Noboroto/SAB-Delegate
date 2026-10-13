import { Context, Options, Subcommand, type SlashCommandContext } from 'necord';
import { ThreadGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { localizations } from '../../i18n/localizations.js';
import { EveryoneOptions } from './mention.options.js';
import { MentionResponder } from './mention.responder.js';

const everyoneText = localizations('mention.commands.everyone.description');

/**
 * `/thread everyone`: the same command as `/mention everyone`, mounted on the
 * `thread` group too because both have always existed. The group's other
 * subcommands belong to the thread module.
 */
@DiscordCommands()
@ThreadGroup()
export class ThreadEveryoneCommands {
  constructor(private readonly responder: MentionResponder) {}

  @Subcommand({
    name: 'everyone',
    description: everyoneText['en-US'],
    descriptionLocalizations: everyoneText,
  })
  async onEveryone(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: EveryoneOptions,
  ): Promise<void> {
    await this.responder.everyone(interaction, options);
  }
}
