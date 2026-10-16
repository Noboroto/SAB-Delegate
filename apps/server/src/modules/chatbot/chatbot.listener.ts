import { Logger } from '@nestjs/common';
import { MessageReferenceType } from 'discord.js';
import { LRUCache } from 'lru-cache';
import { Context, On, type ContextOf } from 'necord';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { ChannelQueue } from '../../discord/helpers/channel-queue.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotService } from './chatbot.service.js';

/**
 * Only guards a task that never ends: an answer has its own 90 s deadline from
 * the moment it gets a slot, and the wait for that slot (longest under load)
 * must not count against it.
 */
const QUEUE_SAFETY_TIMEOUT_MS = 10 * 60_000;

/** Gateway reconnects can deliver a message twice; the second copy within this window is ignored. */
const SEEN_TTL_MS = 60_000;

/** Unknown Message, Unknown Channel, Missing Access, Missing Permissions: routine for a reply target. */
const UNSEEN_MESSAGE_CODES: ReadonlySet<number> = new Set([10008, 10003, 50001, 50013]);

const BUSY_REACTION = '⏳';

/**
 * Turns a mention of the bot (or a reply to one of its messages) in a
 * designated channel into a chatbot reply. Everything else is ignored before
 * any request is made. Errors are left to the exception filter, which reports
 * them to #bot-log.
 */
@DiscordCommands()
export class ChatbotListener {
  private readonly logger = new Logger(ChatbotListener.name);
  private readonly queue = new ChannelQueue(QUEUE_SAFETY_TIMEOUT_MS, 'Waiting for a chat turn');
  private readonly seen = new LRUCache<string, true>({ max: 2000, ttl: SEEN_TTL_MS });
  /** `guild:member` with an answer being prepared; one at a time per member bounds their spend and the reply order. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly config: ChatbotConfigService,
    private readonly service: ChatbotService,
    private readonly ready: DiscordReadyService,
  ) {}

  @On('messageCreate')
  async onMessageCreate(@Context() [message]: ContextOf<'messageCreate'>): Promise<void> {
    if (!message.inGuild() || message.author.bot) return;
    if (this.ready.isStopping()) return;

    const botId = message.client.user.id;
    // @everyone and role pings are not a question to the bot.
    const mentioned = message.mentions.has(message.client.user, {
      ignoreEveryone: true,
      ignoreRoles: true,
    });
    const answersBot = message.mentions.repliedUser?.id === botId;
    // A forwarded message also carries a reference, but it answers nobody.
    const isReply =
      message.reference?.messageId !== undefined &&
      message.reference.type === MessageReferenceType.Default;
    if (!mentioned && !answersBot && !isReply) return;

    // Marked before the first await so two copies of one message cannot both pass.
    if (this.seen.has(message.id)) return;
    this.seen.set(message.id, true);

    // The route is cached, so for a mention the order of arrival is kept in
    // practice; a miss may reorder two mentions in one channel, which only
    // changes who is answered first.
    // A thread belongs to the channel it was started in.
    const { channel } = message;
    const routedChannelId = channel.isThread()
      ? (channel.parentId ?? message.channelId)
      : message.channelId;
    const route = await this.config.routeOf(message.guildId, routedChannelId);
    if (route?.enabled !== true) return;
    if (!mentioned && !answersBot && !(await this.repliesToBotMessage(message))) return;

    if (!(await this.enqueue(message))) await this.showBusy(message);
  }

  /**
   * Answers `message` in its channel's turn. `false` when its author already
   * has an answer being prepared (nothing is queued then). Takes any guild
   * message, so a caller that finds one by other means can use it as well.
   */
  async enqueue(message: Parameters<ChatbotService['handle']>[0]): Promise<boolean> {
    const key = `${message.guildId}:${message.author.id}`;
    if (this.inFlight.has(key)) return false;
    this.inFlight.add(key);
    await this.queue.run(message.channelId, async () => {
      try {
        await this.service.handle(message);
      } finally {
        // Released when the work ends, not when the queue gives up on it: a
        // timed-out answer still runs, and a second one must not overlap it.
        this.inFlight.delete(key);
      }
    });
    return true;
  }

  /** The replied-to payload can be missing (a reply the gateway did not expand); then the message is fetched. */
  private async repliesToBotMessage(message: {
    client: { user: { id: string } };
    fetchReference(): Promise<{ author: { id: string } }>;
  }): Promise<boolean> {
    try {
      const target = await message.fetchReference();
      return target.author.id === message.client.user.id;
    } catch (error) {
      // Whatever stops the bot from seeing that message, it is not a reply to the bot.
      const code = discordErrorCode(error);
      if (code === undefined || !UNSEEN_MESSAGE_CODES.has(code)) {
        this.logger.warn(`Could not read a replied-to message (${errorLabel(error)})`);
      }
      return false;
    }
  }

  private async showBusy(message: { react(emoji: string): Promise<unknown> }): Promise<void> {
    try {
      await message.react(BUSY_REACTION);
    } catch (error) {
      // The message may be gone, or the channel may refuse reactions.
      this.logger.warn(`Could not mark a chat message as busy (${errorLabel(error)})`);
    }
  }
}
