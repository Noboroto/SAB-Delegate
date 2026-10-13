import type { Message } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { Context, MessageCommand, TargetMessage, type MessageCommandContext } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { localizations } from '../../i18n/localizations.js';
import { MentionResponder } from './mention.responder.js';

const nonReactorsName = localizations('mention.contextMenu.nonReactors.name');

/**
 * The message context menus of this module (Discord allows five per app; the
 * wave as a whole uses four). Offered to everyone who may use commands, like
 * `/mention`.
 */
@DiscordCommands()
export class MentionContextMenus {
  constructor(private readonly responder: MentionResponder) {}

  /** The slash command's defaults: no reply, no role, members who can see the channel, bots left out. */
  @MessageCommand({
    name: nonReactorsName['en-US'],
    nameLocalizations: nonReactorsName,
    defaultMemberPermissions: PermissionFlagsBits.UseApplicationCommands,
  })
  async onNonReactors(
    @Context() [interaction]: MessageCommandContext,
    @TargetMessage() message: Message,
  ): Promise<void> {
    await this.responder.notReactOf(interaction, message);
  }
}
