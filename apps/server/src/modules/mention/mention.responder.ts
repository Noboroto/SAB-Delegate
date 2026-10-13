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
import { replyInChunks } from '../../discord/helpers/reply.js';
import { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import {
  MessageResolver,
  type MessageResolution,
} from '../../discord/services/message-resolver.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { allowedMentionsFor } from './mention.format.js';
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
    const { t, locale } = await this.speech(interaction, guildId);

    const found = await this.resolver.fetch(args.messageLink, this.defaults(interaction));
    if (found.status !== 'OK') return this.refuseUnresolved(interaction, t, found);
    const reply = await this.resolveReplyTarget(interaction, t, args.replyMessage);
    if (reply === 'REFUSED') return;

    const emoji = args.emoji.trim();
    if (!this.reactions.hasReaction(found.message, emoji)) {
      await interaction.reply({ content: t('mention.noReactors'), ...ephemeral });
      return;
    }

    // Paging through thousands of reactors outlives the 3 s window.
    const privateAnswer = reply !== undefined;
    await interaction.deferReply(privateAnswer ? ephemeral : undefined);

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
    const speech = await this.speech(interaction, guildId);

    const found = await this.resolver.fetch(args.messageLink, this.defaults(interaction));
    if (found.status !== 'OK') return this.refuseUnresolved(interaction, speech.t, found);

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
    const { t, locale } = await this.speech(interaction, guildId);

    const reply = await this.resolveReplyTarget(interaction, t, args.replyMessage);
    if (reply === 'REFUSED') return;

    await interaction.deferReply(ephemeral);
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
    // With a reply the list goes to the message and the answer is only "Sent!".
    const privateAnswer = options.isReply === true;
    // Reading every member and reactor outlives the 3 s window.
    await interaction.deferReply(privateAnswer ? ephemeral : undefined);

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
        await interaction.editReply({
          content: t('mention.sendFailed', { reason: result.failure ?? '' }),
        });
        return;
    }
  }

  /** The first piece fills the deferred reply, the rest follow it; each pings only whom it names. */
  private async postChunks(
    interaction: MentionInteraction,
    chunks: readonly string[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    await replyInChunks(interaction, chunks, { allowedMentions: allowedMentionsFor });
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
    await interaction.reply({ content, ...ephemeral });
  }

  /** `undefined`: no reply target was asked for. `REFUSED`: it was, and the person has been told it is missing. */
  private async resolveReplyTarget(
    interaction: MentionInteraction,
    t: Translator,
    link: string | undefined,
  ): Promise<{ channelId: string; messageId: string } | undefined | 'REFUSED'> {
    if (link === undefined || link.trim() === '') return undefined;
    const found = await this.resolver.fetch(link, this.defaults(interaction));
    if (found.status === 'OK') {
      return { channelId: found.message.channelId, messageId: found.message.id };
    }
    await interaction.reply({ content: t('mention.replyNotFound'), ...ephemeral });
    return 'REFUSED';
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
