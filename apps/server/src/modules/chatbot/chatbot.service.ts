import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  CHATBOT_MAX_OUTPUT_TOKENS,
  formatTokenCount,
  type ChatbotTurnContext,
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
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { buildChatPrompt } from './chatbot-prompt.js';
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

/** What a turn that never reached the model sent: nothing. */
const EMPTY_CONTEXT: ChatbotTurnContext = {
  system: '',
  channelMessages: [],
  memory: {},
  recentTurns: 0,
  attachments: [],
};

type Translator = ReturnType<typeof translatorFor>;

/**
 * What a reply needs of the message that addressed the bot. Structural on
 * purpose: Necord types its events with the ESM build of discord.js, whose
 * `Message` class is not assignable to the CommonJS one imported here.
 */
type TriggerMessage = Parameters<ChatbotContextService['collectFrom']>[0] & {
  guildId: string;
  channelId: string;
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

type Reservation = { reserved: number; period: string };

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

function refusal(status: 'QUOTA_EXHAUSTED' | 'NOT_CONFIGURED', question: string): TurnFields {
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
    context: EMPTY_CONTEXT,
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
      throw error;
    }
    const replyMessageId = await this.send(
      message,
      answer.body,
      this.footerOf(t, locale, answer.standing),
    );
    await this.record(message, replyMessageId, answer.turn);
    if (answer.learned !== undefined && replyMessageId !== null) {
      this.remember(guildId, channelId, userId, answer.learned);
    }
  }

  private footerOf(t: Translator, locale: Locale, standing: Standing): string {
    return t('chatbot.footer', {
      remaining: formatTokenCount(standing.remaining, locale),
      total: formatTokenCount(standing.total, locale),
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
        turn: refusal('NOT_CONFIGURED', asked),
      };
    }
    if (before.remaining === 0) {
      return {
        body: t('chatbot.quotaExhausted'),
        standing: before,
        turn: refusal('QUOTA_EXHAUSTED', asked),
      };
    }

    const stopTyping = this.keepTyping(message);
    // Set from the moment tokens are held until they are settled or returned.
    let held: Reservation | null = null;
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
      const reservation = await this.quota.reserve(guildId, userId, estimate);
      if ('exhausted' in reservation) {
        return {
          body: t('chatbot.quotaExhausted'),
          standing: reservation.quota,
          turn: refusal('QUOTA_EXHAUSTED', context.triggerText),
        };
      }
      held = reservation;

      const { model } = resolved.target;
      const asking = await this.ask(resolved.target, prompt);
      if ('reason' in asking) {
        held = null;
        await this.giveBack(guildId, userId, reservation);
        if (asking.reason === 'unauthorized') this.warnRejectedKey(guildId, resolved.source);
        return {
          body: t('chatbot.failed'),
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
      const standing = await this.settle(guildId, userId, reservation, result.usage.total, before);
      const text = result.text.trim();
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
      if (held !== null) await this.giveBack(guildId, userId, held);
    }
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
    guildId: string,
    userId: string,
    held: Reservation,
    actual: number,
    before: Standing,
  ): Promise<Standing> {
    try {
      return await this.quota.settle(guildId, userId, held.period, held.reserved, actual);
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
  private async giveBack(guildId: string, userId: string, held: Reservation): Promise<void> {
    try {
      await this.quota.refund(guildId, userId, held.period, held.reserved);
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
      for (const content of rest) {
        await message.channel.send({ content, allowedMentions: { parse: [] } });
      }
    } catch (error) {
      // A deleted channel or a withdrawn permission; the rest would only be orphans.
      this.logger.warn(`Could not send a chatbot reply (${errorLabel(error)})`);
    }
    return firstId;
  }

  private async record(
    message: TriggerMessage,
    replyMessageId: string | null,
    turn: TurnFields,
  ): Promise<void> {
    try {
      await this.history.record({
        guildId: message.guildId,
        channelId: message.channelId,
        userId: message.author.id,
        triggerMessageId: message.id,
        replyMessageId,
        ...turn,
      });
    } catch (error) {
      // The reply is already out; losing its history row must not turn into a second reply.
      this.logger.warn(`Could not store a chatbot turn (${errorLabel(error)})`);
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
