import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ALLOWED_MENTIONS_NONE,
  AUDIT_ACTIONS,
  AllowedMentionsSchema,
  z,
  type ActorContext,
  type AllowedMentions,
  type ScheduleFailure,
} from '@sab/shared';
import { Client } from 'discord.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { GuildAccessService } from '../../common/guild-access/guild-access.service.js';
import { ErrorReporter } from '../../discord/error-reporter.service.js';
import { buildMessageCopy } from '../../discord/helpers/message-copy.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * How long a worker owns a message it is sending. One send takes seconds; a
 * process that died leaves a lease that lapses, and the message is taken over
 * after that. Shorter risks a slow send being sent twice, longer delays a
 * message after a crash.
 */
export const SCHEDULE_LEASE_MS = 2 * 60_000;

/**
 * Claims before a message is given up on. pg-boss retries a job twice by
 * default, so this matches three runs of the same job.
 */
export const SCHEDULE_MAX_ATTEMPTS = 3;

const ERROR_LABEL_LENGTH = 200;
/** Discord reads a nonce of up to 25 characters. */
const NONCE_LENGTH = 25;

const SYSTEM_ACTOR: ActorContext = { source: 'SYSTEM' };

const CLAIM_SELECT = {
  id: true,
  kind: true,
  channelId: true,
  content: true,
  sourceChannelId: true,
  sourceMessageId: true,
  allowedMentions: true,
  attempts: true,
  source: true,
  createdByUserId: true,
  leaseUntil: true,
  guild: { select: { discordId: true } },
} satisfies Prisma.ScheduledMessageSelect;

/** A message this worker holds the lease of. */
type Claimed = Prisma.ScheduledMessageGetPayload<{ select: typeof CLAIM_SELECT }>;

/**
 * The message cannot go out and trying again will not help. `CANCELED` is for
 * a message that was withdrawn on purpose, `FAILED` for one that broke.
 */
class DeliveryRefusal extends Error {
  constructor(
    readonly status: 'FAILED' | 'CANCELED',
    readonly failure: ScheduleFailure,
  ) {
    super(failure);
    this.name = 'DeliveryRefusal';
  }
}

/** Discord errors that name something only a person can fix, so a retry is pointless. */
const PERMANENT_DISCORD_CODES: ReadonlyMap<number, ScheduleFailure> = new Map([
  [10003, 'CHANNEL_GONE'],
  [10004, 'CHANNEL_GONE'],
  [50001, 'CHANNEL_GONE'],
  [50013, 'NO_PERMISSION'],
  [10008, 'SOURCE_GONE'],
  [40005, 'SEND_REJECTED'],
  [50035, 'SEND_REJECTED'],
]);

/** The server a channel belongs to; undefined for a direct message or a missing channel. */
export function guildIdOf(channel: unknown): string | undefined {
  const guildId = (channel as { guildId?: unknown } | null)?.guildId;
  return typeof guildId === 'string' ? guildId : undefined;
}

/** Discord de-duplicates a send by nonce for a few minutes, so a retry of the same row posts once. */
function nonceOf(id: string): string {
  return id.replaceAll('-', '').slice(-NONCE_LENGTH);
}

/** The mentions the row was stored with; anything unreadable notifies nobody. */
function mentionsOf(stored: unknown): AllowedMentions {
  const parsed = AllowedMentionsSchema.safeParse(stored);
  return parsed.success ? parsed.data : ALLOWED_MENTIONS_NONE;
}

/**
 * Sends one scheduled message under a lease and records how it ended. The
 * worker move is `PENDING` to `SENDING` (one worker wins, the others see
 * nothing to do), send, then `SENT`; a process that dies in between leaves a
 * lease that lapses, and the message is taken over. The worst case is one
 * repeat when the process dies after the send and before `SENT`, which
 * Discord's nonce check absorbs if the retry comes within a few minutes.
 *
 * Every write after the claim is conditional on the lease this worker wrote,
 * so a worker that stalled past its lease can no longer change the row.
 */
