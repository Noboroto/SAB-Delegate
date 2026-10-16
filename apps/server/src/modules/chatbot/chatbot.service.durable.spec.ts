import 'reflect-metadata';
import { MESSAGE_MAX_LENGTH } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmChatError } from '../llm/llm-chat.service.js';
import {
  GUILD,
  USER,
  TRIGGER,
  REPLY,
  quotaFake,
  USAGE,
  build,
  fakeMessage,
  silenceLogs,
} from './chatbot.service.test-fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ChatbotService: the deadline', () => {
  it('gives up on a reply 90 s after it got a slot, not before, and still settles its tokens', async () => {
    vi.useFakeTimers();
    const gates: (() => void)[] = [];
    const quota = quotaFake();
    const { service, chat } = build({
      quota,
      chat: async () => {
        await new Promise<void>((resolve) => gates.push(resolve));
        return { text: 'muộn', usage: USAGE, cut: false };
      },
    });
    const first = Array.from({ length: 3 }, () => service.handle(fakeMessage().message));
    const waiting = service.handle(fakeMessage().message);
    const waitingResult = expect(waiting).rejects.toThrow('Answering a chat message timed out');
    await vi.advanceTimersByTimeAsync(89_000);
    expect(chat).toHaveBeenCalledTimes(3);

    // Three slots free up: the fourth reply starts only now, and its 90 s start now.
    for (const open of gates.splice(0)) open();
    await Promise.all(first);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(chat).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(1_000);
    await waitingResult;
    // The call is still running; its tokens are settled when it ends.
    expect(quota.settle).toHaveBeenCalledTimes(3);
    for (const open of gates.splice(0)) open();
    await service.onModuleDestroy();
    expect(quota.settle).toHaveBeenCalledTimes(4);
    expect(quota.refund).not.toHaveBeenCalled();
  });

  it('does not start a queued reply once shutdown began', async () => {
    const { service, chat, quota } = build();
    await service.onModuleDestroy();
    await service.handle(fakeMessage().message);
    expect(chat).not.toHaveBeenCalled();
    expect(quota.limitOf).not.toHaveBeenCalled();
  });
});

