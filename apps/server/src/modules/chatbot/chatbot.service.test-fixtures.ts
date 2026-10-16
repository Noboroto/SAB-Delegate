import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { LlmChatService } from '../llm/llm-chat.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import type { ChatbotContextService } from './chatbot-context.service.js';
import type { ChatbotHistoryService } from './chatbot-history.service.js';
import type { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotPauseService } from '../llm/chatbot-pause.service.js';
import type { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotService } from './chatbot.service.js';

/** Fakes and builders shared by the chatbot service specs. */

export const GUILD = '100000000000000001';
export const CHANNEL = '200000000000000001';
export const USER = '300000000000000001';
const BOT = '900000000000000001';
// Built at run time so no key-shaped literal sits in the source (secret scanner).
export const SECRET_KEY = ['sk', 'test', randomBytes(12).toString('hex')].join('-');
export const TRIGGER = '500000000000000001';
export const REPLY = '500000000000000002';
export const LIMIT = 100_000;
export const PERIOD = '2026-10';
export const ADMIN_GUILD = '700000000000000001';

export const TARGET = { baseUrl: 'https://llm.example/v1', model: 'model-x', apiKey: 'k' };

/** The member's month, held in memory; the real statements are covered by the quota specs. */
export function quotaFake(initial: { limit?: number; used?: number } = {}) {
  const state = {
    limit: initial.limit ?? LIMIT,
    used: initial.used ?? 0,
    /** Whether the hold can be written on the turn row. */
    durable: true,
    /** A restart already took the hold off the row. */
    taken: false,
  };
  /** Order of the calls that matter, shared with the rest of the fakes. */
  const calls: string[] = [];
  /** What each reservation held, in the order made: the turn row's `reservedTokens`. */
  const held: number[] = [];
  const standing = () => ({
    limit: state.limit,
    bonus: 0,
    used: state.used,
    total: state.limit,
    remaining: Math.max(0, state.limit - state.used),
    overridden: false,
  });
  const reserve = vi.fn((_guild: string, _user: string, estimate: number) => {
    calls.push('reserve');
    const left = state.limit - state.used;
    if (left <= 0) return Promise.resolve({ exhausted: true as const, quota: standing() });
    const reserved = Math.min(estimate, left);
    state.used += reserved;
    return Promise.resolve({ reserved, period: PERIOD });
  });
  const settle = vi.fn(
    (_guild: string, _user: string, _period: string, reserved: number, actual: number) => {
      calls.push('settle');
      state.used = Math.max(0, state.used - reserved + actual);
      return Promise.resolve(standing());
    },
  );
  const refund = vi.fn((_guild: string, _user: string, _period: string, reserved: number) => {
    calls.push('refund');
    state.used = Math.max(0, state.used - reserved);
    return Promise.resolve();
  });
  return {
    state,
    calls,
    standing,
    limitOf: vi.fn(() => Promise.resolve(standing())),
    reserve,
    settle,
    refund,
    // The turn-row variants do the same bookkeeping through the plain mocks.
    reserveForTurn: vi.fn(
      async (guild: string, user: string, estimate: number, _trigger: string) => {
        const outcome = await reserve(guild, user, estimate);
        if ('exhausted' in outcome) return outcome;
        held.push(outcome.reserved);
        return { ...outcome, durable: state.durable };
      },
    ),
    settleTurn: vi.fn(async (guild: string, user: string, _trigger: string, actual: number) => {
      if (state.taken) return null;
      return settle(guild, user, PERIOD, held.shift() ?? 0, actual);
    }),
    refundTurn: vi.fn(async (guild: string, user: string, _trigger: string) => {
      if (state.taken) return 0;
      const reserved = held.shift() ?? 0;
      await refund(guild, user, PERIOD, reserved);
      return reserved;
    }),
  };
}

const CONTEXT = {
  botId: BOT,
  botName: 'Sabi',
  guildName: 'Máy chủ thử',
  channelName: 'chat',
  speaker: { id: USER, name: 'Bình' },
  triggerMessageId: TRIGGER,
  triggerText: 'Xin chào bot',
  messages: [
    {
      id: '500000000000000000',
      authorId: '400000000000000001',
      authorName: 'Anna',
      role: 'member',
      at: '2026-10-16T07:00:00.000Z',
      text: 'tin nhắn của Anna',
    },
  ],
  replied: null,
  attachments: [],
};

export const USAGE = { inputTokens: 300, outputTokens: 200, total: 500, estimated: false };

type Setup = {
  locale?: 'vi' | 'en';
  quota?: ReturnType<typeof quotaFake>;
  target?: { target: typeof TARGET; source: 'guild' | 'global' } | null;
  chat?: (...args: unknown[]) => Promise<unknown>;
  due?: boolean;
  pause?: ChatbotPauseService;
};

