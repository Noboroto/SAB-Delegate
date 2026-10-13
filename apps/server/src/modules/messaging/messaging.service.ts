import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  CopyMessageSchema,
  CreateReactionPollSchema,
  EditBotMessageFromCopySchema,
  EditBotMessageSchema,
  ErrorCode,
  POLL_EMOJIS,
  POLL_PLACEHOLDER_TEXT,
  ReactToMessageSchema,
  SendMessageSchema,
  SnowflakeSchema,
  type ActorContext,
  type AuditAction,
  type CopyMessageResult,
  type CreateReactionPollResult,
  type EditBotMessageResult,
  type MessageTarget,
  type ReactToMessageResult,
  type SendMessageResult,
  z,
} from '@sab/shared';
import {
  Client,
  type Message,
  type MessageMentionOptions,
  type SendableChannels,
  type TextBasedChannel,
} from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { buildMessageCopy } from '../../discord/helpers/message-copy.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { discordFailure, type PermissionKind } from './messaging.errors.js';

type Options = { dryRun?: boolean };

/** A mention in text that would notify somebody, were mentions allowed. */
const PING_PATTERN = /@everyone|@here|<@[!&]?\d{17,20}>/g;

/**
 * Whoever types a slash command in Discord is an admin the server chose to
 * trust with the bot's voice, and the old bot let their mentions through. The
 * API and MCP callers are never given that: a key must not be able to ping a
 * server.
 */
const LEGACY_MENTIONS: MessageMentionOptions = {
  parse: ['users', 'roles', 'everyone'],
  repliedUser: true,
};
const NO_MENTIONS: MessageMentionOptions = { parse: [] };

/** Slash commands follow the bot across servers on purpose; every other door stays in one. */
const isSlash = (actor: ActorContext): boolean => actor.source === 'DISCORD';

const mentionsFor = (actor: ActorContext): MessageMentionOptions =>
  isSlash(actor) ? LEGACY_MENTIONS : NO_MENTIONS;

