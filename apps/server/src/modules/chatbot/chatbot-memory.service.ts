import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  CHATBOT_SUMMARY_EVERY_TURNS,
  ChatbotMemoryClearRequestSchema,
  ErrorCode,
  SnowflakeSchema,
  type ActorContext,
  type ChatbotMemoryClearResult,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { estimateTokens, LlmChatError, LlmChatService } from '../llm/llm-chat.service.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { buildSummaryPrompt, parseSummaryResponse } from './chatbot-summary-prompt.js';

/** Output budget of a rewrite: two summaries of at most 1500 characters each fit well inside it. */
const SUMMARY_MAX_OUTPUT_TOKENS = 600;

/** Short: the transaction only writes two rows; a stuck one must not hold a pool connection. */
const WRITE_TX = { maxWait: 5_000, timeout: 10_000 } as const;

type SummarizeInput = Pick<
  Parameters<typeof buildSummaryPrompt>[0],
  'speakerName' | 'transcript' | 'recentTurns' | 'question' | 'answer'
> & {
  guildId: string;
  channelId: string;
  /** The member who asked; the rewrite is charged to them and their memory is the one rewritten. */
  userId: string;
};

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * What the bot remembers between conversations: one summary per channel and
 * one per member per server. Every row is reached through the server's
 * Discord id, so a summary never crosses servers; only the speaker's own
 * member summary is handed out for a prompt.
 */
@Injectable()
export class ChatbotMemoryService {
  private readonly logger = new Logger(ChatbotMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly config: ChatbotConfigService,
    private readonly quota: ChatbotQuotaService,
    private readonly chat: LlmChatService,
  ) {}

  /** The channel's summary and the member's own; `null` where nothing is remembered. */
  async read(
    guildId: string,
    channelId: string,
    userId: string,
  ): Promise<{ channel: string | null; user: string | null }> {
    const guild = parseSnowflake(guildId);
    const channel = parseSnowflake(channelId);
    const [channelRow, user] = await Promise.all([
      this.prisma.chatbotChannelMemory.findFirst({
        where: { channelId: channel, guild: { discordId: guild } },
        select: { summary: true },
      }),
      this.getOwn(guild, userId),
    ]);
    return { channel: channelRow?.summary || null, user };
  }

