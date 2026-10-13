import { UseInterceptors, Logger } from '@nestjs/common';
import {
  ErrorCode,
  MESSAGE_MAX_LENGTH,
  REACTION_EMOJI_MAX_LENGTH,
  splitMessage,
  type ActorContext,
  type IntroductionResult,
} from '@sab/shared';
import {
  ChannelType,
  MessageFlags,
  type ApplicationCommandOptionAllowedChannelType,
  type Message,
} from 'discord.js';
import {
  BooleanOption,
  ChannelOption,
  Context,
  Options,
  RoleOption,
  StringOption,
  Subcommand,
  UserOption,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { discordErrorCode, replyInChunks } from '../../discord/helpers/reply.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { InfoService } from './info.service.js';

const INVITE_CHANNEL_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];

/** Discord accepts at most this many ids in one message's `allowedMentions.users`. */
const ALLOWED_MENTIONS_MAX_USERS = 100;

const introText = localizations('info.commands.intro.description');
const idByReactionText = localizations('info.commands.idByReaction.description');
const idByRoleText = localizations('info.commands.idByRole.description');
const inviteLinkText = localizations('info.commands.inviteLink.description');
const userText = localizations('info.commands.userOption.description');
const messageLinkText = localizations('info.commands.messageLinkOption.description');
const emojiText = localizations('info.commands.emojiOption.description');
const mentionText = localizations('info.commands.mentionOption.description');
const replyMessageText = localizations('info.commands.replyMessageOption.description');
const contentText = localizations('info.commands.contentOption.description');
const roleText = localizations('info.commands.roleOption.description');
const inThisChannelText = localizations('info.commands.inThisChannelOption.description');
const channelText = localizations('info.commands.channelOption.description');

export class IntroOptions {
  @UserOption({
    name: 'user',
    description: userText['en-US'],
    description_localizations: userText,
    required: true,
  })
  readonly user!: { readonly id: string };
}

export class IdByReactionOptions {
  @StringOption({
    name: 'message-link',
    description: messageLinkText['en-US'],
    description_localizations: messageLinkText,
    required: true,
  })
  readonly messageLink!: string;

  @StringOption({
    name: 'emoji',
    description: emojiText['en-US'],
    description_localizations: emojiText,
    required: true,
    autocomplete: true,
    max_length: REACTION_EMOJI_MAX_LENGTH,
  })
  readonly emoji!: string;

  // discord.js answers null for an option the person left out.
  @BooleanOption({
    name: 'mention',
    description: mentionText['en-US'],
    description_localizations: mentionText,
    required: false,
  })
  readonly mention?: boolean | null;

  @StringOption({
    name: 'reply-message',
    description: replyMessageText['en-US'],
    description_localizations: replyMessageText,
    required: false,
  })
  readonly replyMessage?: string | null;

  @StringOption({
    name: 'content',
    description: contentText['en-US'],
    description_localizations: contentText,
    required: false,
    max_length: MESSAGE_MAX_LENGTH,
  })
  readonly content?: string | null;
}

export class IdByRoleOptions {
  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: true,
  })
  readonly role!: { readonly id: string };

  @BooleanOption({
    name: 'in-this-channel',
    description: inThisChannelText['en-US'],
    description_localizations: inThisChannelText,
    required: false,
  })
  readonly inThisChannel?: boolean | null;
}

export class InviteLinkOptions {
  @ChannelOption({
    name: 'channel',
    description: channelText['en-US'],
    description_localizations: channelText,
    channel_types: INVITE_CHANNEL_TYPES,
    required: false,
  })
  readonly channel?: { readonly id: string } | null;
}

type Chunk = { content: string; allowedMentions?: { users: string[] } };
type SendChunk = (chunk: Chunk) => Promise<unknown>;

/**
 * Sends `text` in pieces of at most 2000 characters. Only the people in
 * `pingIds` whose mention is in a piece may be notified by it: the client
 * default mutes everything, and what a person typed in `content` must stay
 * text. Every piece is awaited.
 */
