import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CHATBOT_RECOVERY_MAX_AGE_MS } from '@sab/shared';
import { Client } from 'discord.js';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotListener } from './chatbot.listener.js';

/** Pending turns read per query. */
const BATCH = 50;

/**
 * A turn touched this recently may still be answered by the process that is
 * being replaced (its answer deadline plus a margin), so the first sweep leaves
 * it alone.
 */
const IN_FLIGHT_GRACE_MS = 120_000;

/** The one second sweep, for turns that were too fresh at start; after the grace has passed. */
const SECOND_SWEEP_DELAY_MS = 130_000;

/** Messages after the trigger searched for a reply the bot already sent. */
const REPLY_SEARCH_LIMIT = 20;

/** Unknown Message, Unknown Channel, Missing Access: the message cannot be answered any more. */
const UNREACHABLE_CODES: ReadonlySet<number> = new Set([10008, 10003, 50001]);

type Replayable = Parameters<ChatbotListener['enqueue']>[0];

type Pending = Awaited<ReturnType<ChatbotHistoryService['pendingBefore']>>[number];

type ReplyCandidate = {
  id: string;
  author: { id: string };
  reference?: { messageId?: string | null } | null;
};

type MessagesPort = {
  fetch(id: string): Promise<Replayable>;
  fetch(options: { after: string; limit: number }): Promise<{ values(): Iterable<ReplyCandidate> }>;
};

/** The slice of a fetched channel recovery uses; threads answer through their parent's route. */
type ChannelPort = {
  isThread(): boolean;
  parentId?: string | null;
  messages?: MessagesPort;
};

type ClientPort = {
  user: { id: string } | null;
  channels: { fetch(id: string): Promise<ChannelPort | null> };
};

type Inspection =
  | { kind: 'gone' }
  | { kind: 'answered'; replyId: string }
  | { kind: 'replay'; message: Replayable };

type Tally = { replayed: number; expired: number; refunded: number; failed: number };

/**
 * After a restart, answers the mentions the previous process cut off. Each
 * pending turn written before this process started is first relieved of the
 * tokens it held (exactly once), then either replayed through the listener's
 * own queue, when it is recent and still in a chatbot channel, or closed with
 * no reply. A turn that already has a reply, or that the bot is found to have
 * answered already, is closed, never answered again. Turns written after this
 * process started belong to it and are left alone.
 *
 * A pending turn older than the recovery window expires without a reply: that
 * is the owner's decision, an answer that late would only confuse the channel.
 * Turns touched in the last two minutes may still be in the hands of the
 * process being replaced; the first sweep skips them and one more sweep, after
 * that grace, picks up what is left.
 */
