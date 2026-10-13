import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type ActorContext,
  type Locale,
  type MentionEveryoneResult,
  type MentionResult,
} from '@sab/shared';
import { MessageFlags, type MessageMentionOptions } from 'discord.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { mentionsForActor } from '../../discord/helpers/allowed-mentions.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import {
  MessageResolver,
  type MessageResolution,
} from '../../discord/services/message-resolver.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { MentionService } from './mention.service.js';

/**
 * What the responder needs from an interaction. Structural for the reason given
 * in `discord/helpers/reply.ts`: a slash command and a context menu both fit.
 */
type MentionInteraction = {
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly locale: string;
  readonly user: { readonly id: string };
  deferReply(options?: { flags?: MessageFlags.Ephemeral }): Promise<unknown>;
  reply(options: { content: string; flags?: MessageFlags.Ephemeral }): Promise<unknown>;
  readonly replied: boolean;
  readonly deferred: boolean;
  editReply(options: {
    content: string;
    allowedMentions?: MessageMentionOptions;
  }): Promise<unknown>;
  followUp(options: {
    content: string;
    flags?: MessageFlags.Ephemeral;
    allowedMentions?: MessageMentionOptions;
  }): Promise<unknown>;
  deleteReply(): Promise<unknown>;
};

type ByReactionArgs = {
  messageLink: string;
  emoji: string;
  replyMessage?: string;
  content?: string;
};

type NotReactArgs = {
  messageLink: string;
  content?: string;
  roleId?: string;
  isReply?: boolean;
  includeBots?: boolean;
  onlyInChannel?: boolean;
};

type EveryoneArgs = { content?: string; replyMessage?: string };

type NonReactorOptions = Omit<NotReactArgs, 'messageLink'>;

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

const hasText = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

function actorOf(interaction: MentionInteraction): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/**
 * The conversation around the mention commands, shared by the slash commands
 * and the context menu: resolving links, choosing between a public and a
 * private answer, and turning a result into sentences. The facts come from
 * `MentionService`; nothing here decides who may run a command.
 *
 * The answer is private when the list goes to another message (the person
 * only needs "Sent!") and public otherwise, where everyone should see who was
 * named. A problem is always private: when the placeholder is already public
 * it is removed and the problem goes out as a private follow-up.
 */
@Injectable()
export class MentionResponder {
  constructor(
    private readonly mentions: MentionService,
    private readonly resolver: MessageResolver,
    private readonly reactions: DiscordReactionService,
    private readonly locales: GuildLocaleService,
  ) {}

  async byReaction(interaction: MentionInteraction, args: ByReactionArgs): Promise<void> {
    const guildId = this.guildOf(interaction);
    // With a reply target the list goes to that message and the answer is only
    // "Sent!". The option says so up front, so the placeholder is made before
    // the two links are read: reading them can outlast the 3 s window.
    const privateAnswer = hasText(args.replyMessage);
    await interaction.deferReply(privateAnswer ? ephemeral : undefined);
    const { t, locale } = await this.speech(interaction, guildId);

    const found = await this.resolver.fetch(args.messageLink, this.defaults(interaction));
    if (found.status !== 'OK') return this.refuseUnresolved(interaction, t, found, privateAnswer);
    const reply = await this.requireReplyTarget(interaction, t, args.replyMessage, privateAnswer);
    if (reply === 'REFUSED') return;

    const emoji = args.emoji.trim();
    if (!this.reactions.hasReaction(found.message, emoji)) {
      await this.refuse(interaction, t('mention.noReactors'), !privateAnswer);
      return;
    }

    const result = await this.mentions.mentionReactors(
      found.message.guildId ?? guildId,
      {
        channelId: found.message.channelId,
        messageId: found.message.id,
        emoji,
        content: args.content,
        replyTo: reply,
        locale,
      },
      actorOf(interaction),
      { crossGuild: true },
    );
    await this.answer(interaction, t, result, privateAnswer);
  }

  async notReact(interaction: MentionInteraction, args: NotReactArgs): Promise<void> {
    const guildId = this.guildOf(interaction);
    // With a reply the list goes to the message and the answer is only "Sent!".
    const privateAnswer = args.isReply === true;
    // Reading the message, every member and every reactor outlasts the 3 s window.
    await interaction.deferReply(privateAnswer ? ephemeral : undefined);
    const speech = await this.speech(interaction, guildId);

    const found = await this.resolver.fetch(args.messageLink, this.defaults(interaction));
    if (found.status !== 'OK') {
      return this.refuseUnresolved(interaction, speech.t, found, privateAnswer);
    }

    await this.nonReactors(
      interaction,
      speech,
      found.message.guildId ?? guildId,
      { channelId: found.message.channelId, messageId: found.message.id },
      args,
    );
  }

  /** The context menu: the message is the one clicked, everything else is the default. */
  async notReactOf(
    interaction: MentionInteraction,
    message: { guildId: string | null; channelId: string; id: string },
  ): Promise<void> {
    const guildId = this.guildOf(interaction);
    await interaction.deferReply();
    const speech = await this.speech(interaction, guildId);
    await this.nonReactors(
      interaction,
      speech,
      message.guildId ?? guildId,
      { channelId: message.channelId, messageId: message.id },
      {},
    );
  }