@Injectable()
export class ScheduleDelivery {
  private readonly logger = new Logger(ScheduleDelivery.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: Client,
    private readonly resolver: MessageResolver,
    private readonly access: GuildAccessService,
    private readonly reporter: ErrorReporter,
  ) {}

  /**
   * Claims and delivers `scheduleId`. Returns false when there was nothing to
   * do (canceled, already sent, or another worker holds the lease), true when
   * this call took the message and finished with it, whatever the outcome.
   * Throws when the send failed in a way worth retrying: the throw is what
   * makes pg-boss run the job again.
   */
  async run(scheduleId: string): Promise<boolean> {
    const claimed = await this.claim(scheduleId);
    if (claimed === null) return false;
    await this.deliver(claimed);
    return true;
  }

  /**
   * Takes the lease: `PENDING`, or `SENDING` with a lapsed lease, becomes
   * `SENDING` for this worker. Only one concurrent caller gets a row back.
   * Attempts are counted here, so a message whose sender keeps dying is given
   * up on instead of being retried for ever.
   */
  private async claim(scheduleId: string): Promise<Claimed | null> {
    const id = z.uuid().safeParse(scheduleId);
    if (!id.success) return null;
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SCHEDULE_LEASE_MS);

    const won = await this.prisma.scheduledMessage.updateMany({
      where: {
        id: id.data,
        OR: [{ status: 'PENDING' }, { status: 'SENDING', leaseUntil: { lt: now } }],
      },
      data: { status: 'SENDING', leaseUntil, attempts: { increment: 1 } },
    });
    if (won.count !== 1) return null;