function pingsIn(content: string, actor: ActorContext): string[] {
  return isSlash(actor) ? [...new Set(content.match(PING_PATTERN) ?? [])] : [];
}

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/** `null` is a direct message, which belongs to no server. */
function parseGuildId(guildId: string | null): string | null {
  if (guildId === null) return null;
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

const guildOf = (channel: TextBasedChannel): string | null =>
  'guildId' in channel ? channel.guildId : null;

/**
 * What the bot says, edits and reacts to in a channel. The slash commands, the
 * context menus, the REST API and the MCP tools all go through here.
 *
 * `guildId` names the server the caller works in. For the REST API and MCP
 * every channel and message touched must belong to it, so a key for one server
 * cannot reach another; a slash command may name any message it can link to
 * (the bot works across servers on purpose), so it is not held to it.
 *
 * Nothing here runs inside a database transaction: the action is Discord's,
 * and the audit row follows once Discord has accepted it. A failed audit write
 * is logged, not thrown, because the action cannot be taken back.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly client: Client,
    private readonly access: ChannelAccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Posts `content`, or replies to `replyTo` (which wins over `channelId`: the
   * reply goes where that message is). With `dryRun` it only checks the
   * target and returns what would be posted.
   */
  async sendMessage(
    guildId: string | null,
    input: unknown,
    actor: ActorContext,
    opts: Options = {},
  ): Promise<SendMessageResult> {
    const guild = parseGuildId(guildId);
    const { channelId, content, replyTo } = parseInput(SendMessageSchema, input);
    const destinationId = replyTo?.channelId ?? channelId;

    const channel = await this.sendableChannel(destinationId, guild, actor);
    const replied =
      replyTo === undefined ? undefined : await this.fetchMessage(channel, replyTo.messageId);
    const plan: SendMessageResult = {
      channelId: destinationId,
      messageId: null,
      replyToMessageId: replyTo?.messageId ?? null,
      content,
      pings: pingsIn(content, actor),
      dryRun: true,
    };
    if (opts.dryRun === true) return plan;

    const allowedMentions = mentionsFor(actor);
    const sent = await this.write<Message>('send', () =>
      replied === undefined
        ? channel.send({ content, allowedMentions })
        : replied.reply({ content, allowedMentions }),
    );
    await this.record(actor, guild, AUDIT_ACTIONS.messageSend, {
      channelId: destinationId,
      messageId: sent.id,
      kind: replied === undefined ? 'send' : 'reply',
    });
    return { ...plan, messageId: sent.id, dryRun: false };
  }

  /** Posts the text and files of `source` in `channelId`; nothing to copy sends nothing. */
  async copyMessage(
    guildId: string | null,
    input: unknown,
    actor: ActorContext,
  ): Promise<CopyMessageResult> {
    const guild = parseGuildId(guildId);
    const { source, channelId } = parseInput(CopyMessageSchema, input);

    const destination = await this.sendableChannel(channelId, guild, actor);
    const original = await this.fetchTarget(source, guild, actor);
    const copy = buildMessageCopy(original);
    if (copy === null) return { status: 'NOTHING_TO_COPY', channelId, messageId: null };

    const sent = await this.write('send', async () => {
      await destination.sendTyping();
      return destination.send({ ...copy, allowedMentions: mentionsFor(actor) });
    });
    await this.record(actor, guild, AUDIT_ACTIONS.messageCopy, {
      channelId,
      messageId: sent.id,
      targetId: source.messageId,
    });
    return { status: 'COPIED', channelId, messageId: sent.id };
  }

  /** Replaces the text of a message this bot sent; any other author is left alone. */
  async editBotMessage(
    guildId: string | null,
    input: unknown,
    actor: ActorContext,
    opts: Options = {},
  ): Promise<EditBotMessageResult> {
    const guild = parseGuildId(guildId);
    const { target, content } = parseInput(EditBotMessageSchema, input);
    const dryRun = opts.dryRun === true;

    const message = await this.fetchTarget(target, guild, actor);
    if (!this.isOwn(message)) return this.editOutcome('NOT_BOT_MESSAGE', target, null, dryRun);
    if (dryRun) return this.editOutcome('EDITED', target, content, true);

    await this.write('other', () => message.edit({ content, allowedMentions: mentionsFor(actor) }));
    await this.record(actor, guild, AUDIT_ACTIONS.messageEdit, {
      channelId: target.channelId,
      messageId: target.messageId,
      kind: 'content',
    });
    return this.editOutcome('EDITED', target, content, false);
  }

  /** Replaces a bot message with the text and files of another message. */
  async editBotMessageFromCopy(
    guildId: string | null,
    input: unknown,
    actor: ActorContext,
  ): Promise<EditBotMessageResult> {
    const guild = parseGuildId(guildId);
    const { target, source } = parseInput(EditBotMessageFromCopySchema, input);

    const message = await this.fetchTarget(target, guild, actor);
    const original = await this.fetchTarget(source, guild, actor);
    if (!this.isOwn(message)) return this.editOutcome('NOT_BOT_MESSAGE', target, null, false);
    const copy = buildMessageCopy(original);
    if (copy === null) return this.editOutcome('NOTHING_TO_COPY', target, null, false);

    await this.write('other', () => message.edit({ ...copy, allowedMentions: mentionsFor(actor) }));
    await this.record(actor, guild, AUDIT_ACTIONS.messageEdit, {
      channelId: target.channelId,
      messageId: target.messageId,
      targetId: source.messageId,
      kind: 'copy',
    });
    return this.editOutcome('EDITED', target, copy.content, false);
  }

  /** Reacts with `emoji`, then with the numbered emoji of a poll; in that order, one at a time. */
  async reactToMessage(
    guildId: string | null,
    input: unknown,
    actor: ActorContext,
  ): Promise<ReactToMessageResult> {
    const guild = parseGuildId(guildId);
    const { target, emoji, pollChoices } = parseInput(ReactToMessageSchema, input);

    const message = await this.fetchTarget(target, guild, actor);
    const emojis = [emoji, ...POLL_EMOJIS.slice(0, pollChoices)];
    // Sequential: Discord rate-limits reactions per message, and the order is the poll's numbering.
    for (const each of emojis) await this.write('other', () => message.react(each));

    await this.record(actor, guild, AUDIT_ACTIONS.messageReact, {
      channelId: target.channelId,
      messageId: target.messageId,
      emoji,
      count: emojis.length,
    });
    return { ...target, count: emojis.length };
  }

  /**
   * Numbers `choices` options on a message with reactions. Without
   * `messageId` a new message is posted to carry them; if the reactions then
   * fail, that message is removed again so no empty poll is left behind.
   */
  async createReactionPoll(
    guildId: string | null,
    input: unknown,
    actor: ActorContext,
    opts: Options = {},
  ): Promise<CreateReactionPollResult> {
    const guild = parseGuildId(guildId);
    const { channelId, messageId, choices } = parseInput(CreateReactionPollSchema, input);
    const emojis = POLL_EMOJIS.slice(0, choices);
    const planned = (id: string | null, isNew: boolean): CreateReactionPollResult => ({
      channelId,
      messageId: id,
      created: isNew,
      emojis: [...emojis],
      dryRun: true,
    });

    let poll: Message;
    let created: boolean;
    if (messageId === undefined) {
      const channel = await this.sendableChannel(channelId, guild, actor);
      if (opts.dryRun === true) return planned(null, true);
      poll = await this.write<Message>('send', () =>
        channel.send({ content: POLL_PLACEHOLDER_TEXT, allowedMentions: NO_MENTIONS }),
      );
      created = true;
    } else {
      poll = await this.fetchTarget({ channelId, messageId }, guild, actor);
      if (opts.dryRun === true) return planned(poll.id, false);
      created = false;
    }

    try {
      for (const each of emojis) await this.write('other', () => poll.react(each));
    } catch (error) {
      if (created) await this.discard(poll);
      throw error;
    }

    await this.record(actor, guild, AUDIT_ACTIONS.pollCreate, {
      channelId,
      messageId: poll.id,
      count: choices,
      kind: created ? 'new' : 'existing',
    });
    return { channelId, messageId: poll.id, created, emojis: [...emojis], dryRun: false };
  }

  private editOutcome(
    status: EditBotMessageResult['status'],
    target: MessageTarget,
    content: string | null,
    dryRun: boolean,
  ): EditBotMessageResult {
    return { status, ...target, content, dryRun };
  }

  private isOwn(message: Message): boolean {
    const me = this.client.user?.id;
    return me !== undefined && message.author.id === me;
  }

  /** Resolves a channel and holds it to the caller's server unless the caller is a slash command. */
  private async fetchChannel(
    channelId: string,
    guild: string | null,
    actor: ActorContext,
  ): Promise<TextBasedChannel> {
    let channel;
    try {
      channel = await this.client.channels.fetch(channelId);
    } catch (error) {
      throw discordFailure(error, 'view');
    }
    if (!channel?.isTextBased()) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    // The same answer as for a channel that does not exist: a key must not learn which ones do.
    if (!isSlash(actor) && guildOf(channel) !== guild) {
      throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    }
    return channel;
  }

  private async sendableChannel(
    channelId: string,
    guild: string | null,
    actor: ActorContext,
  ): Promise<SendableChannels> {
    const channel = await this.fetchChannel(channelId, guild, actor);
    if (!channel.isSendable()) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    // A direct message has no permissions to check; the send itself says if it is closed.
    if (guildOf(channel) !== null) await this.requireAccess(channelId, 'send');
    return channel;
  }

  private async readableChannel(
    channelId: string,
    guild: string | null,
    actor: ActorContext,
  ): Promise<TextBasedChannel> {
    const channel = await this.fetchChannel(channelId, guild, actor);
    if (guildOf(channel) !== null) await this.requireAccess(channelId, 'read');
    return channel;
  }

  private async requireAccess(channelId: string, need: 'send' | 'read'): Promise<void> {
    const access = await this.access.check(channelId, need);
    if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    if (access === 'missing-permissions') {
      throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, {
        permission: need === 'send' ? 'send' : 'view',
      });
    }
  }

  private async fetchTarget(
    target: MessageTarget,
    guild: string | null,
    actor: ActorContext,
  ): Promise<Message> {
    const channel = await this.readableChannel(target.channelId, guild, actor);
    return this.fetchMessage(channel, target.messageId);
  }

  private async fetchMessage(channel: TextBasedChannel, messageId: string): Promise<Message> {
    try {
      return await channel.messages.fetch(messageId);
    } catch (error) {
      throw discordFailure(error, 'view');
    }
  }

  private async write<T>(permission: PermissionKind, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw discordFailure(error, permission);
    }
  }

  private async discard(message: Message): Promise<void> {
    try {
      await message.delete();
    } catch (error) {
      this.logger.warn(
        `Could not remove a poll message left without reactions (${errorLabel(error)})`,
      );
    }
  }

  private async record(
    actor: ActorContext,
    guildId: string | null,
    action: AuditAction,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({ guildId, actor, action, params });
    } catch (error) {
      this.logger.error(`Could not audit ${action} (${errorLabel(error)})`);
    }
  }
}
