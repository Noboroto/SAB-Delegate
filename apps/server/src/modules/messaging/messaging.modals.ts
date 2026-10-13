import { MESSAGE_MAX_LENGTH, type MessageTarget } from '@sab/shared';
import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Context, Modal, ModalParam, type ModalContext } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { answerPrivately, describeEdit, slashActor } from './messaging.presenter.js';
import { MessagingService } from './messaging.service.js';

/** Dialog ids carry what the dialog acts on, since it is answered in a later request. */
const SEND_MODAL_PREFIX = 'bm-send';
const EDIT_MODAL_PREFIX = 'bm-edit';
/** Stands for "no message to reply to" in a send dialog's id, which needs a value there. */
const NO_REPLY = '-';

const CONTENT_INPUT = 'content';

/** A dialog to type a message in; with `replyMessageId` the message is posted as a reply to it. */
export function buildSendModal(
  locale: string,
  channelId: string,
  replyMessageId?: string,
): ModalBuilder {
  const t = translatorFor(locale);
  const input = new TextInputBuilder()
    .setCustomId(CONTENT_INPUT)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(MESSAGE_MAX_LENGTH);

  return new ModalBuilder()
    .setCustomId(`${SEND_MODAL_PREFIX}/${channelId}/${replyMessageId ?? NO_REPLY}`)
    .setTitle(
      replyMessageId === undefined
        ? t('messaging.modal.send.title')
        : t('messaging.modal.reply.title'),
    )
    .addLabelComponents(
      new LabelBuilder().setLabel(t('messaging.modal.contentLabel')).setTextInputComponent(input),
    );
}

/** A dialog to rewrite a bot message, showing its current text when it is known. */
export function buildEditModal(
  locale: string,
  target: MessageTarget,
  currentContent: string = '',
): ModalBuilder {
  const t = translatorFor(locale);
  const input = new TextInputBuilder()
    .setCustomId(CONTENT_INPUT)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(MESSAGE_MAX_LENGTH);
  // A message with only files has no text, and an empty value is not accepted.
  if (currentContent.trim() !== '') input.setValue(currentContent);

  return new ModalBuilder()
    .setCustomId(`${EDIT_MODAL_PREFIX}/${target.channelId}/${target.messageId}`)
    .setTitle(t('messaging.modal.edit.title'))
    .addLabelComponents(
      new LabelBuilder().setLabel(t('messaging.modal.contentLabel')).setTextInputComponent(input),
    );
}

/**
 * The submitted dialogs of `/bot-message send|edit-send` and of the "Reply as
 * bot" and "Edit bot message" menus. The answer is private, as the commands'
 * always were.
 */
@DiscordCommands()
export class MessagingModals {
  constructor(
    private readonly messaging: MessagingService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Modal(`${SEND_MODAL_PREFIX}/:channelId/:replyMessageId`)
  async onSend(
    @Context() [interaction]: ModalContext,
    @ModalParam('channelId') channelId: string,
    @ModalParam('replyMessageId') replyMessageId: string,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
    const content = interaction.fields.getTextInputValue(CONTENT_INPUT);
    if (content.trim() === '') {
      await replyInChunks(interaction, t('messaging.emptyContent'), { ephemeral: true });
      return;
    }

    await answerPrivately(interaction, t, 'send', async () => {
      await this.messaging.sendMessage(
        interaction.guildId,
        {
          channelId,
          content,
          ...(replyMessageId === NO_REPLY
            ? {}
            : { replyTo: { channelId, messageId: replyMessageId } }),
        },
        slashActor(interaction),
      );
      return t('messaging.sent');
    });
  }

  @Modal(`${EDIT_MODAL_PREFIX}/:channelId/:messageId`)
  async onEdit(
    @Context() [interaction]: ModalContext,
    @ModalParam('channelId') channelId: string,
    @ModalParam('messageId') messageId: string,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
    const content = interaction.fields.getTextInputValue(CONTENT_INPUT);
    if (content.trim() === '') {
      await replyInChunks(interaction, t('messaging.emptyContent'), { ephemeral: true });
      return;
    }

    await answerPrivately(interaction, t, 'edit', async () => {
      const result = await this.messaging.editBotMessage(
        interaction.guildId,
        { target: { channelId, messageId }, content },
        slashActor(interaction),
      );
      return describeEdit(t, result.status);
    });
  }
}