async function sendChunked(
  text: string,
  first: SendChunk,
  rest: SendChunk,
  pingIds: readonly string[],
): Promise<void> {
  const chunk = (content: string): Chunk => {
    const users = pingIds
      .filter((id) => content.includes(`<@${id}>`))
      .slice(0, ALLOWED_MENTIONS_MAX_USERS);
    return users.length === 0 ? { content } : { content, allowedMentions: { users } };
  };
  const [head = '', ...tail] = splitMessage(text, MESSAGE_MAX_LENGTH);
  await first(chunk(head));
  for (const piece of tail) await rest(chunk(piece));
}

/** Unknown Channel, Missing Access, Missing Permissions: the intro channel cannot be read. */
const UNREADABLE_CODES: ReadonlySet<number> = new Set([10003, 50001, 50013]);

function isUnreadableChannel(error: unknown): boolean {
  if (error instanceof ServiceError) {
    return (
      error.code === ErrorCode.DISCORD_CHANNEL_NOT_FOUND ||
      error.code === ErrorCode.DISCORD_MISSING_PERMISSIONS
    );
  }
  const code = discordErrorCode(error);
  return code !== undefined && UNREADABLE_CODES.has(code);
}

/** The commands are offered in direct messages too (see AGENTS.md); a server-only one has no server there. */
function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/**
 * `/get intro|id-by-reaction|id-by-role|invite-link`. Who may run them is
 * decided by Discord's command permissions; nothing is checked here, not even
 * for `id-by-role`. The lists are public, as before; the invite is private.
 */
@DiscordCommands()
@CommandGroup.get()
export class InfoCommands {
  private readonly logger = new Logger(InfoCommands.name);

