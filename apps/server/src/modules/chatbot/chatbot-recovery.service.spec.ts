import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { CHATBOT_RECOVERY_MAX_AGE_MS } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import type { ChatbotHistoryService } from './chatbot-history.service.js';
import type { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotRecoveryService } from './chatbot-recovery.service.js';
import type { ChatbotListener } from './chatbot.listener.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const PARENT = '200000000000000777';
const USER = '300000000000000001';
const NOW = new Date('2026-10-16T05:00:00Z');
const BOT = '900000000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

type RowPatch = Partial<{
  id: string;
  channelId: string;
  replyMessageId: string | null;
  reservedTokens: number;
  age: number;
}>;

let counter = 0;

function row(patch: RowPatch = {}) {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  return {
    id: `row-${n}`,
    guildId: GUILD,
    channelId: patch.channelId ?? CHANNEL,
    userId: USER,
    triggerMessageId: `5000000000000${n}`,
    replyMessageId: patch.replyMessageId ?? null,
    reservedTokens: patch.reservedTokens ?? 0,
    createdAt: new Date(NOW.getTime() - (patch.age ?? 60_000)),
  };
}

function discordError(code: number): Error {
  return Object.assign(new Error(`Discord ${code}`), { code });
}

type Rows = ReturnType<typeof row>[];

function build(pages: Rows[] = [[]]) {
  const pendingBefore = vi.fn();
  for (const page of pages) pendingBefore.mockResolvedValueOnce(page);
  pendingBefore.mockResolvedValue([]);
  const markReplied = vi.fn((_trigger: string, _reply: string) => Promise.resolve());
  const expirePending = vi.fn((_trigger: string) => Promise.resolve(true));
  const refundTurn = vi.fn((_g: string, _u: string, _trigger: string) => Promise.resolve(0));
  const routeOf = vi.fn((_guild: string, _channel: string) => Promise.resolve({ enabled: true }));
  const enqueue = vi.fn((_message: unknown) => Promise.resolve(true));
  let stopping = false;
  const afterReady = vi.fn((_label: string, _task: () => void | Promise<void>) => undefined);
  const fetched = new Map<string, { id: string }>();
  /** Messages the channel holds after the trigger; the bot's own answers among them. */
  let after: { id: string; author: { id: string }; reference: { messageId: string } | null }[] = [];
  const messageFetch = vi.fn((arg: string | { after: string; limit: number }) => {
    if (typeof arg !== 'string') return Promise.resolve({ values: () => after });
    const found = fetched.get(arg) ?? { id: arg };
    fetched.set(arg, found);
    return Promise.resolve(found);
  });
  const channel: {
    isThread: () => boolean;
    parentId?: string | null;
    messages?: { fetch: typeof messageFetch };
  } = {
    isThread: () => false,
    parentId: null,
    messages: { fetch: messageFetch },
  };
  const channelFetch = vi.fn((_id: string) => Promise.resolve(channel as typeof channel | null));
  const service = new ChatbotRecoveryService(
    { pendingBefore, markReplied, expirePending } as unknown as ChatbotHistoryService,
    { refundTurn } as unknown as ChatbotQuotaService,
    { routeOf } as unknown as ChatbotConfigService,
    { enqueue } as unknown as ChatbotListener,
    { afterReady, isStopping: () => stopping } as unknown as DiscordReadyService,
    { user: { id: BOT }, channels: { fetch: channelFetch } } as unknown as ConstructorParameters<
      typeof ChatbotRecoveryService
    >[5],
  );
  return {
    service,
    pendingBefore,
    markReplied,
    expirePending,
    refundTurn,
    routeOf,
    enqueue,
    afterReady,
    messageFetch,
    channelFetch,
    channel,
    fetched,
    setAfter: (messages: typeof after) => {
      after = messages;
    },
    stop: () => {
      stopping = true;
    },
  };
}

function silence() {
  return {
    log: vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  };
}

