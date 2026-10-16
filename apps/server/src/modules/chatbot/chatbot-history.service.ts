import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  CHATBOT_HISTORY_RETENTION_DAYS,
  CHATBOT_RECENT_TURNS,
  CHATBOT_RECENT_TURNS_MAX_CHARS,
  CHATBOT_TURN_ANSWER_MAX_CHARS,
  CHATBOT_TURN_CONTEXT_MAX_BYTES,
  CHATBOT_TURN_QUESTION_MAX_CHARS,
  ChatbotTurnContextSchema,
  ChatbotTurnDeleteRequestSchema,
  ChatbotTurnRecordSchema,
  ChatbotTurnRowSchema,
  ErrorCode,
  SnowflakeSchema,
  escapeLike,
  z,
  type ActorContext,
  type ChatbotRecentTurn,
  type ChatbotTurnContext,
  type ChatbotTurnDeleteResult,
  type ChatbotTurnDetail,
  type ChatbotTurnListQuery,
  type ChatbotTurnRecord,
  type ChatbotTurnRow,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';

/** Rows deleted per statement by the purge and by bulk deletes. */
const PURGE_BATCH = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const ROW_SELECT = {
  id: true,
  channelId: true,
  userId: true,
  triggerMessageId: true,
  replyMessageId: true,
  status: true,
  failureReason: true,
  question: true,
  answer: true,
  model: true,
  llmSource: true,
  inputTokens: true,
  outputTokens: true,
  estimated: true,
  createdAt: true,
} satisfies Prisma.ChatbotTurnSelect;

type RowColumns = Prisma.ChatbotTurnGetPayload<{ select: typeof ROW_SELECT }>;

/** What a turn that has not reached the model has sent it: nothing. */
export const EMPTY_TURN_CONTEXT: ChatbotTurnContext = {
  system: '',
  channelMessages: [],
  memory: {},
  recentTurns: 0,
  attachments: [],
};

const TRUNCATION_MARK = '…';

/** At most `max` characters; a cut text ends in a visible mark so nobody mistakes it for the whole. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - TRUNCATION_MARK.length;
  // Never leave half of a surrogate pair at the cut.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end) + TRUNCATION_MARK;
}

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function toRow(row: RowColumns): ChatbotTurnRow {
  return {
    ...row,
    // The column is free text; only the two sources the pipeline writes are meaningful.
    llmSource: row.llmSource === 'guild' || row.llmSource === 'global' ? row.llmSource : null,
    failureReason:
      ChatbotTurnRowSchema.shape.failureReason.safeParse(row.failureReason).data ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Every chatbot turn of a server: what was asked, what came back and the
 * snapshot of what the model was given. Reads are scoped to one server by its
 * Discord id; a turn of another server is never reachable through an id alone.
 */
@Injectable()
export class ChatbotHistoryService {
  private readonly logger = new Logger(ChatbotHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
  ) {}

