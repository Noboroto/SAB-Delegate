import { Inject, Injectable, Logger } from '@nestjs/common';
import { SnowflakeSchema } from '@sab/shared';
import { Client } from 'discord.js';
import { LRUCache } from 'lru-cache';
import pLimit from 'p-limit';
import { errorLabel } from '../../prisma/pool-factory.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { InfoService } from '../info/info.service.js';
import {
  INVALID,
  mentionOf,
  shortName,
  UNAVAILABLE,
  untrustedText,
} from './chatbot-tool-output.js';

/** The lookup can read thousands of messages; the reply's own deadline must still hold. */
const INTRO_BUDGET_MS = 20_000;

/** An introduction is written once; a stale answer for half an hour is harmless and saves a long scan. */
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 500;
const INTRO_MAX_CHARS = 1500;
/** Names a search may return; more than this cannot be told apart in a reply anyway. */
const SEARCH_LIMIT = 10;
const CANDIDATES_SHOWN = 5;

/**
 * Every scan pages through a channel's history; one at a time across all
 * servers keeps a burst of questions from hammering Discord's rate limits.
 */
const scanSlot = pLimit(1);

const CANCELLED = { status: 'CANCELLED' } as const;

const MENTION = /^<@!?(\d{1,25})>$/u;

/** The member to look up, or the answer to give instead. */
type Resolved = { userId: string } | { answer: Record<string, unknown> };

/**
 * A member's introduction for the chatbot's `get_intro` tool: the same lookup as
 * `/get intro`, with the member named by mention, id or display name, the answer
 * remembered for a while, and a time budget.
 */
@Injectable()
export class ChatbotIntroService {
  private readonly logger = new Logger(ChatbotIntroService.name);
  /** Only FOUND and NOT_FOUND: an unreadable channel or an unset one may be fixed any moment. */
  private readonly cache = new LRUCache<string, Record<string, unknown>>({
    max: CACHE_MAX,
    ttl: CACHE_TTL_MS,
    // 0: read the clock on every call instead of reusing a reading for a millisecond.
    ttlResolution: 0,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });
  /** One scan per member at a time: asking again while it runs joins it instead of reading the channel twice. */
  private readonly inflight = new Map<string, Promise<Record<string, unknown>>>();

  constructor(
    private readonly info: InfoService,
    private readonly guilds: GuildConfigService,
    @Inject(Client) private readonly client: Client,
  ) {}

  /**
   * `signal` ends the wait at once; the scan itself goes on and fills the cache.
   * Time spent queued behind another scan counts against the budget.
   */
  async lookup(
    guildId: string,
    member: string,
    signal?: AbortSignal,
    budgetMs: number = INTRO_BUDGET_MS,
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted === true) return CANCELLED;
    const resolved = await this.resolve(guildId, member);
    if ('answer' in resolved) return resolved.answer;

    let introChannelId: string | null;
    try {
      introChannelId = (await this.guilds.get(guildId)).introChannelId;
    } catch (error) {
      this.logger.warn(`Introduction channel lookup failed (${errorLabel(error)})`);
      return { status: 'UNREADABLE' };
    }
    if (introChannelId === null) return { status: 'NO_CHANNEL' };

    // The channel is part of the key: an answer read from a channel that has since been replaced is wrong.
    const key = `${guildId}:${introChannelId}:${resolved.userId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    let job = this.inflight.get(key);
    if (job === undefined) {
      job = scanSlot(() => this.scan(guildId, resolved.userId, key)).finally(() =>
        this.inflight.delete(key),
      );
      this.inflight.set(key, job);
    }
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const early = new Promise<Record<string, unknown>>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'TIMEOUT' }), budgetMs);
      onAbort = () => resolve(CANCELLED);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    // The scan keeps going past the budget or an abort and fills the cache for the next ask.
    return Promise.race([job, early]).finally(() => {
      clearTimeout(timer);
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
    });
  }

  private async scan(
    guildId: string,
    userId: string,
    key: string,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.info.getIntroduction(guildId, { userId });
      if (result.status === 'NO_CHANNEL') return { status: 'NO_CHANNEL' };
      const member = mentionOf(userId);
      const answer =
        result.status === 'NOT_FOUND'
          ? { status: 'NOT_FOUND', member, scanned: result.scanned }
          : {
              status: 'FOUND',
              member,
              // Written by a member and handed back to the model: data, not instructions.
              content: untrustedText(result.content, INTRO_MAX_CHARS),
              url: result.url,
            };
      this.cache.set(key, answer);
      return answer;
    } catch (error) {
      this.logger.warn(`Introduction lookup failed (${errorLabel(error)})`);
      return { status: 'UNREADABLE' };
    }
  }

  /** The member the model named, looked up only among this server's members. */
  private async resolve(guildId: string, member: string): Promise<Resolved> {
    const text = member.trim();
    const id = SnowflakeSchema.safeParse(MENTION.exec(text)?.[1] ?? text);
    const query = text.replace(/^@/u, '').trim();
    if (!id.success && query === '') return { answer: INVALID };

    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return { answer: UNAVAILABLE };
    if (id.success) {
      // An id from another server must not cost a channel scan or confirm who is where.
      try {
        await guild.members.fetch(id.data);
      } catch {
        return { answer: { status: 'NOT_FOUND', member: mentionOf(id.data), scanned: 0 } };
      }
      return { userId: id.data };
    }
    let found;
    try {
      found = [...(await guild.members.search({ query, limit: SEARCH_LIMIT })).values()];
    } catch (error) {
      this.logger.warn(`Member search failed (${errorLabel(error)})`);
      return { answer: UNAVAILABLE };
    }
    const wanted = query.toLowerCase();
    const exact = found.filter(
      (m) => m.displayName.toLowerCase() === wanted || m.user.username.toLowerCase() === wanted,
    );
    const matches = (exact.length > 0 ? exact : found).filter((m) => !m.user.bot);
    const [only, ...others] = matches;
    if (only === undefined) return { answer: { status: 'MEMBER_NOT_FOUND' } };
    if (others.length === 0) return { userId: only.id };
    return {
      answer: {
        status: 'AMBIGUOUS',
        candidates: matches
          .slice(0, CANDIDATES_SHOWN)
          .map((m) => ({ member: mentionOf(m.id), name: shortName(m.displayName) })),
      },
    };
  }
}