    const row = await this.prisma.scheduledMessage.findUnique({
      where: { id: id.data },
      select: CLAIM_SELECT,
    });
    // The value this worker wrote: if somebody took the row over in between,
    // every conditional write below must fail.
    return row !== null && row.leaseUntil?.getTime() === leaseUntil.getTime() ? row : null;
  }

  private async deliver(row: Claimed): Promise<void> {
    let sentId: string;
    try {
      sentId = await this.send(row);
    } catch (error) {
      if (error instanceof DeliveryRefusal) {
        await this.settle(row, { status: error.status, failure: error.failure });
        return;
      }
      await this.retryOrGiveUp(row, error);
      return;
    }
    // Outside the try on purpose: the message is out. A failure to record it
    // leaves the row SENDING and the lease decides what happens next.
    await this.settle(row, { status: 'SENT', messageId: sentId });
  }

  /** Posts the message and returns its id. Throws `DeliveryRefusal` when it never can go out. */
  private async send(row: Claimed): Promise<string> {
    try {
      if (row.source !== 'DISCORD' && !(await this.creatorMayManage(row))) {
        throw new DeliveryRefusal('CANCELED', 'CREATOR_LOST_ACCESS');
      }
      const channel = await this.client.channels.fetch(row.channelId);
      if (channel === null || !channel.isSendable()) {
        throw new DeliveryRefusal('FAILED', 'CHANNEL_GONE');
      }
      if (row.source !== 'DISCORD' && guildIdOf(channel) !== row.guild.discordId) {
        throw new DeliveryRefusal('FAILED', 'CHANNEL_GONE');
      }

      const payload = await this.payloadFor(row);
      const sent = await channel.send({
        ...payload,
        allowedMentions: mentionsOf(row.allowedMentions),
        nonce: nonceOf(row.id),
        enforceNonce: true,
      });
      return sent.id;
    } catch (error) {
      const code = discordErrorCode(error);
      const failure = code === undefined ? undefined : PERMANENT_DISCORD_CODES.get(code);
      throw failure === undefined ? error : new DeliveryRefusal('FAILED', failure);
    }
  }

  private async creatorMayManage(row: Claimed): Promise<boolean> {
    return this.access.canManage(row.createdByUserId, row.guild.discordId, { fresh: true });
  }

  private async payloadFor(row: Claimed) {
    if (row.kind === 'SEND') {
      if (row.content === null) throw new DeliveryRefusal('FAILED', 'SEND_REJECTED');
      return { content: row.content };
    }
    if (row.sourceChannelId === null || row.sourceMessageId === null) {
      throw new DeliveryRefusal('FAILED', 'SOURCE_GONE');
    }
    const resolved = await this.resolver.fetch(`${row.sourceChannelId}/${row.sourceMessageId}`);
    if (resolved.status !== 'OK') throw new DeliveryRefusal('FAILED', 'SOURCE_GONE');
    if (row.source !== 'DISCORD' && resolved.message.guildId !== row.guild.discordId) {
      throw new DeliveryRefusal('FAILED', 'GUILD_MISMATCH');
    }
    const copy = buildMessageCopy(resolved.message);
    if (copy === null) throw new DeliveryRefusal('FAILED', 'SOURCE_EMPTY');
    return copy;
  }

  /**
   * An error that may pass: hand the row back for another try and rethrow so
   * pg-boss runs the job again, or give up once the attempts are used.
   */
  private async retryOrGiveUp(row: Claimed, error: unknown): Promise<void> {
    if (row.attempts >= SCHEDULE_MAX_ATTEMPTS) {
      this.logger.error(`Scheduled message ${row.id} gave up (${errorLabel(error)})`);
      await this.settle(row, { status: 'FAILED', failure: 'GAVE_UP' }, error);
      return;
    }
    await this.release(row, errorLabel(error));
    throw error;
  }

  /**
   * Hands the row back as `PENDING` so the next claim can take it. Conditional
   * on the lease, like every write of a worker, so it cannot undo a takeover.
   * Best effort: the lease lapses anyway.
   */
  private async release(row: Claimed, label: string): Promise<void> {
    try {
      await this.prisma.scheduledMessage.updateMany({
        where: { id: row.id, status: 'SENDING', leaseUntil: row.leaseUntil },
        data: {
          status: 'PENDING',
          leaseUntil: null,
          lastError: label.slice(0, ERROR_LABEL_LENGTH),
        },
      });
    } catch (error) {
      this.logger.warn(`Could not release scheduled message ${row.id} (${errorLabel(error)})`);
    }
  }

  /**
   * Records how a claimed message ended. Applies only while the stored lease is
   * still the one this worker wrote; false (and a warning) when the row was
   * taken over, in which case the new holder records the outcome.
   */
  private async settle(
    row: Claimed,
    outcome:
      | { status: 'SENT'; messageId: string }
      | { status: 'FAILED' | 'CANCELED'; failure: ScheduleFailure },
    cause?: unknown,
  ): Promise<boolean> {
    const sent = outcome.status === 'SENT';
    const recorded = await this.prisma.$transaction(async (tx) => {
      const done = await tx.scheduledMessage.updateMany({
        where: { id: row.id, status: 'SENDING', leaseUntil: row.leaseUntil },
        data: {
          status: outcome.status,
          leaseUntil: null,
          lastError: 'failure' in outcome ? outcome.failure : null,
        },
      });
      if (done.count !== 1) return false;
      await this.audit.record(
        {
          guildId: row.guild.discordId,
          actor: SYSTEM_ACTOR,
          action: row.kind === 'COPY' ? AUDIT_ACTIONS.messageCopy : AUDIT_ACTIONS.messageSend,
          params: {
            scheduleId: row.id,
            channelId: row.channelId,
            kind: row.kind,
            ...('messageId' in outcome ? { messageId: outcome.messageId } : {}),
          },
          ok: sent,
          ...('failure' in outcome ? { error: outcome.failure } : {}),
        },
        tx,
      );
      return true;
    });

    if (!recorded) {
      this.logger.warn(
        `Scheduled message ${row.id} was taken over; ${outcome.status} not recorded`,
      );
      return false;
    }
    if (outcome.status === 'FAILED') {
      await this.reporter.report(
        `Scheduled message ${row.id} in guild ${row.guild.discordId} failed: ${outcome.failure}`,
        cause ?? new Error(outcome.failure),
      );
    }
    return true;
  }
}
