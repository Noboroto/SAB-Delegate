import { UseInterceptors } from '@nestjs/common';
import {
  MESSAGE_MAX_LENGTH,
  POLL_CHOICES_MAX,
  REACTION_EMOJI_MAX_LENGTH,
  parseMessageRef,
  type MessageTarget,
} from '@sab/shared';
import {
  ChannelType,
  MessageFlags,
  type ApplicationCommandOptionAllowedChannelType,
  type Message,
} from 'discord.js';
import {
  ChannelOption,
  Context,
  IntegerOption,
  StringOption,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { BotMessageGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { showModalFirst } from '../../discord/helpers/modal.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { buildEditModal, buildSendModal } from './messaging.modals.js';
import {
  answerPrivately,
  channelOf,
  describeEdit,
  resolutionProblem,
  slashActor,
  type Translator,
} from './messaging.presenter.js';
import { MessagingService } from './messaging.service.js';

const DESTINATION_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];

const sendText = localizations('messaging.commands.send.description');
const copyPasteText = localizations('messaging.commands.copyPaste.description');
const editCopyText = localizations('messaging.commands.editCopy.description');
const editSendText = localizations('messaging.commands.editSend.description');
const reactText = localizations('messaging.commands.react.description');
const contentText = localizations('messaging.commands.contentOption.description');
const destinationText = localizations('messaging.commands.destinationOption.description');
const replyMessageText = localizations('messaging.commands.replyMessageOption.description');
const copySourceText = localizations('messaging.commands.copySourceOption.description');
const newMessageLinkText = localizations('messaging.commands.newMessageLinkOption.description');
const oldBotMessageLinkText = localizations(
  'messaging.commands.oldBotMessageLinkOption.description',
);
const newContentText = localizations('messaging.commands.newContentOption.description');
const reactTargetText = localizations('messaging.commands.reactTargetOption.description');
const emojiText = localizations('messaging.commands.emojiOption.description');
const reactChoiceCountText = localizations('messaging.commands.reactChoiceCountOption.description');

type ChannelRef = { readonly id: string };

class SendOptions {
  /** Left out, the command opens a dialog for the text instead. */
  @StringOption({
    name: 'content',
    description: contentText['en-US'],
    description_localizations: contentText,
    required: false,
    min_length: 1,
    max_length: MESSAGE_MAX_LENGTH,
  })
  readonly content?: string;

  @ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: DESTINATION_TYPES,
    required: false,
  })
  readonly destination?: ChannelRef;

  @StringOption({
    name: 'reply-message',
    description: replyMessageText['en-US'],
    description_localizations: replyMessageText,
    required: false,
  })
  readonly replyMessage?: string;
}

class CopyPasteOptions {
  @StringOption({
    name: 'message-link',
    description: copySourceText['en-US'],
    description_localizations: copySourceText,
    required: true,
  })
  readonly messageLink!: string;

  @ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: DESTINATION_TYPES,
    required: false,
  })
  readonly destination?: ChannelRef;
}

class EditCopyOptions {
  @StringOption({
    name: 'new-message-link',
    description: newMessageLinkText['en-US'],
    description_localizations: newMessageLinkText,
    required: true,
  })
  readonly newMessageLink!: string;

  @StringOption({
    name: 'old-bot-message-link',
    description: oldBotMessageLinkText['en-US'],
    description_localizations: oldBotMessageLinkText,
    required: true,
  })
  readonly oldBotMessageLink!: string;
}

class EditSendOptions {
  @StringOption({
    name: 'old-bot-message-link',
    description: oldBotMessageLinkText['en-US'],
    description_localizations: oldBotMessageLinkText,
    required: true,
  })
  readonly oldBotMessageLink!: string;

  /** Left out, the command opens a dialog showing the current text. */
  @StringOption({
    name: 'new-content',
    description: newContentText['en-US'],
    description_localizations: newContentText,
    required: false,
    min_length: 1,
    max_length: MESSAGE_MAX_LENGTH,
  })
  readonly newContent?: string;
}

/**
 * The link comes before the emoji so the emoji's suggestions (the reactions
 * already on that message) can be read while it is being typed.
 */
