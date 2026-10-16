import { UseInterceptors } from '@nestjs/common';
import { Context, Subcommand, type SlashCommandContext } from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { localizations } from '../../i18n/localizations.js';
import { MentionResponder } from './mention.responder.js';
import { ByReactionOptions, EveryoneOptions, NotReactOptions } from './mention.options.js';

const byReactionText = localizations('mention.commands.byReaction.description');
const notReactText = localizations('mention.commands.notReact.description');
const everyoneText = localizations('mention.commands.everyone.description');

/**
 * `/mention by-a-reaction|not-react|everyone`. Who may run them is decided by
 * the group's default permission in Discord; nothing is checked here. The
 * conversation lives in `MentionResponder`, which the context menu shares.
 */
@DiscordCommands()
@CommandGroup.mention()
export class MentionCommands {
  constructor(private readonly responder: MentionResponder) {}

  @UseInterceptors(ReactionAutocompleteInterceptor)
  @Subcommand({
    name: 'by-a-reaction',
    description: byReactionText['en-US'],
    descriptionLocalizations: byReactionText,
  })
  async onByReaction(
    @Context() [interaction]: SlashCommandContext,
    @Options() options: ByReactionOptions,
  ): Promise<void> {
    await this.responder.byReaction(interaction, options);
  }

  @Subcommand({
    name: 'not-react',
    description: notReactText['en-US'],
    descriptionLocalizations: notReactText,
  })
  async onNotReact(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role, ...options }: NotReactOptions,
  ): Promise<void> {
    await this.responder.notReact(interaction, { ...options, roleId: role?.id });
  }

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
