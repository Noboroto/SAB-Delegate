import { PURGE_COUNT_MAX } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { Context, IntegerOption, StringOption, Subcommand, type SlashCommandContext } from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { localizations } from '../../i18n/localizations.js';
import { PurgeFlow } from './purge.flow.js';

const anyText = localizations('purge.commands.any.description');
const untilText = localizations('purge.commands.untilLinkOption.description');
const fromText = localizations('purge.commands.fromLinkOption.description');
const countText = localizations('purge.commands.countOption.description');

class PurgeAnyOptions {
  @StringOption({
    name: 'until-link',
    description: untilText['en-US'],
    description_localizations: untilText,
    required: false,
  })
  readonly untilLink?: string;

  @StringOption({
    name: 'from-link',
    description: fromText['en-US'],
    description_localizations: fromText,
    required: false,
  })
  readonly fromLink?: string;

  @IntegerOption({
    name: 'count',
    description: countText['en-US'],
    description_localizations: countText,
    required: false,
    min_value: 1,
    max_value: PURGE_COUNT_MAX,
  })
  readonly count?: number;
}

/**
 * `/purge any`. Who may run it is decided by the group's default permission in
 * Discord; nothing is checked here. Every answer is private to the person who
 * ran it, and nothing is deleted until they confirm.
 */
@DiscordCommands()
@CommandGroup.purge()
export class PurgeCommands {
  constructor(private readonly flow: PurgeFlow) {}

  @Subcommand({
    name: 'any',
    description: anyText['en-US'],
    descriptionLocalizations: anyText,
  })
  async onAny(
    @Context() [interaction]: SlashCommandContext,
    @Options() { untilLink, fromLink, count }: PurgeAnyOptions,
  ): Promise<void> {
    // Scanning the channel and deleting outlast the 3 s window for a first reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.flow.runCommand(interaction, {
      ...(untilLink === undefined ? {} : { untilLink }),
      ...(fromLink === undefined ? {} : { fromLink }),
      ...(count === undefined ? {} : { count }),
    });
  }
}