  async everyone(interaction: MentionInteraction, args: EveryoneArgs): Promise<void> {
    const guildId = this.guildOf(interaction);
    const channelId = interaction.channelId;
    if (channelId === null) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    await interaction.deferReply(ephemeral);
    const { t, locale } = await this.speech(interaction, guildId);

    // A reply target that cannot be read is not an error: the message goes into
    // the thread instead, as it always did.
    const reply = hasText(args.replyMessage)
      ? await this.findReplyTarget(interaction, args.replyMessage)
      : undefined;
    const result: MentionEveryoneResult = await this.mentions.mentionEveryoneInThread(
      guildId,
      { threadId: channelId, content: args.content, replyTo: reply, locale },
      actorOf(interaction),
      { crossGuild: true },
    );

    switch (result.status) {
      case 'OK':
        await interaction.editReply({ content: t('mention.sent') });
        return;
      case 'NOT_A_THREAD':
        await interaction.editReply({ content: t('mention.notAThread') });
        return;
      case 'SEND_FAILED':
        await interaction.editReply({
          content: t('mention.sendFailed', { reason: result.failure ?? '' }),
        });
        return;
    }
  }

  private async nonReactors(
    interaction: MentionInteraction,
    { t, locale }: Speech,
    guildId: string,
    message: { channelId: string; messageId: string },
    options: NonReactorOptions,
  ): Promise<void> {
    const privateAnswer = options.isReply === true;
    const result = await this.mentions.mentionNonReactors(
      guildId,
      {
        ...message,
        content: options.content,
        roleId: options.roleId,
        includeBots: options.includeBots,
        onlyInChannel: options.onlyInChannel,
        reply: privateAnswer,
        locale,
      },
      actorOf(interaction),
      { crossGuild: true },
    );
    await this.answer(interaction, t, result, privateAnswer);
  }

  /** Turns a list result into the reply: the list itself, "Sent!", or why there is none. */
  private async answer(
    interaction: MentionInteraction,
    t: Translator,
    result: MentionResult,
    privateAnswer: boolean,
  ): Promise<void> {
    switch (result.status) {
      case 'OK':
        if (result.delivered) {
          await interaction.editReply({ content: t('mention.sent') });
        } else {
          await this.postChunks(interaction, result.chunks);
        }
        return;
      case 'ALL_REACTED':
        // Good news for the room, so it stays where the room can read it.
        await interaction.editReply({ content: t('mention.allReacted') });
        return;
      case 'NO_REACTORS':
        await this.refuse(interaction, t('mention.noReactors'), !privateAnswer);
        return;
      case 'UNSUPPORTED_CHANNEL':
        await this.refuse(interaction, t('mention.unsupportedChannel'), !privateAnswer);
        return;
      case 'SEND_FAILED':
        // Pieces that went out stay out; saying "cannot send" would invite a repeat of them.
        await interaction.editReply({
          content:
            result.postedChunks > 0
              ? t('mention.sendPartial', {
                  sent: result.postedChunks,
                  total: result.chunks.length,
                  reason: result.failure ?? '',
                })
              : t('mention.sendFailed', { reason: result.failure ?? '' }),
        });
        return;
    }
  }

  /** The first piece fills the deferred reply, the rest follow it; what they name pings, as it always did. */
  private async postChunks(
    interaction: MentionInteraction,
    chunks: readonly string[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    await replyInChunks(interaction, chunks, {
      allowedMentions: mentionsForActor(actorOf(interaction), ['users', 'roles', 'everyone']),
    });
  }

  /** A problem is for the person who ran the command, not for the room. */
  private async refuse(
    interaction: MentionInteraction,
    content: string,
    placeholderIsPublic: boolean,
  ): Promise<void> {
    if (!placeholderIsPublic) {
      await interaction.editReply({ content });
      return;
    }
    await interaction.deleteReply();
    await interaction.followUp({ content, ...ephemeral });
  }

  private async refuseUnresolved(
    interaction: MentionInteraction,
    t: Translator,
    found: Exclude<MessageResolution, { status: 'OK' }>,
    privateAnswer: boolean,
  ): Promise<void> {
    let content: string;
    switch (found.status) {
      case 'INVALID_LINK':
        content = t(`errors.invalidLink.${found.reason}`);
        break;
      case 'NO_ACCESS':
        content = t('errors.DISCORD_MISSING_PERMISSIONS', { permission: 'view' });
        break;
      case 'NOT_FOUND':
        content = t('errors.DISCORD_MESSAGE_NOT_FOUND');
        break;
    }
    await this.refuse(interaction, content, !privateAnswer);
  }

  /** `undefined`: no reply target was asked for. `REFUSED`: it was, and the person has been told it is missing. */
  private async requireReplyTarget(
    interaction: MentionInteraction,
    t: Translator,
    link: string | undefined,
    privateAnswer: boolean,
  ): Promise<{ channelId: string; messageId: string } | undefined | 'REFUSED'> {
    if (!hasText(link)) return undefined;
    const target = await this.findReplyTarget(interaction, link);
    if (target !== undefined) return target;
    await this.refuse(interaction, t('mention.replyNotFound'), !privateAnswer);
    return 'REFUSED';
  }

  private async findReplyTarget(
    interaction: MentionInteraction,
    link: string,
  ): Promise<{ channelId: string; messageId: string } | undefined> {
    const found = await this.resolver.fetch(link, this.defaults(interaction));
    return found.status === 'OK'
      ? { channelId: found.message.channelId, messageId: found.message.id }
      : undefined;
  }

  private defaults(interaction: MentionInteraction): { channelId?: string } {
    return interaction.channelId === null ? {} : { channelId: interaction.channelId };
  }

  /** The commands are offered in direct messages too (see AGENTS.md); mentions need a server. */
  private guildOf(interaction: MentionInteraction): string {
    if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
    return interaction.guildId;
  }

  private async speech(interaction: MentionInteraction, guildId: string): Promise<Speech> {
    const locale = await this.locales.resolve(guildId, interaction);
    return { locale, t: translatorFor(locale) };
  }
}

type Translator = ReturnType<typeof translatorFor>;

/** A reply's language and the translator for it; services write their own sentences in the same one. */
type Speech = { readonly locale: Locale; readonly t: Translator };