  /** The member's own summary for `/chat memory`; nothing else is ever returned through it. */
  async getOwn(guildId: string, userId: string): Promise<string | null> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const row = await this.prisma.chatbotUserMemory.findFirst({
      where: { userId: user, guild: { discordId: guild } },
      select: { summary: true },
    });
    // A row created by the counter before the first rewrite holds an empty summary.
    return row?.summary || null;
  }

  /**
   * Counts one more reply of the member and says whether their summary is due.
   * One statement, so parallel replies of the member never lose a count.
   */
  async noteTurn(guildId: string, userId: string): Promise<{ due: boolean }> {
    const guild = parseSnowflake(guildId);
    const user = parseSnowflake(userId);
    const key = await this.guildKey(guild);
    const rows = await this.prisma.$queryRaw<{ turns: number }[]>`
      INSERT INTO "ChatbotUserMemory" ("guildId", "userId", "summary", "turnsSinceSummary", "updatedAt")
      VALUES (${key}::uuid, ${user}, '', 1, now())
      ON CONFLICT ("guildId", "userId") DO UPDATE
      SET "turnsSinceSummary" = "ChatbotUserMemory"."turnsSinceSummary" + 1
      RETURNING "turnsSinceSummary" AS "turns"`;
    return { due: (rows[0]?.turns ?? 0) >= CHATBOT_SUMMARY_EVERY_TURNS };
  }

  /**
   * Rewrites the channel's and the member's summaries from the exchange that
   * just happened, charging the member's quota. Call it when `noteTurn` said
   * due: it first claims `CHATBOT_SUMMARY_EVERY_TURNS` of the member's counted
   * turns in one statement, so only one of several concurrent calls proceeds
   * and turns counted while it runs are kept. `skipped`: nothing was asked (no
   * turns to claim, no model, or no allowance left). `failed`: the model call
   * or its answer was unusable. A failed call and a skip give the claimed
   * turns back; an unusable answer does not, so a model that cannot produce
   * the JSON is asked again only after another full round of replies, not on
   * every one. Nothing but the row writes runs inside a transaction.
   */
  async summarize(input: SummarizeInput): Promise<'updated' | 'skipped' | 'failed'> {
    const guild = parseSnowflake(input.guildId);
    const channel = parseSnowflake(input.channelId);
    const user = parseSnowflake(input.userId);

    const resolved = await this.config.resolveTarget(guild);
    if (resolved === null) return 'skipped';
    const claim = await this.claimTurns(guild, user);
    if (claim === null) return 'skipped';

    let keepTurns = false;
    try {
      const channelRow = await this.prisma.chatbotChannelMemory.findFirst({
        where: { channelId: channel, guildId: claim.guildId },
        select: { id: true, summary: true },
      });
      const prompt = buildSummaryPrompt({
        speakerName: input.speakerName,
        previousChannel: channelRow?.summary || null,
        previousUser: claim.summary || null,
        transcript: input.transcript,
        recentTurns: input.recentTurns,
        question: input.question,
        answer: input.answer,
      });
      const estimate =
        estimateTokens(prompt.system.length + prompt.user.length) + SUMMARY_MAX_OUTPUT_TOKENS;
      const held = await this.quota.reserve(guild, user, estimate);
      if ('exhausted' in held) return 'skipped';

      let result: Awaited<ReturnType<LlmChatService['chat']>>;
      try {
        result = await this.chat.chat(resolved.target, {
          system: prompt.system,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
          maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        });
      } catch (error) {
        await this.giveBack(guild, user, held);
        if (error instanceof LlmChatError) {
          this.logger.warn(`Chatbot summary call failed for server ${guild}: ${error.reason}`);
          return 'failed';
        }
        throw error;
      }
      keepTurns = true;

      // The tokens are spent whether or not the answer is usable.
      try {
        await this.quota.settle(guild, user, held.period, held.reserved, result.usage.total);
      } catch (error) {
        this.logger.error(`Chatbot summary settle failed for server ${guild}`, error);
      }

      const summaries = parseSummaryResponse(result.text);
      if (summaries === null) {
        this.logger.warn(`Chatbot summary answer for server ${guild} held no usable JSON`);
        return 'failed';
      }
      await this.store(claim, channel, channelRow?.id ?? null, summaries);
      return 'updated';
    } finally {
      if (!keepTurns) await this.returnTurns(guild, claim.id);
    }
  }

  /**
   * Forgets what the bot remembers: one member, one channel or the whole
   * server, only in that server. `dryRun` only counts. A real clear writes one
   * audit row with ids and the count, never the summaries. The member clearing
   * their own memory goes through here with themself as the actor.
   */
  async clear(
    guildId: string,
    request: unknown,
    actor: ActorContext,
  ): Promise<ChatbotMemoryClearResult> {
    const guild = parseSnowflake(guildId);
    const parsed = ChatbotMemoryClearRequestSchema.safeParse(request);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { scope, userId, channelId, dryRun } = parsed.data;
    const inGuild = { guild: { discordId: guild } };
    const userWhere = { ...inGuild, ...(userId === undefined ? {} : { userId }) };
    const channelWhere = { ...inGuild, ...(channelId === undefined ? {} : { channelId }) };
    const touchesUsers = scope !== 'channel';
    const touchesChannels = scope !== 'user';

    if (dryRun) {
      const [userMemories, channelMemories] = await Promise.all([
        touchesUsers ? this.prisma.chatbotUserMemory.count({ where: userWhere }) : 0,
        touchesChannels ? this.prisma.chatbotChannelMemory.count({ where: channelWhere }) : 0,
      ]);
      return { dryRun: true, userMemories, channelMemories };
    }

    return this.prisma.$transaction(async (tx) => {
      const userMemories = touchesUsers
        ? (await tx.chatbotUserMemory.deleteMany({ where: userWhere })).count
        : 0;
      const channelMemories = touchesChannels
        ? (await tx.chatbotChannelMemory.deleteMany({ where: channelWhere })).count
        : 0;
      await this.audit.record(
        {
          guildId: guild,
          actor,
          action: AUDIT_ACTIONS.chatbotMemoryClear,
          params: { scope, userId, channelId, count: userMemories + channelMemories },
        },
        tx,
      );
      return { dryRun: false, userMemories, channelMemories };
    }, WRITE_TX);
  }

  /**
   * Takes the turns a rewrite covers. The row lock makes a concurrent claim
   * re-check the count after the winner commits, so it finds too few turns
   * and gets nothing.
   */
  private async claimTurns(
    guild: string,
    user: string,
  ): Promise<{ id: string; guildId: string; summary: string } | null> {
    const rows = await this.prisma.$queryRaw<{ id: string; guildId: string; summary: string }[]>`
      UPDATE "ChatbotUserMemory"
      SET "turnsSinceSummary" = "turnsSinceSummary" - ${CHATBOT_SUMMARY_EVERY_TURNS}::int
      WHERE "userId" = ${user}
        AND "guildId" = (SELECT "id" FROM "Guild" WHERE "discordId" = ${guild})
        AND "turnsSinceSummary" >= ${CHATBOT_SUMMARY_EVERY_TURNS}::int
      RETURNING "id", "guildId", "summary"`;
    return rows[0] ?? null;
  }

  /** Puts claimed turns back after a rewrite that did not happen. A cleared row has none to restore. */
  private async returnTurns(guild: string, rowId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "ChatbotUserMemory"
        SET "turnsSinceSummary" = "turnsSinceSummary" + ${CHATBOT_SUMMARY_EVERY_TURNS}::int
        WHERE "id" = ${rowId}::uuid`;
    } catch (error) {
      this.logger.error(`Chatbot summary could not return its turns for server ${guild}`, error);
    }
  }

  /**
   * Writes the new summaries without undoing a clear that ran meanwhile: the
   * member's row is updated by the id claimed at the start, so a row that was
   * cleared (or cleared and recreated) is left alone; the channel's row is
   * updated by its id, and created only if it did not exist at the start.
   * An empty summary keeps what was there. Two members rewriting the same
   * channel at once: the last write wins, both saw the same transcript window.
   */
  private async store(
    claim: { id: string; guildId: string },
    channelId: string,
    channelRowId: string | null,
    summaries: { channel: string; user: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (summaries.user !== '') {
        await tx.chatbotUserMemory.updateMany({
          where: { id: claim.id },
          data: { summary: summaries.user },
        });
      }
      if (summaries.channel === '') return;
      if (channelRowId !== null) {
        await tx.chatbotChannelMemory.updateMany({
          where: { id: channelRowId },
          data: { summary: summaries.channel },
        });
      } else {
        // Created only when the channel had no memory when the turns were claimed.
        // Accepted gap: if another member's rewrite creates the row mid-call and an
        // admin clears it, this insert brings a pre-clear summary back.
        await tx.chatbotChannelMemory.createMany({
          data: [{ guildId: claim.guildId, channelId, summary: summaries.channel }],
          skipDuplicates: true,
        });
      }
    }, WRITE_TX);
  }

  /** A failed refund must not hide the call's own outcome; the reservation then stays charged. */
  private async giveBack(
    guild: string,
    user: string,
    held: { reserved: number; period: string },
  ): Promise<void> {
    try {
      await this.quota.refund(guild, user, held.period, held.reserved);
    } catch (error) {
      this.logger.error(`Chatbot summary refund failed for server ${guild}`, error);
    }
  }

  /** The server's row key; a server the bot is in but never recorded gets its row here. */
  private async guildKey(discordId: string): Promise<string> {
    const guild = await this.prisma.guild.findUnique({
      where: { discordId },
      select: { id: true },
    });
    if (guild !== null) return guild.id;
    return (await this.guilds.ensureGuild(discordId)).id;
  }
}
