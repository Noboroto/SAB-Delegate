import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { Context, MessageCommand, type MessageCommandContext } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { showModalFirst } from '../../discord/helpers/modal.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { buildEditModal, buildSendModal } from './messaging.modals.js';

const editName = localizations('messaging.contextMenus.edit.name');
const replyName = localizations('messaging.contextMenus.reply.name');

/**
 * Offered to the people who may use `/bot-message`, which is the same power:
 * speaking, or changing what was said, in the bot's name.
 */
const MENU_PERMISSIONS = PermissionFlagsBits.Administrator;

/**
 * The message menus "Edit bot message" and "Reply as bot". Both answer with a
 * dialog, which has to be the first response, so nothing is read or deferred
 * before it; the dialog's submission does the work (see `MessagingModals`).
 */
@DiscordCommands()
export class MessagingContextMenus {
  constructor(private readonly locales: GuildLocaleService) {}

  @MessageCommand({
    name: editName['en-US'],
    nameLocalizations: editName,
    defaultMemberPermissions: MENU_PERMISSIONS,
  })
  async onEdit(@Context() [interaction]: MessageCommandContext): Promise<void> {
    const message = interaction.targetMessage;
    if (message.author.id !== interaction.client.user.id) {
      // Only the bot's own messages can be edited; say so instead of opening a dialog that cannot work.
      const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
      await interaction.reply({
        content: t('messaging.notBotMessage'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await showModalFirst(
      interaction,
      buildEditModal(
        interaction.locale,
        { channelId: message.channelId, messageId: message.id },
        message.content,
      ),
    );
  }

  @MessageCommand({
    name: replyName['en-US'],
    nameLocalizations: replyName,
    defaultMemberPermissions: MENU_PERMISSIONS,
  })
  async onReply(@Context() [interaction]: MessageCommandContext): Promise<void> {
    const message = interaction.targetMessage;
    await showModalFirst(
      interaction,
      buildSendModal(interaction.locale, message.channelId, message.id),
    );
  }
}
