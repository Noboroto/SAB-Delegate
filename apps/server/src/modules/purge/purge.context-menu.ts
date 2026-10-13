import { MessageFlags, PermissionFlagsBits, type Message } from 'discord.js';
import { Context, MessageCommand, TargetMessage, type MessageCommandContext } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { localizations } from '../../i18n/localizations.js';
import { PurgeFlow } from './purge.flow.js';

const menuName = localizations('purge.contextMenu.name');

/**
 * "Purge up to here" on a message: deletes every message newer than it, up to
 * the latest, after the same preview and confirmation as `/purge any`. The
 * clicked message itself stays, exactly like the message named by `until-link`
 * of `/purge any`, which has always been exclusive (the `from-link` end is the
 * included one). Visible by default to the same people as `/purge`.
 */
@DiscordCommands()
export class PurgeContextMenu {
  constructor(private readonly flow: PurgeFlow) {}

  @MessageCommand({
    name: menuName['en-US'],
    nameLocalizations: menuName,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  })
  async onPurgeUpToHere(
    @Context() [interaction]: MessageCommandContext,
    @TargetMessage() message: Message,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.flow.run(interaction, {
      kind: 'range',
      channelId: message.channelId,
      untilMessageId: message.id,
    });
  }
}