class ReactOptions {
  @StringOption({
    name: 'message-link',
    description: reactTargetText['en-US'],
    description_localizations: reactTargetText,
    required: true,
  })
  readonly messageLink!: string;

  @StringOption({
    name: 'emoji',
    description: emojiText['en-US'],
    description_localizations: emojiText,
    required: true,
    autocomplete: true,
    min_length: 1,
    max_length: REACTION_EMOJI_MAX_LENGTH,
  })
  readonly emoji!: string;

  @IntegerOption({
    name: 'poll-choice-count',
    description: reactChoiceCountText['en-US'],
    description_localizations: reactChoiceCountText,
    required: false,
    min_value: 0,
    max_value: POLL_CHOICES_MAX,
  })
  readonly pollChoiceCount?: number;
}

/**
 * `/bot-message send|copy-paste|edit-copy|edit-send|react`. The answers are
 * private, as they always were. Who may run them is Discord's command
 * permission; nothing is checked here.
 */
@DiscordCommands()
@BotMessageGroup()
export class MessagingCommands {
  constructor(
    private readonly messaging: MessagingService,
    private readonly resolver: MessageResolver,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({ name: 'send', description: sendText['en-US'], descriptionLocalizations: sendText })
  async onSend(
    @Context() [interaction]: SlashCommandContext,
    @Options() { content, destination, replyMessage }: SendOptions,
  ): Promise<void> {
    if (content === undefined) {
      await this.openSendDialog(interaction, destination?.id, replyMessage);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await this.translator(interaction);
    if (content.trim() === '') {
      await replyInChunks(interaction, t('messaging.emptyContent'), { ephemeral: true });
      return;
    }

    let replyTo: MessageTarget | undefined;
    if (replyMessage !== undefined) {
      // A reply goes where the replied-to message is, so a link that does not
      // resolve must stop here instead of posting somewhere else.
      const message = await this.resolveOrExplain(interaction, t, replyMessage);
      if (message === undefined) return;
      replyTo = { channelId: message.channelId, messageId: message.id };
    }

    await answerPrivately(interaction, t, 'send', async () => {
      await this.messaging.sendMessage(
        interaction.guildId,
        { channelId: destination?.id ?? channelOf(interaction), content, replyTo },
        slashActor(interaction),
      );
      return t('messaging.sent');
    });
  }

  @Subcommand({
    name: 'copy-paste',
    description: copyPasteText['en-US'],
    descriptionLocalizations: copyPasteText,
  })
  async onCopyPaste(
    @Context() [interaction]: SlashCommandContext,
    @Options() { messageLink, destination }: CopyPasteOptions,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await this.translator(interaction);
    const source = await this.resolveOrExplain(interaction, t, messageLink);
    if (source === undefined) return;

    const channelId = destination?.id ?? channelOf(interaction);
    await answerPrivately(
      interaction,
      t,
      'copy',
      async () => {
        const result = await this.messaging.copyMessage(
          interaction.guildId,
          { source: { channelId: source.channelId, messageId: source.id }, channelId },
          slashActor(interaction),
        );
        return result.status === 'COPIED'
          ? t('messaging.done')
          : t('messaging.nothingToCopy.source');
      },
      { channel: `<#${channelId}>` },
    );
  }

  @Subcommand({
    name: 'edit-copy',
    description: editCopyText['en-US'],
    descriptionLocalizations: editCopyText,
  })
  async onEditCopy(
    @Context() [interaction]: SlashCommandContext,
    @Options() { newMessageLink, oldBotMessageLink }: EditCopyOptions,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await this.translator(interaction);
    const old = await this.resolveOrExplain(interaction, t, oldBotMessageLink);
    if (old === undefined) return;
    const fresh = await this.resolveOrExplain(interaction, t, newMessageLink);
    if (fresh === undefined) return;

    await answerPrivately(interaction, t, 'edit', async () => {
      const result = await this.messaging.editBotMessageFromCopy(
        interaction.guildId,
        {
          target: { channelId: old.channelId, messageId: old.id },
          source: { channelId: fresh.channelId, messageId: fresh.id },
        },
        slashActor(interaction),
      );
      return describeEdit(t, result.status);
    });
  }

  @Subcommand({
    name: 'edit-send',
    description: editSendText['en-US'],
    descriptionLocalizations: editSendText,
  })
  async onEditSend(
    @Context() [interaction]: SlashCommandContext,
    @Options() { oldBotMessageLink, newContent }: EditSendOptions,
  ): Promise<void> {
    if (newContent === undefined) {
      // A dialog must be the first response, within 3 seconds of the command,
      // and fetching the message first can take longer. The link is only read
      // here; whether the message exists and is the bot's is found out when the
      // dialog is submitted, so it opens empty instead of showing the old text.
      const ref = parseMessageRef(oldBotMessageLink, { channelId: channelOf(interaction) });
      if (!ref.ok) {
        const t = await this.translator(interaction);
        await replyInChunks(interaction, t(`errors.invalidLink.${ref.reason}`), {
          ephemeral: true,
        });
        return;
      }
      await showModalFirst(
        interaction,
        buildEditModal(interaction.locale, {
          channelId: ref.channelId,
          messageId: ref.messageId,
        }),
      );
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await this.translator(interaction);
    if (newContent.trim() === '') {
      await replyInChunks(interaction, t('messaging.emptyContent'), { ephemeral: true });
      return;
    }
    const old = await this.resolveOrExplain(interaction, t, oldBotMessageLink);
    if (old === undefined) return;

    await answerPrivately(interaction, t, 'edit', async () => {
      const result = await this.messaging.editBotMessage(
        interaction.guildId,
        { target: { channelId: old.channelId, messageId: old.id }, content: newContent },
        slashActor(interaction),
      );
      return describeEdit(t, result.status);
    });
  }

  @UseInterceptors(ReactionAutocompleteInterceptor)
  @Subcommand({
    name: 'react',
    description: reactText['en-US'],
    descriptionLocalizations: reactText,
  })
  async onReact(
    @Context() [interaction]: SlashCommandContext,
    @Options() { messageLink, emoji, pollChoiceCount }: ReactOptions,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await this.translator(interaction);
    const message = await this.resolveOrExplain(interaction, t, messageLink);
    if (message === undefined) return;

    await answerPrivately(interaction, t, 'react', async () => {
      await this.messaging.reactToMessage(
        interaction.guildId,
        {
          target: { channelId: message.channelId, messageId: message.id },
          emoji,
          pollChoices: pollChoiceCount ?? 0,
        },
        slashActor(interaction),
      );
      return t('messaging.done');
    });
  }

  /**
   * A dialog has to be the first response, so the reply link is only read
   * here, not fetched: whether it resolves is found out when the dialog is
   * submitted.
   */
  private async openSendDialog(
    interaction: SlashCommandContext[0],
    destinationId: string | undefined,
    replyMessage: string | undefined,
  ): Promise<void> {
    const here = channelOf(interaction);
    let channelId = destinationId ?? here;
    let replyMessageId: string | undefined;

    if (replyMessage !== undefined) {
      const ref = parseMessageRef(replyMessage, { channelId: here });
      if (!ref.ok) {
        const t = await this.translator(interaction);
        await replyInChunks(interaction, t(`errors.invalidLink.${ref.reason}`), {
          ephemeral: true,
        });
        return;
      }
      channelId = ref.channelId;
      replyMessageId = ref.messageId;
    }
    await showModalFirst(
      interaction,
      buildSendModal(interaction.locale, channelId, replyMessageId),
    );
  }

  /** The message a link names, or undefined after telling the person why there is none. */
  private async resolveOrExplain(
    interaction: SlashCommandContext[0],
    t: Translator,
    input: string,
  ): Promise<Message | undefined> {
    const found = await this.resolver.fetch(input, { channelId: channelOf(interaction) });
    if (found.status === 'OK') return found.message;
    await replyInChunks(interaction, resolutionProblem(t, found), { ephemeral: true });
    return undefined;
  }

  private async translator(interaction: SlashCommandContext[0]): Promise<Translator> {
    return translatorFor(await this.locales.resolve(interaction.guildId, interaction));
  }
}
