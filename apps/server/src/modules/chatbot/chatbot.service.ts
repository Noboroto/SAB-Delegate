import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  CHATBOT_MAX_OUTPUT_TOKENS,
  formatTokenCount,
  type ChatbotTurnRecord,
  type Locale,
} from '@sab/shared';
import { LRUCache } from 'lru-cache';
import pLimit from 'p-limit';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import {
  estimateTokens,
  LlmChatError,
  LlmChatService,
  type ChatFailureReason,
} from '../llm/llm-chat.service.js';
import type { LlmTarget } from '../llm/llm.service.js';
import { loadAttachments } from './chatbot-attachments.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotContextService } from './chatbot-context.service.js';
import { ChatbotHistoryService, EMPTY_TURN_CONTEXT } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotPauseService, pauseKeyOf } from '../llm/chatbot-pause.service.js';
import { authorLabel, buildChatPrompt } from './chatbot-prompt.js';
import { mentionMembers } from './chatbot-mentions.js';
import { resetMarkup } from './chatbot-period.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { formatReply } from './chatbot.format.js';

/**
 * Replies in flight at once, across every server. Kept apart from the word
 * explanations' own limiter so a busy chat never delays them (or the reverse).
 */
const CHAT_CONCURRENCY = 3;

const CALL_TIMEOUT_MS = 60_000;

/**
 * Longest one reply may take once it has a slot. The wait for a slot is not
 * counted: under load it can be long, and that is not the reply's fault. The
 * reply keeps running past this and still settles its tokens.
 */
const ANSWER_TIMEOUT_MS = 90_000;

/** Discord: Unknown Message, and the Invalid Form Body it answers a reply to a deleted message with. */
const REPLY_TARGET_GONE_CODES: ReadonlySet<number> = new Set([10008, 50035]);

/** Shown as the question when the member sent nothing but the mention. */
const NO_CONTENT = '(không có nội dung)';

/** Discord shows "typing" for about 10 s; refreshing sooner keeps it on through a slow call. */
const TYPING_REFRESH_MS = 8_000;

/** Longest shutdown waits for replies and memory rewrites still running. */
const SHUTDOWN_WAIT_MS = 20_000;

/** One warning per server per this long for a rejected key: every message would otherwise repeat it. */
const KEY_WARNING_TTL_MS = 10 * 60_000;

type Translator = ReturnType<typeof translatorFor>;

/**
 * What a reply needs of the message that addressed the bot. Structural on
 * purpose: Necord types its events with the ESM build of discord.js, whose
 * `Message` class is not assignable to the CommonJS one imported here.
 */
type TriggerMessage = Parameters<ChatbotContextService['collectFrom']>[0] & {
  guildId: string;
  channelId: string;
  /** Only to find `#bot-log` when a model's provider runs out of credit. */
  client: { guilds: { cache: { get(id: string): unknown } } };
  reply(options: {
    content: string;
    allowedMentions: { parse: []; repliedUser: boolean };
    failIfNotExists: boolean;
  }): Promise<{ id: string }>;
  channel: {
    send(options: {
      content: string;
      allowedMentions: { parse: []; users?: string[] };
    }): Promise<{ id: string }>;
    sendTyping(): Promise<unknown>;
  };
};

type ChatResult = Awaited<ReturnType<LlmChatService['chat']>>;

/**
 * Tokens held for the model call. `durable`: the hold is also written on the
 * turn row, so settling or refunding goes through the row, which gives it to
 * one taker only.
 */
type Reservation = { reserved: number; period: string; durable: boolean };

/** The member's month as the footer shows it. */
type Standing = { remaining: number; total: number };

type TurnFields = Omit<
  ChatbotTurnRecord,
  'guildId' | 'channelId' | 'userId' | 'triggerMessageId' | 'replyMessageId'
>;

type Learned = Omit<
  Parameters<ChatbotMemoryService['summarize']>[0],
  'guildId' | 'channelId' | 'userId'
>;

/** What to say, what the footer shows, and what to remember of the turn. */
type Answer = {
  body: string;
  standing: Standing;
  turn: TurnFields;
  /** Only an answered turn is fed to the member's memory. */
  learned?: Learned;
};