@Injectable()
export class ChatbotRecoveryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ChatbotRecoveryService.name);
  private readonly bootedAt = new Date();
  /** Replays under way; each runs to its end on its own and reports its own failure. */
  private readonly replays = new Set<Promise<void>>();
  /** Turns already handed to the listener, so a later sweep never replays one twice. */
  private readonly replayed = new Set<string>();
  private secondSweep: NodeJS.Timeout | undefined;

  constructor(
    private readonly history: ChatbotHistoryService,
    private readonly quota: ChatbotQuotaService,
    private readonly config: ChatbotConfigService,
    private readonly listener: ChatbotListener,
    private readonly ready: DiscordReadyService,
    @Inject(Client) private readonly client: ClientPort,
  ) {}

  onApplicationBootstrap(): void {
    this.ready.afterReady('chatbot-recovery', async () => {
      await this.sweep();
      this.secondSweep = setTimeout(() => void this.sweep(), SECOND_SWEEP_DELAY_MS);
      this.secondSweep.unref();
    });
  }

  onModuleDestroy(): void {
    clearTimeout(this.secondSweep);
  }

  /** Never throws: a failed recovery must not keep the bot from running; the counts are logged. */
  async sweep(now: Date = new Date()): Promise<void> {
    const tally: Tally = { replayed: 0, expired: 0, refunded: 0, failed: 0 };
    try {
      const idleBefore = new Date(now.getTime() - IN_FLIGHT_GRACE_MS);
      let after: { createdAt: Date; id: string } | undefined;
      for (;;) {
        const batch = await this.history.pendingBefore({
          createdBefore: this.bootedAt,
          idleBefore,
          take: BATCH,
          after,
        });
        for (const row of batch) {
          if (this.ready.isStopping()) return;
          await this.recover(row, now, tally);
        }
        const last = batch.at(-1);
        after = last === undefined ? undefined : { createdAt: last.createdAt, id: last.id };
        if (batch.length < BATCH) break;
      }
    } catch (error) {
      tally.failed += 1;
      this.logger.error(`Chatbot recovery stopped early (${errorLabel(error)})`);
    } finally {
      this.logger.log(
        `Chatbot recovery: ${tally.replayed} replayed, ${tally.expired} expired, ` +
          `${tally.refunded} refunded, ${tally.failed} failed`,
      );
    }
  }

  private async recover(row: Pending, now: Date, tally: Tally): Promise<void> {
    if (this.replayed.has(row.triggerMessageId)) return;
    try {
      await this.refund(row, tally);
      if (
        row.replyMessageId !== null ||
        now.getTime() - row.createdAt.getTime() > CHATBOT_RECOVERY_MAX_AGE_MS
      ) {
        await this.expire(row, tally);
        return;
      }
      const found = await this.inspect(row);
      if (found.kind === 'answered') {
        // Sent just before the previous process stopped; keep the id, send nothing.
        await this.history.markReplied(row.triggerMessageId, found.replyId);
      }
      if (found.kind !== 'replay') {
        await this.expire(row, tally);
        return;
      }
      tally.replayed += 1;
      this.replay(row, found.message);
    } catch (error) {
      // The turn stays pending; the next start looks at it again while it is young enough.
      tally.failed += 1;
      this.logger.warn(`Could not recover a chatbot turn (${errorLabel(error)})`);
    }
  }

  /** The turn row hands its hold to one taker, and the refund commits with it: at most once, never lost half-way. */
  private async refund(row: Pending, tally: Tally): Promise<void> {
    if (row.reservedTokens <= 0) return;
    try {
      const given = await this.quota.refundTurn(row.guildId, row.userId, row.triggerMessageId);
      if (given > 0) tally.refunded += 1;
    } catch (error) {
      // Rolled back as a whole: the hold is still on the row for the next start.
      tally.failed += 1;
      this.logger.error(`Chatbot recovery could not give tokens back (${errorLabel(error)})`);
    }
  }

  private async expire(row: Pending, tally: Tally): Promise<void> {
    if (await this.history.expirePending(row.triggerMessageId)) tally.expired += 1;
  }

  /** What can still be done for the turn: nothing, nothing more (already answered), or answer it. */
  private async inspect(row: Pending): Promise<Inspection> {
    try {
      const channel = await this.client.channels.fetch(row.channelId);
      if (channel?.messages === undefined) return { kind: 'gone' };
      // A thread belongs to the channel it was started in.
      const routed = channel.isThread() ? (channel.parentId ?? row.channelId) : row.channelId;
      const route = await this.config.routeOf(row.guildId, routed);
      if (route?.enabled !== true) return { kind: 'gone' };
      const message = await channel.messages.fetch(row.triggerMessageId);
      const replyId = await this.findReply(channel.messages, row.triggerMessageId);
      return replyId === undefined ? { kind: 'replay', message } : { kind: 'answered', replyId };
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && UNREACHABLE_CODES.has(code)) return { kind: 'gone' };
      throw error;
    }
  }

  /** A message of the bot that answers the trigger, among the few right after it. */
  private async findReply(
    messages: MessagesPort,
    triggerMessageId: string,
  ): Promise<string | undefined> {
    const botId = this.client.user?.id;
    if (botId === undefined) return undefined;
    const after = await messages.fetch({ after: triggerMessageId, limit: REPLY_SEARCH_LIMIT });
    for (const candidate of after.values()) {
      if (candidate.author.id === botId && candidate.reference?.messageId === triggerMessageId) {
        return candidate.id;
      }
    }
    return undefined;
  }

  /** Through the listener's queue, so its per-member lock and per-channel order still apply. */
  private replay(row: Pending, message: Replayable): void {
    this.replayed.add(row.triggerMessageId);
    const job = this.listener
      .enqueue(message)
      .then(async (accepted) => {
        // The member is being answered for a newer message: this one is dropped.
        if (!accepted) await this.history.expirePending(row.triggerMessageId);
      })
      .catch((error: unknown) => {
        this.logger.warn(`A replayed chatbot turn failed (${errorLabel(error)})`);
      })
      .finally(() => this.replays.delete(job));
    this.replays.add(job);
  }
}