  /**
   * Takes a mention in: writes its turn as PENDING, once. `false` when the
   * message already has a turn (a redelivery, or another process got there
   * first), in which case the caller must not answer it. The unique message id
   * decides the winner inside the database, so it holds across processes.
   */
  async claimPending(
    claim: Pick<
      ChatbotTurnRecord,
      'guildId' | 'channelId' | 'userId' | 'triggerMessageId' | 'question'
    >,
  ): Promise<boolean> {
    // Validated before the server row is touched: a bad id must not create one.
    const ids = {
      channelId: parseSnowflake(claim.channelId),
      userId: parseSnowflake(claim.userId),
      triggerMessageId: parseSnowflake(claim.triggerMessageId),
    };
    const guild = await this.guilds.ensureGuild(parseSnowflake(claim.guildId));
    const { count } = await this.prisma.chatbotTurn.createMany({
      data: [
        {
          ...ids,
          guildId: guild.id,
          status: 'PENDING',
          question: clip(claim.question, CHATBOT_TURN_QUESTION_MAX_CHARS),
          context: EMPTY_TURN_CONTEXT,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /**
   * Stores the id of the first reply message as soon as it is out, so a
   * restart that lands before the turn is finished sees the member was already
   * answered and never answers twice.
   */
  async markReplied(triggerMessageId: string, replyMessageId: string): Promise<void> {
    await this.prisma.chatbotTurn.updateMany({
      where: {
        triggerMessageId: parseSnowflake(triggerMessageId),
        status: 'PENDING',
        replyMessageId: null,
      },
      data: { replyMessageId: parseSnowflake(replyMessageId) },
    });
  }

  /** Closes a pending turn with no reply. `false` when it was no longer pending. */
  async expirePending(triggerMessageId: string): Promise<boolean> {
    const { count } = await this.prisma.chatbotTurn.updateMany({
      where: { triggerMessageId: parseSnowflake(triggerMessageId), status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    return count === 1;
  }

  /**
   * Pending turns, oldest first, that were taken in before `createdBefore` and
   * not touched since `idleBefore`, the page after `after`. The page position
   * is a keyset on (createdAt, id) rather than a cursor row: a turn that has
   * since left the pending state would make a cursor on it skip its neighbours.
   * Every server.
   */
  async pendingBefore(options: {
    createdBefore: Date;
    idleBefore: Date;
    take: number;
    after?: { createdAt: Date; id: string };
  }) {
    const { createdBefore, idleBefore, take, after } = options;
    const rows = await this.prisma.chatbotTurn.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: createdBefore },
        updatedAt: { lt: idleBefore },
        ...(after === undefined
          ? {}
          : {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { createdAt: after.createdAt, id: { gt: after.id } },
              ],
            }),
      },
      select: {
        id: true,
        channelId: true,
        userId: true,
        triggerMessageId: true,
        replyMessageId: true,
        reservedTokens: true,
        createdAt: true,
        guild: { select: { discordId: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
    });
    return rows.map(({ guild, ...row }) => ({ ...row, guildId: guild.discordId }));
  }

  /**
   * Finishes a turn with its outcome, only while it is still pending: a turn
   * that is already finished (answered, expired) is never degraded or
   * rewritten. `false` when there was no pending turn to finish. Text over the
   * caps is cut with a visible mark rather than refused, so a long answer that
   * was already sent is not lost from the history. A null `replyMessageId`
   * keeps one stored earlier.
   */
  async finalize(turn: ChatbotTurnRecord): Promise<boolean> {
    const parsed = ChatbotTurnRecordSchema.safeParse({
      ...turn,
      question: clip(turn.question, CHATBOT_TURN_QUESTION_MAX_CHARS),
      answer: turn.answer === null ? null : clip(turn.answer, CHATBOT_TURN_ANSWER_MAX_CHARS),
    });
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { guildId, triggerMessageId, replyMessageId, context, ...rest } = parsed.data;
    // The builder truncates to this cap; a snapshot over it is a bug there and
    // must not fill the table.
    if (Buffer.byteLength(JSON.stringify(context)) > CHATBOT_TURN_CONTEXT_MAX_BYTES) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    }
    const { count } = await this.prisma.chatbotTurn.updateMany({
      // Scoped to the server and to the pending state: nothing else is touched.
      where: { triggerMessageId, guild: { discordId: guildId }, status: 'PENDING' },
      data: {
        status: rest.status,
        failureReason: rest.failureReason,
        question: rest.question,
        answer: rest.answer,
        model: rest.model,
        llmSource: rest.llmSource,
        inputTokens: rest.inputTokens,
        outputTokens: rest.outputTokens,
        estimated: rest.estimated,
        context,
        reservedTokens: 0,
        ...(replyMessageId === null ? {} : { replyMessageId }),
      },
    });
    return count === 1;
  }

  /**
   * The member's latest answered turns in this server, oldest first, at most
   * `CHATBOT_RECENT_TURNS` of them and `CHATBOT_RECENT_TURNS_MAX_CHARS`
   * characters together. When the newest turns already fill the budget, older
   * ones are left out, never a newer one.
   */
  async recentFor(
    guildId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<ChatbotRecentTurn[]> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const rows = await this.prisma.chatbotTurn.findMany({
      where: {
        guild: { discordId: guild },
        userId: user,
        status: 'OK',
        answer: { not: null },
        createdAt: { gte: this.retentionCutoff(CHATBOT_HISTORY_RETENTION_DAYS, now) },
      },
      select: {
        triggerMessageId: true,
        replyMessageId: true,
        question: true,
        answer: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CHATBOT_RECENT_TURNS,
    });

    const kept: ChatbotRecentTurn[] = [];
    let chars = 0;
    for (const row of rows) {
      if (row.answer === null) continue;
      chars += row.question.length + row.answer.length;
      if (chars > CHATBOT_RECENT_TURNS_MAX_CHARS) break;
      kept.push({ ...row, answer: row.answer, createdAt: row.createdAt.toISOString() });
    }
    return kept.reverse();
  }

  /** One page of the server's turns, filtered, sorted and cut in the database. */
  async list(
    guildId: string,
    query: ChatbotTurnListQuery,
  ): Promise<{ items: ChatbotTurnRow[]; total: number }> {
    const guild = parseSnowflake(guildId);
    const needle = query.q?.trim() ?? '';
    const contains = { contains: escapeLike(needle), mode: 'insensitive' as const };
    const where = {
      guild: { discordId: guild },
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.channelId === undefined ? {} : { channelId: query.channelId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.from === undefined && query.to === undefined
        ? {}
        : {
            createdAt: {
              ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
              ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
            },
          }),
      ...(needle === '' ? {} : { OR: [{ question: contains }, { answer: contains }] }),
    } satisfies Prisma.ChatbotTurnWhereInput;
    const direction = query.order;

    const [rows, total] = await Promise.all([
      this.prisma.chatbotTurn.findMany({
        where,
        select: ROW_SELECT,
        orderBy: [{ createdAt: direction }, { id: direction }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.chatbotTurn.count({ where }),
    ]);
    return { items: rows.map(toRow), total };
  }

  /**
   * One turn with its context snapshot, or `null` when this server has no such
   * turn. With `userId` the turn must also be that member's. A snapshot that no
   * longer parses comes back as `null` and is logged. The snapshot holds other
   * members' messages, so only admins are given the detail.
   */
  async get(guildId: string, turnId: string, userId?: string): Promise<ChatbotTurnDetail | null> {
    const guild = parseSnowflake(guildId);
    const parsedId = z.uuid().safeParse(turnId);
    if (!parsedId.success) return null;
    const id = parsedId.data;
    const owner = userId === undefined ? undefined : parseSnowflake(userId);
    const row = await this.prisma.chatbotTurn.findFirst({
      where: { id, guild: { discordId: guild }, ...(owner === undefined ? {} : { userId: owner }) },
      select: { ...ROW_SELECT, context: true },
    });
    if (row === null) return null;
    const { context, ...columns } = row;
    const parsed = ChatbotTurnContextSchema.safeParse(context);
    if (!parsed.success) {
      this.logger.warn(`Chatbot turn ${id} has an unreadable context snapshot`);
    }
    return { ...toRow(columns), context: parsed.success ? parsed.data : null };
  }

  /**
   * Deletes turns of one server by id, by member, or all of them. For scope
   * "turn" a `userId` makes the turn count only if it is that member's. With
   * `dryRun` only the count is reported and nothing is written, audit
   * included. Rows go in batches; the audit row follows the deletion.
   */
  async delete(
    guildId: string,
    request: unknown,
    actor: ActorContext,
  ): Promise<ChatbotTurnDeleteResult> {
    const guild = parseSnowflake(guildId);
    const parsed = ChatbotTurnDeleteRequestSchema.safeParse(request);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { scope, turnId, userId, dryRun } = parsed.data;
    const where = {
      guild: { discordId: guild },
      // A pending turn may hold tokens that only its own end or a restart gives
      // back; deleting it would strand them, so it waits until it has ended.
      status: { not: 'PENDING' },
      ...(scope === 'turn' ? { id: turnId } : {}),
      ...(userId === undefined ? {} : { userId }),
    } satisfies Prisma.ChatbotTurnWhereInput;

    if (dryRun) {
      return { dryRun: true, count: await this.prisma.chatbotTurn.count({ where }) };
    }
    const count = await this.deleteInBatches(where);
    await this.audit.record({
      guildId: guild,
      actor,
      action: AUDIT_ACTIONS.chatbotHistoryDelete,
      params: { scope, userId, turnId, count },
    });
    return { dryRun: false, count };
  }

  /**
   * Deletes turns of every server older than `days` days, a thousand ids at a
   * time so no statement holds many locks. Safe to run again at any point:
   * what is already gone is not looked for. A turn exactly `days` days old is
   * kept. Returns how many it deleted.
   */
  async purgeOlderThan(days: number, now: Date = new Date()): Promise<number> {
    if (!Number.isInteger(days) || days < 1) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    return this.deleteInBatches({ createdAt: { lt: this.retentionCutoff(days, now) } });
  }

  private async deleteInBatches(where: Prisma.ChatbotTurnWhereInput): Promise<number> {
    let deleted = 0;
    for (;;) {
      const batch = await this.prisma.chatbotTurn.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: PURGE_BATCH,
      });
      if (batch.length === 0) break;
      const { count } = await this.prisma.chatbotTurn.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      });
      deleted += count;
      if (batch.length < PURGE_BATCH) break;
    }
    return deleted;
  }

  private retentionCutoff(days: number, now: Date): Date {
    return new Date(now.getTime() - days * DAY_MS);
  }
}