/** The question as normal turns store it: the text without the mention of the bot. */
function questionOf(message: TriggerMessage): string {
  const botName = message.guild.members.me?.displayName ?? message.client.user.displayName;
  const text = message.cleanContent.split(`@${botName}`).join('').trim();
  return text === '' ? NO_CONTENT : text;
}

function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

function bareTurn(
  status: 'QUOTA_EXHAUSTED' | 'NOT_CONFIGURED' | 'FAILED',
  question: string,
): TurnFields {
  return {
    status,
    failureReason: null,
    question,
    answer: null,
    model: null,
    llmSource: null,
    inputTokens: 0,
    outputTokens: 0,
    estimated: false,
    context: EMPTY_TURN_CONTEXT,
  };
}

/**
 * One reply of the chatbot, from the mention to the footer: the member's
 * allowance is checked, the channel read, the model asked and the answer sent
 * with the allowance left after this very reply. The tokens set aside for the
 * call are settled or given back on every path, once.
 */
@Injectable()
export class ChatbotService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly limiter = pLimit(CHAT_CONCURRENCY);
  /** Replies and memory rewrites not finished yet; shutdown waits for them (briefly). */
  private readonly running = new Set<Promise<void>>();
  private readonly rejectedKeys = new LRUCache<string, true>({
    max: 500,
    ttl: KEY_WARNING_TTL_MS,
  });
  private closing = false;

  constructor(
    private readonly config: ChatbotConfigService,
    private readonly quota: ChatbotQuotaService,
    private readonly context: ChatbotContextService,
    private readonly memory: ChatbotMemoryService,
    private readonly history: ChatbotHistoryService,
    private readonly llm: LlmChatService,
    private readonly locales: GuildLocaleService,
    private readonly pause: ChatbotPauseService,
  ) {}

  /** Answers the message that addressed the bot. A Discord failure on the way out is logged, not thrown. */
  handle(message: TriggerMessage): Promise<void> {
    return this.limiter(() => {
      const job = this.respond(message);
      this.track(job);
      return withDeadline(job, ANSWER_TIMEOUT_MS, 'Answering a chat message');
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.running.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
    });
    await Promise.race([Promise.all([...this.running]), cap]).finally(() => clearTimeout(timer));
    if (this.running.size > 0) {
      this.logger.warn(`${this.running.size} chatbot job(s) were still running at shutdown`);
    }
  }

  private async respond(message: TriggerMessage): Promise<void> {
    if (this.closing) return;
    const { guildId, channelId } = message;
    const userId = message.author.id;
    const locale = await this.locales.resolve(guildId);
    const t = translatorFor(locale);

    let answer: Answer;
    try {
      answer = await this.answer(message, t);
    } catch (error) {
      // A bug: the member still gets an apology, and the error still reaches #bot-log.
      await this.apologize(message, t, locale);
      await this.closeFailed(message);
      throw error;
    }
    const replyMessageId = await this.send(
      message,
      answer.body,
      this.footerOf(t, locale, answer.standing),
    );
    await this.finalize(message, replyMessageId, answer.turn);
    if (answer.learned !== undefined && replyMessageId !== null) {
      this.remember(guildId, channelId, userId, answer.learned);
    }
  }

  private footerOf(t: Translator, locale: Locale, standing: Standing): string {
    return t('chatbot.footer', {
      remaining: formatTokenCount(standing.remaining, locale),
      total: formatTokenCount(standing.total, locale),
      // The standing is always this month's, so the allowance renews at the next month start.
      reset: resetMarkup(new Date()),
    });
  }

  /** Best effort: with no allowance figure there is no footer, and then no apology either. */
  private async apologize(message: TriggerMessage, t: Translator, locale: Locale): Promise<void> {
    try {
      const standing = await this.quota.limitOf(message.guildId, message.author.id);
      await this.send(message, t('chatbot.failed'), this.footerOf(t, locale, standing));
    } catch (error) {
      this.logger.warn(`Could not apologise for a failed chatbot reply (${errorLabel(error)})`);
    }
  }

  /**
   * Decides the reply. Whatever is set aside for the model call is settled,
   * or given back, before this returns or throws.
   */
  private async answer(message: TriggerMessage, t: Translator): Promise<Answer> {
    const { guildId } = message;
    const userId = message.author.id;
    const [resolved, before] = await Promise.all([
      this.config.resolveTarget(guildId),
      this.quota.limitOf(guildId, userId),
    ]);
    const asked = questionOf(message);
    if (resolved === null) {
      return {
        body: t('chatbot.notConfigured'),
        standing: before,
        turn: bareTurn('NOT_CONFIGURED', asked),
      };
    }
    if (before.remaining === 0) {
      return {
        body: t('chatbot.quotaExhausted'),
        standing: before,
        turn: bareTurn('QUOTA_EXHAUSTED', asked),
      };
    }

    // The model's provider has no credit left: no point in reading the channel or paying for a call.
    const { target } = resolved;
    const pauseKey = pauseKeyOf(
      resolved.source === 'guild' ? guildId : null,
      target.baseUrl,
      target.model,
      target.apiKey.slice(-4),
    );
    const ticket = this.pause.admit(pauseKey);
    if (ticket === null) {
      return {
        body: t('chatbot.paused'),
        standing: before,
        turn: {
          ...bareTurn('FAILED', asked),
          failureReason: 'provider_quota',
          model: target.model,
          llmSource: resolved.source,
        },
      };
    }

    const stopTyping = this.keepTyping(message);
    // Set from the moment tokens are held until they are settled or returned.
    let held: Reservation | null = null;
    // The admitted call may be the single probe after a pause; its outcome must always reach the pause.
    let reported = false;
    try {
      const [context, memory, recentTurns] = await Promise.all([
        this.context.collectFrom(message),
        this.memory.read(guildId, message.channelId, userId),
        this.history.recentFor(guildId, userId),
      ]);
      const attachments = await loadAttachments(context.attachments);
      const prompt = buildChatPrompt({
        context,
        attachments,
        recentTurns,
        now: new Date(),
        channelMemory: memory.channel ?? undefined,
        userMemory: memory.user ?? undefined,
      });

      const estimate =
        estimateTokens(prompt.estimateChars, prompt.imageCount) + CHATBOT_MAX_OUTPUT_TOKENS;
      const reservation = await this.quota.reserveForTurn(guildId, userId, estimate, message.id);
      if ('exhausted' in reservation) {
        return {
          body: t('chatbot.quotaExhausted'),
          standing: reservation.quota,
          turn: bareTurn('QUOTA_EXHAUSTED', context.triggerText),
        };
      }
      // The hold is on the turn row already: it was written with the reservation.
      const hold: Reservation = reservation;
      held = hold;

      const { model } = target;
      const asking = await this.ask(target, prompt);
      reported = true;
      this.noteOutcome(
        message,
        resolved,
        pauseKey,
        ticket,
        'reason' in asking ? asking.reason : null,
      );
      if ('reason' in asking) {
        held = null;
        await this.giveBack(message.id, guildId, userId, hold);
        if (asking.reason === 'unauthorized') this.warnRejectedKey(guildId, resolved.source);
        return {
          body: t(asking.reason === 'provider_quota' ? 'chatbot.paused' : 'chatbot.failed'),
          standing: await this.currentOr(guildId, userId, before),
          turn: {
            status: 'FAILED',
            failureReason: asking.reason,
            question: context.triggerText,
            answer: null,
            model,
            llmSource: resolved.source,
            inputTokens: 0,
            outputTokens: 0,
            estimated: false,
            context: prompt.snapshot,
          },
        };
      }

      const { result } = asking;
      held = null;
      const standing = await this.settle(
        message.id,
        guildId,
        userId,
        hold,
        result.usage.total,
        before,
      );
      // Only members the model was shown can be pinged, and a plain @Name of one becomes a mention.
      const shownLines =
        context.replied === null ? context.messages : [context.replied, ...context.messages];
      const text = mentionMembers(result.text.trim(), [
        { id: context.speaker.id, name: authorLabel(context.speaker.name) },
        ...shownLines.map((line) => ({ id: line.authorId, name: authorLabel(line.authorName) })),
      ]);
      const body = result.cut ? `${text}…` : text;
      return {
        body,
        standing,
        turn: {
          status: 'OK',
          failureReason: null,
          question: context.triggerText,
          answer: body,
          model,
          llmSource: resolved.source,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimated: result.usage.estimated,
          context: prompt.snapshot,
        },
        learned: {
          speakerName: context.speaker.name,
          transcript: context.messages.map((line) => ({
            authorName: line.authorName,
            text: line.text,
          })),
          recentTurns: recentTurns.map((turn) => ({
            question: turn.question,
            answer: turn.answer,
          })),
          question: context.triggerText,
          answer: body,
        },
      };
    } finally {
      stopTyping();
      if (!reported) this.pause.release(pauseKey, ticket);
      if (held !== null) await this.giveBack(message.id, guildId, userId, held);
    }
  }

  /**
   * Tells the pause how the call ended. The first refusal of an outage also
   * alerts the admins, in the background: a slow Discord send must not hold
   * the member's slot or their refund.
   */
  private noteOutcome(
    message: TriggerMessage,
    resolved: { target: LlmTarget; source: 'guild' | 'global' },
    key: string,
    ticket: number,
    reason: ChatFailureReason | null,
  ): void {
    if (reason === null) {
      this.pause.succeed(key, ticket);
      return;
    }
    if (reason !== 'provider_quota') {
      this.pause.release(key, ticket);
      return;
    }
    const guildId = resolved.source === 'guild' ? message.guildId : null;
    const { started, until } = this.pause.trip(key, guildId, ticket);
    if (!started) return;
    this.logger.warn(
      `The ${resolved.source} chatbot model ran out of provider credit; paused until ${until.toISOString()}`,
    );
    this.track(
      this.pause.announce(message.client, this.config.alertGuildId, {
        guildId,
        baseUrl: resolved.target.baseUrl,
        model: resolved.target.model,
        until,
      }),
    );
  }

  /** An empty answer is a failure: the member got nothing for their tokens. */
  private async ask(
    target: LlmTarget,
    prompt: ReturnType<typeof buildChatPrompt>,
  ): Promise<{ result: ChatResult } | { reason: ChatFailureReason }> {
    try {
      const result = await this.llm.chat(target, {
        system: prompt.system,
        messages: prompt.messages,
        maxOutputTokens: CHATBOT_MAX_OUTPUT_TOKENS,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      return result.text.trim() === '' ? { reason: 'bad_response' } : { result };
    } catch (error) {
      if (error instanceof LlmChatError) return { reason: error.reason };
      throw error;
    }
  }

  /**
   * The reply is worth more than exact bookkeeping: when settling fails the
   * reservation stays charged and the footer shows the best figure at hand.
   */
  private async settle(
    triggerMessageId: string,
    guildId: string,
    userId: string,
    held: Reservation,
    actual: number,
    before: Standing,
  ): Promise<Standing> {
    try {
      if (!held.durable) {
        return await this.quota.settle(guildId, userId, held.period, held.reserved, actual);
      }
      // Null: a restart already gave the hold back, so charging the real cost
      // on top would count the call twice.
      const settled = await this.quota.settleTurn(guildId, userId, triggerMessageId, actual);
      return settled ?? (await this.currentOr(guildId, userId, before));
    } catch (error) {
      this.logger.error(`Chatbot settle failed for server ${guildId} (${errorLabel(error)})`);
      return this.currentOr(guildId, userId, {
        remaining: Math.max(0, before.remaining - actual),
        total: before.total,
      });
    }
  }

  /** The member's month as it stands now, or `fallback` when it cannot be read. */
  private async currentOr(guildId: string, userId: string, fallback: Standing): Promise<Standing> {
    try {
      return await this.quota.limitOf(guildId, userId);
    } catch (error) {
      this.logger.error(
        `Chatbot allowance lookup failed for server ${guildId} (${errorLabel(error)})`,
      );
      return { remaining: fallback.remaining, total: fallback.total };
    }
  }

  /** A failed refund must not hide the call's own outcome; the reservation then stays charged. */
  private async giveBack(
    triggerMessageId: string,
    guildId: string,
    userId: string,
    held: Reservation,
  ): Promise<void> {
    try {
      if (held.durable) await this.quota.refundTurn(guildId, userId, triggerMessageId);
      else await this.quota.refund(guildId, userId, held.period, held.reserved);
    } catch (error) {
      this.logger.error(`Chatbot refund failed for server ${guildId} (${errorLabel(error)})`);
    }
  }

  private warnRejectedKey(guildId: string, source: 'guild' | 'global'): void {
    if (this.rejectedKeys.has(guildId)) return;
    this.rejectedKeys.set(guildId, true);
    this.logger.warn(`The ${source} chatbot LLM key was rejected for server ${guildId}`);
  }

  /** Shows "typing" until the returned function is called. */
  private keepTyping(message: TriggerMessage): () => void {
    const ping = (): void => {
      // Only a hint to the member; a channel that refuses it still gets the reply.
      void message.channel.sendTyping().catch(() => undefined);
    };
    ping();
    const timer = setInterval(ping, TYPING_REFRESH_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  /**
   * Sends the answer: the first part as a reply that pings the asker, the rest
   * as plain messages. When the asker deleted their message meanwhile, the
   * first part goes out as a plain message that names them instead. Nothing in
   * the model's text can ping anyone. Returns the id of the first part, `null`
   * if it could not be sent.
   */
  private async send(
    message: TriggerMessage,
    body: string,
    footer: string,
  ): Promise<string | null> {
    let firstId: string | null = null;
    try {
      let [first = footer, ...rest] = formatReply(body, footer);
      try {
        const sent = await message.reply({
          content: first,
          allowedMentions: { parse: [], repliedUser: true },
          failIfNotExists: true,
        });
        firstId = sent.id;
      } catch (error) {
        const code = discordErrorCode(error);
        if (code === undefined || !REPLY_TARGET_GONE_CODES.has(code)) throw error;
        const asker = message.author.id;
        [first = footer, ...rest] = formatReply(`<@${asker}> ${body}`, footer);
        const sent = await message.channel.send({
          content: first,
          allowedMentions: { parse: [], users: [asker] },
        });
        firstId = sent.id;
      }
      await this.noteReplied(message.id, firstId);
      for (const content of rest) {
        await message.channel.send({ content, allowedMentions: { parse: [] } });
      }
    } catch (error) {
      // A deleted channel or a withdrawn permission; the rest would only be orphans.
      this.logger.warn(`Could not send a chatbot reply (${errorLabel(error)})`);
    }
    return firstId;
  }

  /** Best effort: without it only a restart in this very instant could answer twice. */
  private async noteReplied(triggerMessageId: string, replyMessageId: string): Promise<void> {
    try {
      await this.history.markReplied(triggerMessageId, replyMessageId);
    } catch (error) {
      this.logger.warn(`Could not note a chatbot reply on its turn (${errorLabel(error)})`);
    }
  }

  private async finalize(
    message: TriggerMessage,
    replyMessageId: string | null,
    turn: TurnFields,
  ): Promise<void> {
    try {
      const closed = await this.history.finalize({
        guildId: message.guildId,
        channelId: message.channelId,
        userId: message.author.id,
        triggerMessageId: message.id,
        replyMessageId,
        ...turn,
      });
      if (!closed) this.logger.warn('A chatbot turn was no longer pending when its reply ended');
    } catch (error) {
      // The reply is already out; losing its history row must not turn into a second reply.
      this.logger.warn(`Could not store a chatbot turn (${errorLabel(error)})`);
    }
  }

  /** A bug ended the turn: close it so a restart does not answer it a second time. */
  private async closeFailed(message: TriggerMessage): Promise<void> {
    try {
      await this.finalize(message, null, bareTurn('FAILED', questionOf(message)));
    } catch (error) {
      this.logger.warn(`Could not close a failed chatbot turn (${errorLabel(error)})`);
    }
  }

  /** Counts the reply for the member's memory and rewrites it when due, after the reply is out. */
  private remember(guildId: string, channelId: string, userId: string, learned: Learned): void {
    if (this.closing) return;
    this.track(
      this.learn(guildId, channelId, userId, learned).catch((error: unknown) => {
        this.logger.error(
          `Chatbot memory update failed for server ${guildId} (${errorLabel(error)})`,
        );
      }),
    );
  }

  private async learn(
    guildId: string,
    channelId: string,
    userId: string,
    learned: Learned,
  ): Promise<void> {
    const { due } = await this.memory.noteTurn(guildId, userId);
    if (!due) return;
    await this.memory.summarize({ guildId, channelId, userId, ...learned });
  }

  /** Remembers `work` until it ends, whatever way; a failure is the caller's to report. */
  private track(work: Promise<void>): void {
    const job = work.catch(() => undefined);
    this.running.add(job);
    void job.then(() => this.running.delete(job));
  }
}