describe('ChatbotService: the hold on the turn row', () => {
  it('reserves through the turn, so the hold is written with the reservation', async () => {
    const { service, quota, chat } = build();
    await service.handle(fakeMessage().message);
    expect(quota.reserveForTurn).toHaveBeenCalledWith(GUILD, USER, expect.any(Number), TRIGGER);
    expect(quota.reserveForTurn.mock.invocationCallOrder[0]).toBeLessThan(
      chat.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('settles through the turn, once, with what the call cost', async () => {
    const { service, quota } = build();
    await service.handle(fakeMessage().message);
    expect(quota.settleTurn).toHaveBeenCalledTimes(1);
    expect(quota.settleTurn).toHaveBeenCalledWith(GUILD, USER, TRIGGER, 500);
  });

  it('refunds through the turn when the call fails', async () => {
    const { service, quota } = build({
      chat: () => Promise.reject(new LlmChatError('unreachable')),
    });
    await service.handle(fakeMessage().message);
    expect(quota.refundTurn).toHaveBeenCalledTimes(1);
    expect(quota.refundTurn).toHaveBeenCalledWith(GUILD, USER, TRIGGER);
    expect(quota.state.used).toBe(0);
  });

  it('neither settles nor refunds a hold a restart already gave back, and still replies', async () => {
    const quota = quotaFake();
    quota.state.taken = true;
    const { service, finalize } = build({ quota });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(quota.settle).not.toHaveBeenCalled();
    expect(quota.refund).not.toHaveBeenCalled();
    expect(sent.reply).toHaveBeenCalledTimes(1);
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({ status: 'OK' });
  });

  it('does not refund a failed call whose hold was already taken', async () => {
    const quota = quotaFake();
    quota.state.taken = true;
    const { service } = build({
      quota,
      chat: () => Promise.reject(new LlmChatError('unreachable')),
    });
    await service.handle(fakeMessage().message);
    expect(quota.refund).not.toHaveBeenCalled();
  });

  it('settles and refunds with the plain calls when there is no turn row to hold on', async () => {
    const quota = quotaFake();
    quota.state.durable = false;
    const ok = build({ quota });
    await ok.service.handle(fakeMessage().message);
    expect(quota.settleTurn).not.toHaveBeenCalled();
    expect(quota.settle).toHaveBeenCalledTimes(1);

    const failing = quotaFake();
    failing.state.durable = false;
    const failed = build({
      quota: failing,
      chat: () => Promise.reject(new LlmChatError('unreachable')),
    });
    await failed.service.handle(fakeMessage().message);
    expect(failing.refundTurn).not.toHaveBeenCalled();
    expect(failing.refund).toHaveBeenCalledTimes(1);
  });

  it('keeps the reservation charged and still replies when settling through the turn fails', async () => {
    const logs = silenceLogs();
    const quota = quotaFake();
    quota.settleTurn.mockRejectedValueOnce(new Error('db down'));
    const { service } = build({ quota });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(sent.reply).toHaveBeenCalledTimes(1);
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(quota.refund).not.toHaveBeenCalled();
  });

  it('never reserves for a reply that never reaches the model', async () => {
    const { service, quota } = build({ target: null });
    await service.handle(fakeMessage().message);
    expect(quota.reserveForTurn).not.toHaveBeenCalled();
  });
});

describe('ChatbotService: the reply is noted on the turn as soon as it is out', () => {
  it('stores the id of the first part before the rest of a long answer is sent', async () => {
    const long = 'a'.repeat(MESSAGE_MAX_LENGTH * 2);
    const { service, markReplied, finalize } = build({
      chat: () => Promise.resolve({ text: long, usage: USAGE, cut: false }),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(sent.send.mock.calls.length).toBeGreaterThan(0);
    expect(markReplied).toHaveBeenCalledWith(TRIGGER, REPLY);
    expect(markReplied.mock.invocationCallOrder[0]).toBeLessThan(
      sent.send.mock.invocationCallOrder[0] ?? 0,
    );
    expect(markReplied.mock.invocationCallOrder[0]).toBeLessThan(
      finalize.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('notes nothing when no part could be sent', async () => {
    silenceLogs();
    const { service, markReplied } = build();
    await service.handle(fakeMessage({ reply: () => Promise.reject(new Error('gone')) }).message);
    expect(markReplied).not.toHaveBeenCalled();
  });

  it('still sends the rest, and logs, when the note cannot be stored', async () => {
    const logs = silenceLogs();
    const long = 'a'.repeat(MESSAGE_MAX_LENGTH * 2);
    const { service, markReplied } = build({
      chat: () => Promise.resolve({ text: long, usage: USAGE, cut: false }),
    });
    markReplied.mockRejectedValueOnce(new Error('db down'));
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(sent.send.mock.calls.length).toBeGreaterThan(0);
    expect(logs.warn).toHaveBeenCalledTimes(1);
  });

  it('warns when the turn was no longer pending at the end', async () => {
    const logs = silenceLogs();
    const { service, finalize } = build();
    finalize.mockResolvedValueOnce(false);
    await service.handle(fakeMessage().message);
    expect(logs.warn).toHaveBeenCalledTimes(1);
  });
});

describe('ChatbotService: limits and shutdown', () => {
  it('runs at most three replies at once, across channels', async () => {
    let running = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const { service, chat } = build({
      chat: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => gates.push(resolve));
        running -= 1;
        return { text: 'ok', usage: USAGE, cut: false };
      },
    });
    const jobs = Array.from({ length: 5 }, () => service.handle(fakeMessage().message));
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chat).toHaveBeenCalledTimes(3);
    while (gates.length > 0 || chat.mock.calls.length < 5) {
      gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await Promise.all(jobs);
    expect(peak).toBe(3);
  });

  it('waits at shutdown for a reply still running, so its tokens are settled', async () => {
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const quota = quotaFake();
    const { service, chat } = build({
      quota,
      chat: async () => {
        await slow;
        return { text: 'muộn', usage: USAGE, cut: false };
      },
    });
    const sent = fakeMessage();
    const job = service.handle(sent.message);
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    const closing = service.onModuleDestroy();
    finish();
    await closing;
    await job;
    expect(quota.settle).toHaveBeenCalledTimes(1);
    expect(sent.reply).toHaveBeenCalledTimes(1);
  });

  it('stops waiting after 20 s', async () => {
    vi.useFakeTimers();
    const logs = silenceLogs();
    const { service, chat } = build({ chat: () => new Promise(() => undefined) });
    void service.handle(fakeMessage().message).catch(() => undefined);
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = service.onModuleDestroy().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(closed).toBe(true);
    expect(logs.warn).toHaveBeenCalledTimes(1);
  });

  it('starts no memory rewrite once shutdown began', async () => {
    const { service, noteTurn } = build({ due: true });
    await service.onModuleDestroy();
    await service.handle(fakeMessage().message);
    expect(noteTurn).not.toHaveBeenCalled();
  });
});