  constructor(
    private readonly info: InfoService,
    private readonly resolver: MessageResolver,
    private readonly reactions: DiscordReactionService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'intro',
    description: introText['en-US'],
    descriptionLocalizations: introText,
  })
  async onIntro(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user }: IntroOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    // Reading up to 10000 messages outlasts the 3 s window for a first reply.
    await interaction.deferReply();

    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    let result: IntroductionResult;
    try {
      result = await this.info.getIntroduction(guildId, { userId: user.id });
    } catch (error) {
      // The channel is set but the bot cannot read it: say so, as the old command did.
      if (!isUnreadableChannel(error)) throw error;
      this.logger.warn(`/get intro could not read the intro channel (${errorLabel(error)})`);
      await interaction.editReply({ content: t('info.intro.unreadable') });
      return;
    }
    switch (result.status) {
      case 'NO_CHANNEL':
        // A setting problem is for the person who ran the command, not the room.
        await interaction.deleteReply();
        await interaction.followUp({
          content: t('info.intro.noChannel'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      case 'NOT_FOUND':
        await replyInChunks(interaction, t('info.intro.notFound', { count: result.scanned }));
        return;
      case 'FOUND':
        await replyInChunks(
          interaction,
          t('info.intro.found', {
            user: `<@${user.id}>`,
            url: result.url,
            content: result.content,
          }),
        );
        return;
    }
  }

  @UseInterceptors(ReactionAutocompleteInterceptor)
  @Subcommand({
    name: 'id-by-reaction',
    description: idByReactionText['en-US'],
    descriptionLocalizations: idByReactionText,
  })
  async onIdByReaction(
    @Context() [interaction]: SlashCommandContext,
    @Options() { messageLink, emoji, mention, replyMessage, content }: IdByReactionOptions,
  ): Promise<void> {
    // Whether the list goes to another message is known from the options, so
    // the placeholder is made first: reading two links can outlast the 3 s window.
    const privateAnswer =
      replyMessage !== undefined && replyMessage !== null && replyMessage.trim() !== '';
    await interaction.deferReply(privateAnswer ? { flags: MessageFlags.Ephemeral } : {});

    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
    const channelId = interaction.channelId ?? undefined;
    // A problem is for the person who ran the command: a public placeholder
    // cannot be made private, so it goes and the problem follows privately.
    const sayPrivately = async (text: string): Promise<void> => {
      if (privateAnswer) {
        await interaction.editReply({ content: text });
        return;
      }
      await interaction.deleteReply();
      await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
    };

    // A link into another server is followed on purpose: the bot works across
    // every server it is in (see AGENTS.md).
    const found = await this.resolver.fetch(messageLink, { channelId });
    if (found.status === 'INVALID_LINK') {
      await sayPrivately(t(`errors.invalidLink.${found.reason}`));
      return;
    }
    if (found.status === 'NOT_FOUND') throw new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
    if (found.status === 'NO_ACCESS') {
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'view' });
    }
    const { message } = found;

    let target: Message | undefined;
    if (replyMessage !== undefined && replyMessage !== null) {
      const replyFound = await this.resolver.fetch(replyMessage, { channelId });
      if (replyFound.status !== 'OK') {
        await sayPrivately(t('info.reactors.replyNotFound'));
        return;
      }
      target = replyFound.message;
    }

    const reaction = emoji.trim();
    // The cache answers, so a typo costs no paging.
    if (!this.reactions.hasReaction(message, reaction)) {
      await sayPrivately(t('info.reactors.none'));
      return;
    }

    // The list goes to a channel message when replying elsewhere, so the answer
    // to the command is then private (the placeholder was made that way).
    const { url, userIds } = await this.info.listReactorIds(message.guildId, {
      channelId: message.channelId,
      messageId: message.id,
      emoji: reaction,
    });
    if (userIds.length === 0) {
      await replyInChunks(interaction, t('info.reactors.none'));
      return;
    }

    const mentionThem = mention === true;
    const lines = userIds.map((id) => {
      if (!mentionThem) return `${id},`;
      return `<@${id}>${id === interaction.user.id ? ' (author)' : ''},`;
    });
    const text = [
      t('info.reactors.header', { count: userIds.length, url, emoji: reaction }),
      ...lines,
      ...(content === undefined || content === null || content === '' ? [] : ['', content]),
    ].join('\n');
    const pingIds = mentionThem ? userIds : [];

    if (target === undefined) {
      await sendChunked(
        text,
        (chunk) => interaction.editReply(chunk),
        (chunk) => interaction.followUp(chunk),
        pingIds,
      );
      return;
    }

    const replyTo = target;
    try {
      await sendChunked(
        text,
        (chunk) => replyTo.reply(chunk),
        (chunk) => {
          if (!('send' in replyTo.channel)) throw new TypeError('The channel cannot be written to');
          return replyTo.channel.send(chunk);
        },
        pingIds,
      );
    } catch (error) {
      this.logger.warn(`/get id-by-reaction could not send the list (${errorLabel(error)})`);
      await replyInChunks(interaction, t('info.reactors.replyFailed'));
      return;
    }
    await replyInChunks(interaction, t('info.reactors.sent'));
  }

  @Subcommand({
    name: 'id-by-role',
    description: idByRoleText['en-US'],
    descriptionLocalizations: idByRoleText,
  })
  async onIdByRole(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role, inThisChannel }: IdByRoleOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    // Reading every member outlasts the 3 s window for a first reply.
    await interaction.deferReply();

    const channelId = inThisChannel === true ? interaction.channelId : null;
    const result = await this.info.listRoleMemberIds(guildId, {
      roleId: role.id,
      ...(channelId === null ? {} : { channelId }),
    });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const header = t('info.roleMembers.header', {
      count: result.userIds.length,
      role: result.roleName,
    });
    await replyInChunks(interaction, [header, ...result.userIds.map((id) => `${id},`)].join('\n'));
  }

  @Subcommand({
    name: 'invite-link',
    description: inviteLinkText['en-US'],
    descriptionLocalizations: inviteLinkText,
  })
  async onInviteLink(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel }: InviteLinkOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = channel?.id ?? interaction.channelId;
    if (channelId === null) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    const invite = await this.info.createInvite(
      guildId,
      { channelId, reason: t('info.invite.reason', { user: interaction.user.username }) },
      actorOf(interaction),
    );

    try {
      await interaction.user.send(
        t('info.invite.dm', { channel: invite.channelName, url: invite.url }),
      );
    } catch (error) {
      // Direct messages from server members may be closed; the link is then
      // shown here, where only the person who asked can see it.
      this.logger.warn(`/get invite-link could not send the invite by DM (${errorLabel(error)})`);
      await replyInChunks(interaction, t('info.invite.dmFailed', { url: invite.url }));
      return;
    }
    await replyInChunks(interaction, t('info.invite.sent'));
  }
}