describe('ChatbotRecoveryService: when it runs', () => {
  it('waits for Discord and then sweeps once', async () => {
    silence();
    const { service, afterReady, pendingBefore } = build();
    service.onApplicationBootstrap();
    expect(afterReady).toHaveBeenCalledTimes(1);
    expect(afterReady.mock.calls[0]?.[0]).toBe('chatbot-recovery');
    expect(pendingBefore).not.toHaveBeenCalled();
    await afterReady.mock.calls[0]?.[1]();
    expect(pendingBefore).toHaveBeenCalledTimes(1);
  });

  it('only looks at turns written before this process started', async () => {
    silence();
    const { service, pendingBefore } = build();
    const started = Date.now();
    await service.sweep(NOW);
    const [options] = pendingBefore.mock.calls[0] as [
      { createdBefore: Date; idleBefore: Date; take: number; after?: unknown },
    ];
    expect(options.createdBefore.getTime()).toBeLessThanOrEqual(started);
    // Turns touched within the answer deadline plus a margin may still be in the old process's hands.
    expect(options.idleBefore.getTime()).toBe(NOW.getTime() - 120_000);
    expect(options.take).toBe(50);
    expect(options.after).toBeUndefined();
  });
});

describe('ChatbotRecoveryService: what is replayed', () => {
  it('replays a recent turn of a chatbot channel through the listener queue', async () => {
    silence();
    const pending = row();
    const { service, enqueue, messageFetch, expirePending, routeOf } = build([[pending]]);
    await service.sweep(NOW);
    expect(routeOf).toHaveBeenCalledWith(GUILD, CHANNEL);
    expect(messageFetch).toHaveBeenCalledWith(pending.triggerMessageId);
    expect(enqueue).toHaveBeenCalledWith({ id: pending.triggerMessageId });
    expect(expirePending).not.toHaveBeenCalled();
  });

  it('does not wait for a replay to finish before going on to the next turn', async () => {
    silence();
    const [first, second] = [row(), row()];
    const { service, enqueue } = build([[first, second]]);
    enqueue.mockReturnValue(new Promise(() => undefined));
    await service.sweep(NOW);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('replays a turn exactly at the age limit and expires one a millisecond past it', async () => {
    silence();
    const atLimit = row({ age: CHATBOT_RECOVERY_MAX_AGE_MS });
    const past = row({ age: CHATBOT_RECOVERY_MAX_AGE_MS + 1 });
    const { service, enqueue, expirePending, messageFetch } = build([[atLimit, past]]);
    await service.sweep(NOW);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(messageFetch).toHaveBeenCalledWith(atLimit.triggerMessageId);
    expect(expirePending).toHaveBeenCalledTimes(1);
    expect(expirePending).toHaveBeenCalledWith(past.triggerMessageId);
  });

  it('expires an old turn without asking Discord for anything', async () => {
    silence();
    const { service, channelFetch, enqueue, expirePending } = build([[row({ age: 3_600_000 })]]);
    await service.sweep(NOW);
    expect(channelFetch).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(expirePending).toHaveBeenCalledTimes(1);
  });

  it('closes a turn that already has a reply, and never answers it again', async () => {
    silence();
    const answered = row({ replyMessageId: '500000000009999999' });
    const { service, channelFetch, enqueue, expirePending } = build([[answered]]);
    await service.sweep(NOW);
    expect(enqueue).not.toHaveBeenCalled();
    expect(channelFetch).not.toHaveBeenCalled();
    expect(expirePending).toHaveBeenCalledWith(answered.triggerMessageId);
  });

  it.each([
    ['is no longer a chatbot channel', null],
    ['has the chatbot switched off', { enabled: false }],
  ])('expires a turn whose channel %s, without fetching the message', async (_label, route) => {
    silence();
    const { service, routeOf, messageFetch, enqueue, expirePending } = build([[row()]]);
    routeOf.mockResolvedValueOnce(route as never);
    await service.sweep(NOW);
    expect(messageFetch).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(expirePending).toHaveBeenCalledTimes(1);
  });

  it('routes a thread by the channel it was started in', async () => {
    silence();
    const { service, routeOf, channel, enqueue } = build([[row()]]);
    channel.isThread = () => true;
    channel.parentId = PARENT;
    await service.sweep(NOW);
    expect(routeOf).toHaveBeenCalledWith(GUILD, PARENT);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('expires a turn whose channel is gone or cannot hold messages', async () => {
    silence();
    const gone = build([[row()]]);
    gone.channelFetch.mockResolvedValueOnce(null);
    await gone.service.sweep(NOW);
    expect(gone.expirePending).toHaveBeenCalledTimes(1);

    const noMessages = build([[row()]]);
    delete noMessages.channel.messages;
    await noMessages.service.sweep(NOW);
    expect(noMessages.expirePending).toHaveBeenCalledTimes(1);
    expect(noMessages.enqueue).not.toHaveBeenCalled();
  });

  it.each([10008, 10003, 50001])(
    'expires the turn when Discord answers %i for the message',
    async (code) => {
      silence();
      const { service, messageFetch, expirePending, enqueue } = build([[row()]]);
      messageFetch.mockRejectedValueOnce(discordError(code));
      await service.sweep(NOW);
      expect(enqueue).not.toHaveBeenCalled();
      expect(expirePending).toHaveBeenCalledTimes(1);
    },
  );

  it.each([10003, 50001])(
    'expires the turn when Discord answers %i for the channel',
    async (code) => {
      silence();
      const { service, channelFetch, expirePending } = build([[row()]]);
      channelFetch.mockRejectedValueOnce(discordError(code));
      await service.sweep(NOW);
      expect(expirePending).toHaveBeenCalledTimes(1);
    },
  );

  it('leaves a turn pending when Discord fails in some other way, and goes on with the rest', async () => {
    const logs = silence();
    const [first, second] = [row(), row()];
    const { service, messageFetch, expirePending, enqueue } = build([[first, second]]);
    messageFetch.mockRejectedValueOnce(new Error('socket hang up'));
    await service.sweep(NOW);
    expect(expirePending).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(String(logs.warn.mock.calls[0]?.[0])).not.toContain('socket hang up');
  });

  it('drops a replay the listener refuses because the member is being answered', async () => {
    silence();
    const pending = row();
    const { service, enqueue, expirePending } = build([[pending]]);
    enqueue.mockResolvedValueOnce(false);
    await service.sweep(NOW);
    await vi.waitFor(() => expect(expirePending).toHaveBeenCalledWith(pending.triggerMessageId));
  });

  it('only logs a replay that fails', async () => {
    const logs = silence();
    const { service, enqueue } = build([[row()]]);
    enqueue.mockRejectedValueOnce(new Error('db down'));
    await expect(service.sweep(NOW)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(logs.warn).toHaveBeenCalledTimes(1));
    expect(String(logs.warn.mock.calls[0]?.[0])).not.toContain('db down');
  });
});

describe('ChatbotRecoveryService: giving tokens back', () => {
  it('refunds the hold of every pending turn through the turn row, whatever happens to the turn', async () => {
    silence();
    const young = row({ reservedTokens: 300 });
    const old = row({ reservedTokens: 120, age: 3_600_000 });
    const answered = row({ reservedTokens: 50, replyMessageId: '500000000009999999' });
    const { service, refundTurn } = build([[young, old, answered]]);
    refundTurn.mockResolvedValue(10);
    await service.sweep(NOW);
    expect(refundTurn.mock.calls).toEqual([
      [GUILD, USER, young.triggerMessageId],
      [GUILD, USER, old.triggerMessageId],
      [GUILD, USER, answered.triggerMessageId],
    ]);
  });

  it('counts nothing when another sweep already took the hold', async () => {
    const logs = silence();
    const { service } = build([[row({ reservedTokens: 300 })]]);
    await service.sweep(NOW);
    expect(String(logs.log.mock.calls[0]?.[0])).toContain('0 refunded');
  });

  it('does not even try for a turn without a hold', async () => {
    silence();
    const { service, refundTurn } = build([[row()]]);
    await service.sweep(NOW);
    expect(refundTurn).not.toHaveBeenCalled();
  });

  it('still replays the turn when the refund fails, which leaves the hold on the row for the next start', async () => {
    const logs = silence();
    const { service, refundTurn, enqueue } = build([[row({ reservedTokens: 300 })]]);
    refundTurn.mockRejectedValueOnce(new Error('db down'));
    await service.sweep(NOW);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(String(logs.error.mock.calls[0]?.[0])).not.toContain('db down');
  });
});

describe('ChatbotRecoveryService: a reply already sent', () => {
  const answer = (trigger: string) => ({
    id: '500000000008888888',
    author: { id: BOT },
    reference: { messageId: trigger },
  });

  it('keeps the reply id and closes the turn instead of answering it again', async () => {
    silence();
    const pending = row();
    const { service, setAfter, messageFetch, markReplied, expirePending, enqueue } = build([
      [pending],
    ]);
    setAfter([answer(pending.triggerMessageId)]);
    await service.sweep(NOW);
    expect(messageFetch).toHaveBeenCalledWith({ after: pending.triggerMessageId, limit: 20 });
    expect(markReplied).toHaveBeenCalledWith(pending.triggerMessageId, '500000000008888888');
    expect(expirePending).toHaveBeenCalledWith(pending.triggerMessageId);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('ignores messages that are not the bot answering this very message', async () => {
    silence();
    const pending = row();
    const { service, setAfter, enqueue, markReplied } = build([[pending]]);
    setAfter([
      { id: '1', author: { id: USER }, reference: { messageId: pending.triggerMessageId } },
      { id: '2', author: { id: BOT }, reference: { messageId: '500000000000000999' } },
      { id: '3', author: { id: BOT }, reference: null },
    ]);
    await service.sweep(NOW);
    expect(markReplied).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('ChatbotRecoveryService: a second look', () => {
  it('sweeps once more after the grace, and never replays the same turn twice', async () => {
    vi.useFakeTimers();
    // The turn's age is read against the clock, which the fake timers would otherwise leave at today.
    vi.setSystemTime(NOW);
    try {
      silence();
      const pending = row();
      const { service, afterReady, pendingBefore, enqueue } = build([[pending], [pending]]);
      service.onApplicationBootstrap();
      await afterReady.mock.calls[0]?.[1]();
      expect(pendingBefore).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(129_000);
      expect(pendingBefore).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pendingBefore).toHaveBeenCalledTimes(2);
      expect(enqueue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not sweep after shutdown', async () => {
    vi.useFakeTimers();
    try {
      silence();
      const { service, afterReady, pendingBefore } = build();
      service.onApplicationBootstrap();
      await afterReady.mock.calls[0]?.[1]();
      service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(200_000);
      expect(pendingBefore).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChatbotRecoveryService: robustness', () => {
  it('never throws, and says so in the log without any ids or text', async () => {
    const logs = silence();
    const { service, pendingBefore } = build();
    pendingBefore.mockReset();
    pendingBefore.mockRejectedValue(new Error('db down'));
    await expect(service.sweep(NOW)).resolves.toBeUndefined();
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(String(logs.error.mock.calls[0]?.[0])).not.toContain('db down');
  });

  it('logs counts only', async () => {
    const logs = silence();
    const pending = row({ age: 3_600_000, reservedTokens: 10 });
    const { service, refundTurn } = build([[pending, row()]]);
    refundTurn.mockResolvedValueOnce(10);
    await service.sweep(NOW);
    expect(logs.log).toHaveBeenCalledTimes(1);
    const line = String(logs.log.mock.calls[0]?.[0]);
    expect(line).toBe('Chatbot recovery: 1 replayed, 1 expired, 1 refunded, 0 failed');
    expect(line).not.toContain(pending.triggerMessageId);
  });

  it('reads further pages after a full one, from the last turn it saw, and stops after a short one', async () => {
    silence();
    const first = Array.from({ length: 50 }, () => row({ age: 3_600_000 }));
    const second = [row({ age: 3_600_000 })];
    const { service, pendingBefore, expirePending } = build([first, second]);
    await service.sweep(NOW);
    expect(pendingBefore).toHaveBeenCalledTimes(2);
    const [secondCall] = pendingBefore.mock.calls[1] as [
      { after?: { createdAt: Date; id: string } },
    ];
    expect(secondCall.after).toEqual({ createdAt: first.at(-1)?.createdAt, id: first.at(-1)?.id });
    expect(expirePending).toHaveBeenCalledTimes(51);
  });

  it('stops going through turns once shutdown began', async () => {
    silence();
    const { service, stop, expirePending, pendingBefore } = build([[row({ age: 3_600_000 })]]);
    stop();
    await service.sweep(NOW);
    expect(pendingBefore).toHaveBeenCalledTimes(1);
    expect(expirePending).not.toHaveBeenCalled();
  });
});
