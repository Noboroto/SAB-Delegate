import { UseInterceptors } from '@nestjs/common';
import {
  ErrorCode,
  MESSAGE_MAX_LENGTH,
  PRIVATE_THREAD_PREFIX_MAX_LENGTH,
  THREAD_FAILURE_REASON,
  parseMessageRef,
  parseSnowflakes,
  type ActorContext,
  type PrivateThreadResult,
} from '@sab/shared';
import { ChannelType, MessageFlags } from 'discord.js';
import {
  ChannelOption,
  Context,
  RoleOption,
  StringOption,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrivateThreadGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { PrivateThreadService } from './private-thread.service.js';

const listText = localizations('thread.privateThread.commands.list.description');
const byReactionText = localizations('thread.privateThread.commands.byReaction.description');
const prefixText = localizations('thread.privateThread.commands.prefixOption.description');
const idsText = localizations('thread.privateThread.commands.idsOption.description');
const roleText = localizations('thread.privateThread.commands.roleOption.description');
const messageText = localizations('thread.privateThread.commands.messageOption.description');
const destinationText = localizations(
  'thread.privateThread.commands.destinationOption.description',
);
const linkText = localizations('thread.privateThread.commands.messageLinkOption.description');
const emojiText = localizations('thread.privateThread.commands.emojiOption.description');

type Destination = { readonly id: string };

class PrivateThreadListOptions {
  @StringOption({
    name: 'prefix',
    description: prefixText['en-US'],
    description_localizations: prefixText,
    required: true,
    min_length: 1,
    max_length: PRIVATE_THREAD_PREFIX_MAX_LENGTH,
  })
  readonly prefix!: string;

  @StringOption({
    name: 'ids',
    description: idsText['en-US'],
    description_localizations: idsText,
    required: false,
  })
  readonly ids?: string;

  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: false,
  })
  readonly role?: { readonly id: string };

  @StringOption({
    name: 'message',
    description: messageText['en-US'],
    description_localizations: messageText,
    required: false,
    min_length: 1,
    max_length: MESSAGE_MAX_LENGTH,
  })
  readonly message?: string;

  @ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: [ChannelType.GuildText],
    required: false,
  })
  readonly destination?: Destination;
}

class PrivateThreadByReactionOptions {
  @StringOption({
    name: 'prefix',
    description: prefixText['en-US'],
    description_localizations: prefixText,
    required: true,
    min_length: 1,
    max_length: PRIVATE_THREAD_PREFIX_MAX_LENGTH,
  })
  readonly prefix!: string;

  @StringOption({
    name: 'message-link',
    description: linkText['en-US'],
    description_localizations: linkText,
    required: true,
  })
  readonly messageLink!: string;

  @StringOption({
    name: 'emoji',
    description: emojiText['en-US'],
    description_localizations: emojiText,
    required: true,
    autocomplete: true,
  })
  readonly emoji!: string;

  @StringOption({
    name: 'message',
    description: messageText['en-US'],
    description_localizations: messageText,
    required: false,
    min_length: 1,
    max_length: MESSAGE_MAX_LENGTH,
  })
  readonly message?: string;

  @ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: [ChannelType.GuildText],
    required: false,
  })
  readonly destination?: Destination;
}

/**
 * `/private-thread list|by-reaction`. Who may run them is decided by the
 * group's default permission in Discord; nothing is checked here. Every answer
 * is private to the person who ran it.
 */
@DiscordCommands()
@PrivateThreadGroup()
export class PrivateThreadCommands {
  constructor(
    private readonly privateThreads: PrivateThreadService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'list',
    description: listText['en-US'],
    descriptionLocalizations: listText,
  })
  async onList(
    @Context() [interaction]: SlashCommandContext,
    @Options() { prefix, ids, role, message, destination }: PrivateThreadListOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    // Opening a thread per member takes far longer than the 3 s window for a first reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    if (message !== undefined && message.trim() === '') {
      await replyInChunks(interaction, t('thread.privateThread.messageEmpty'), { ephemeral: true });
      return;
    }

    const userIds = parseSnowflakes(ids ?? '');
    if (userIds.length === 0 && role === undefined) {
      await replyInChunks(interaction, t('thread.privateThread.needsIdsOrRole'), {
        ephemeral: true,
      });
      return;
    }

    const result = await this.privateThreads.createPrivateThreads(
      guildId,
      {
        channelId: destination?.id ?? interaction.channelId,
        prefix,
        message: message ?? t('thread.privateThread.defaultMessage'),
        userIds,
        ...(role === undefined ? {} : { roleId: role.id }),
      },
      actorOf(interaction),
    );
    await replyInChunks(interaction, resultText(t, result, undefined), { ephemeral: true });
  }

  @UseInterceptors(ReactionAutocompleteInterceptor)
  @Subcommand({
    name: 'by-reaction',
    description: byReactionText['en-US'],
    descriptionLocalizations: byReactionText,
  })
  async onByReaction(
    @Context() [interaction]: SlashCommandContext,
    @Options() { prefix, messageLink, emoji, message, destination }: PrivateThreadByReactionOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    if (message !== undefined && message.trim() === '') {
      await replyInChunks(interaction, t('thread.privateThread.messageEmpty'), { ephemeral: true });
      return;
    }

    // A bare message id means "in this channel"; the service reads a full reference.
    const ref = parseMessageRef(messageLink, { channelId: interaction.channelId });
    const result = await this.privateThreads.createPrivateThreadsFromReactors(
      guildId,
      {
        channelId: destination?.id ?? interaction.channelId,
        prefix,
        message: message ?? t('thread.privateThread.defaultMessage'),
        messageLink: ref.ok ? `${ref.channelId}/${ref.messageId}` : messageLink,
        emoji,
      },
      actorOf(interaction),
      // A link into another server is followed, allowed as in the legacy bot.
      { crossGuild: true },
    );
    await replyInChunks(interaction, resultText(t, result, emoji.trim()), { ephemeral: true });
  }
}

type Translate = ReturnType<typeof translatorFor>;

/**
 * The summary line and a line per member that failed. `emoji` is set for
 * `by-reaction`, where "no one" means nobody reacted.
 */
function resultText(t: Translate, result: PrivateThreadResult, emoji: string | undefined): string {
  switch (result.status) {
    case 'CHANNEL_NOT_TEXT':
      return t('thread.privateThread.CHANNEL_NOT_TEXT');
    case 'NO_MEMBERS':
      return emoji === undefined
        ? t('thread.privateThread.noMembers')
        : t('thread.privateThread.noReactors', { emoji });
    case 'INVALID_LINK':
      return t(`errors.invalidLink.${result.linkProblem ?? 'MALFORMED'}`);
    case 'MESSAGE_NOT_FOUND':
      return t('thread.privateThread.MESSAGE_NOT_FOUND');
    case 'NO_ACCESS':
      return t('thread.privateThread.NO_ACCESS');
    case 'OK':
      break;
  }
  const lines = [t('thread.privateThread.done', { created: result.created, total: result.total })];
  if (result.failures.length > 0) {
    lines.push(t('thread.privateThread.errorsHeader'));
    for (const failure of result.failures) {
      lines.push(
        t('thread.privateThread.failure', {
          user: `<@${failure.userId}>`,
          reason:
            failure.reason === THREAD_FAILURE_REASON.memberNotFound
              ? t('thread.privateThread.MEMBER_NOT_FOUND')
              : failure.reason,
        }),
      );
    }
  }
  return lines.join('\n');
}

/** The commands are offered in direct messages too (see AGENTS.md); threads need a server. */
function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}