export function build(setup: Setup = {}) {
  const quota = setup.quota ?? quotaFake();
  const { calls } = quota;
  const resolveTarget = vi.fn((_guild: string) =>
    Promise.resolve(
      setup.target === undefined ? { target: TARGET, source: 'global' as const } : setup.target,
    ),
  );
  const collectFrom = vi.fn((_message: unknown) => {
    calls.push('collect');
    return Promise.resolve(CONTEXT);
  });
  const answer: (...args: unknown[]) => Promise<unknown> =
    setup.chat ??
    (() => {
      calls.push('chat');
      return Promise.resolve({ text: 'Chào bạn!', usage: USAGE, cut: false });
    });
  const chat = vi.fn(answer);
  const read = vi.fn((_guild: string, _channel: string, _user: string) =>
    Promise.resolve({ channel: 'ký ức kênh', user: 'ký ức người dùng' }),
  );
  const noteTurn = vi.fn((_guild: string, _user: string) => {
    calls.push('noteTurn');
    return Promise.resolve({ due: setup.due ?? false });
  });
  const summarize = vi.fn((_input: object) => Promise.resolve('updated' as const));
  const finalize = vi.fn((_turn: object) => {
    calls.push('finalize');
    return Promise.resolve(true);
  });
  const markReplied = vi.fn((_trigger: string, _reply: string) => Promise.resolve());
  const recentFor = vi.fn((_guild: string, _user: string) => Promise.resolve([]));
  const resolve = vi.fn((_guild: string) => Promise.resolve(setup.locale ?? 'vi'));
  const pause = setup.pause ?? new ChatbotPauseService();
  const service = new ChatbotService(
    { resolveTarget, alertGuildId: ADMIN_GUILD } as unknown as ChatbotConfigService,
    quota as unknown as ChatbotQuotaService,
    { collectFrom } as unknown as ChatbotContextService,
    { read, noteTurn, summarize } as unknown as ChatbotMemoryService,
    { finalize, recentFor, markReplied } as unknown as ChatbotHistoryService,
    { chat } as unknown as LlmChatService,
    { resolve } as unknown as GuildLocaleService,
    pause,
  );
  return {
    service,
    calls,
    quota,
    resolveTarget,
    pause,
    collectFrom,
    chat,
    read,
    noteTurn,
    summarize,
    finalize,
    markReplied,
    recentFor,
    resolve,
  };
}

type SentOptions = {
  content: string;
  allowedMentions: { parse: unknown[]; repliedUser?: boolean; users?: string[] };
};

export function fakeMessage(options: { reply?: () => Promise<unknown> } = {}) {
  const reply = vi.fn((_options: SentOptions & { failIfNotExists: boolean }) =>
    options.reply === undefined ? Promise.resolve({ id: REPLY }) : options.reply(),
  );
  const send = vi.fn((_options: SentOptions) => Promise.resolve({ id: '500000000000000009' }));
  const sendTyping = vi.fn(() => Promise.resolve(undefined));
  // The admin server's #bot-log, where the alert about an empty provider account goes.
  const logSend = vi.fn((_options: { embeds: Array<{ fields: Array<{ value: string }> }> }) =>
    Promise.resolve(undefined),
  );
  const logChannel = { name: 'bot-log', isTextBased: () => true, send: logSend };
  const adminGuild = { name: 'Admin', channels: { cache: { find: () => logChannel } } };
  const message = {
    id: TRIGGER,
    guildId: GUILD,
    channelId: CHANNEL,
    author: { id: USER },
    cleanContent: '@Sabi Xin chào bot',
    guild: { members: { me: { displayName: 'Sabi' } } },
    client: {
      user: { id: BOT, displayName: 'Sabi' },
      guilds: {
        cache: {
          get: (id: string) =>
            id === ADMIN_GUILD ? adminGuild : id === GUILD ? { name: 'Máy chủ thử' } : undefined,
        },
      },
    },
    reply,
    channel: { send, sendTyping },
  };
  return { message: message as never, reply, send, sendTyping, logSend };
}

export function silenceLogs() {
  return {
    warn: vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  };
}

/** The context snapshot of the first turn the pipeline stored. */
export function storedContext(finalize: { mock: { calls: unknown[][] } }): { system: string } {
  return (finalize.mock.calls[0]?.[0] as { context: { system: string } }).context;
}

/** Everything the bot posted for a message: the reply first, then the follow-ups. */
export function posted(sent: ReturnType<typeof fakeMessage>): string[] {
  return [...sent.reply.mock.calls, ...sent.send.mock.calls].map(([options]) => options.content);
}
