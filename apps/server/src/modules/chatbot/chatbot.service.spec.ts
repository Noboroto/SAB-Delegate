import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { CHATBOT_MAX_OUTPUT_TOKENS, MESSAGE_MAX_LENGTH } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { LlmChatError, LlmChatService } from '../llm/llm-chat.service.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotContextService } from './chatbot-context.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotListener } from './chatbot.listener.js';
import { ChatbotService } from './chatbot.service.js';
import {
  GUILD,
  CHANNEL,
  USER,
  SECRET_KEY,
  TRIGGER,
  REPLY,
  LIMIT,
  PERIOD,
  TARGET,
  quotaFake,
  USAGE,
  build,
  fakeMessage,
  silenceLogs,
  storedContext,
  posted,
} from './chatbot.service.test-fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ChatbotService: a normal reply', () => {
  it('runs the steps in order and ends the reply with the allowance left after settling', async () => {
    const { service, calls, quota, chat, finalize, noteTurn, collectFrom } = build();
    const sent = fakeMessage();
    await service.handle(sent.message);
    await service.onModuleDestroy();

    expect(calls).toEqual(['collect', 'reserve', 'chat', 'settle', 'finalize', 'noteTurn']);
    expect(collectFrom).toHaveBeenCalledWith(sent.message);
    // Settled with what the provider reported, in the period the reservation was made in.
    const held = (await quota.reserve.mock.results[0]?.value) as { reserved: number };
    expect(quota.settle).toHaveBeenCalledWith(GUILD, USER, PERIOD, held.reserved, 500);
    expect(quota.refund).not.toHaveBeenCalled();

    expect(sent.reply).toHaveBeenCalledTimes(1);
    expect(sent.reply.mock.calls[0]?.[0].content).toBe('Chào bạn!\n-# còn lại 99.500 / 100.000');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(noteTurn).toHaveBeenCalledWith(GUILD, USER);
  });

  it('shows the figures in English for an English server', async () => {
    const { service } = build({ locale: 'en' });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(sent.reply.mock.calls[0]?.[0].content).toBe('Chào bạn!\n-# remaining 99,500 / 100,000');
  });

  it('shows the allowance after settling, not what was left before the call', async () => {
    const quota = quotaFake({ used: 40_000 });
    const { service } = build({ quota });
    const sent = fakeMessage();
    await service.handle(sent.message);
    // 60.000 were left before; the call really cost 500.
    expect(posted(sent)[0]).toBe('Chào bạn!\n-# còn lại 59.500 / 100.000');
  });

  it('pings the asker through the reply and nothing else', async () => {
    const { service } = build({
      chat: () =>
        Promise.resolve({ text: 'Hi @everyone @here <@&123> <@456>', usage: USAGE, cut: false }),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(sent.reply.mock.calls[0]?.[0]).toMatchObject({
      allowedMentions: { parse: [], repliedUser: true },
      failIfNotExists: true,
    });
    expect(sent.reply.mock.calls[0]?.[0].content).toContain('@everyone');
  });

  it('gives the model the channel, the memory and a bounded output budget', async () => {
    const { service, chat, quota, read, recentFor } = build();
    await service.handle(fakeMessage().message);
    expect(read).toHaveBeenCalledWith(GUILD, CHANNEL, USER);
    expect(recentFor).toHaveBeenCalledWith(GUILD, USER);
    const [target, request] = chat.mock.calls[0] as unknown as [
      typeof TARGET,
      {
        system: string;
        messages: { content: { type: string; text?: string }[] }[];
        maxOutputTokens: number;
        signal: AbortSignal;
      },
    ];
    expect(target).toEqual(TARGET);
    expect(request.maxOutputTokens).toBe(CHATBOT_MAX_OUTPUT_TOKENS);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.system).toContain('Sabi');
    const prompt = request.messages.at(-1)?.content[0]?.text ?? '';
    expect(prompt).toContain('tin nhắn của Anna');
    expect(prompt).toContain('ký ức người dùng');
    expect(prompt).toContain('Xin chào bot');
    // The reservation covers the output budget on top of the input.
    const held = (await quota.reserve.mock.results[0]?.value) as { reserved: number };
    expect(held.reserved).toBeGreaterThan(CHATBOT_MAX_OUTPUT_TOKENS);
  });

  it('records one turn with what was asked, answered and spent, after the reply is sent', async () => {
    const { service, finalize } = build();
    await service.handle(fakeMessage().message);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize.mock.calls[0]).toEqual([
      expect.objectContaining({
        guildId: GUILD,
        channelId: CHANNEL,
        userId: USER,
        triggerMessageId: TRIGGER,
        replyMessageId: REPLY,
        status: 'OK',
        failureReason: null,
        question: 'Xin chào bot',
        answer: 'Chào bạn!',
        model: 'model-x',
        llmSource: 'global',
        inputTokens: 300,
        outputTokens: 200,
        estimated: false,
      }),
    ]);
    expect(storedContext(finalize).system).toContain('Sabi');
  });

  it('marks an answer the model cut off', async () => {
    const { service } = build({
      chat: () => Promise.resolve({ text: 'Một nửa', usage: USAGE, cut: true }),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(posted(sent)[0]).toMatch(/^Một nửa…\n-#/u);
  });

  it('splits a long answer, replies with the first part and puts the footer on the last only', async () => {
    const line = 'y'.repeat(99);
    const text = Array.from({ length: 60 }, () => line).join('\n');
    const { service, finalize } = build({
      chat: () => Promise.resolve({ text, usage: USAGE, cut: false }),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    const parts = posted(sent);
    expect(sent.reply).toHaveBeenCalledTimes(1);
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(sent.send).toHaveBeenCalledTimes(parts.length - 1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
    expect(parts.filter((part) => part.includes('-# còn lại'))).toHaveLength(1);
    expect(parts.at(-1)).toContain('-# còn lại 99.500 / 100.000');
    // Follow-ups never ping anybody.
    for (const [options] of sent.send.mock.calls) {
      expect(options.allowedMentions).toEqual({ parse: [] });
    }
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({ replyMessageId: REPLY });
  });

  it('keeps "typing" on while the model works and stops when the reply is done', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { service } = build({
      chat: async () => {
        await slow;
        return { text: 'xong', usage: USAGE, cut: false };
      },
    });
    const sent = fakeMessage();
    const done = service.handle(sent.message);
    await vi.waitFor(() => expect(sent.sendTyping).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(17_000);
    expect(sent.sendTyping.mock.calls.length).toBeGreaterThanOrEqual(3);
    finish();
    await done;
    const settledCalls = sent.sendTyping.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent.sendTyping).toHaveBeenCalledTimes(settledCalls);
  });

  it('answers even when "typing" cannot be shown', async () => {
    const { service } = build();
    const sent = fakeMessage();
    sent.sendTyping.mockRejectedValue(new Error('Missing Access'));
    await service.handle(sent.message);
    expect(sent.reply).toHaveBeenCalledTimes(1);
  });
});

describe('ChatbotService: replies that never reach the model', () => {
  it('tells an exhausted member so, with a footer of 0, and asks nobody anything', async () => {
    const quota = quotaFake({ used: LIMIT });
    const { service, collectFrom, chat, finalize, noteTurn } = build({ quota });
    const sent = fakeMessage();
    await service.handle(sent.message);
    await service.onModuleDestroy();

    expect(posted(sent)).toEqual([
      'Bạn đã dùng hết token chatbot của tháng này.\n-# còn lại 0 / 100.000',
    ]);
    expect(collectFrom).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      status: 'QUOTA_EXHAUSTED',
      answer: null,
      replyMessageId: REPLY,
      inputTokens: 0,
      llmSource: null,
    });
    expect(noteTurn).not.toHaveBeenCalled();
  });

  it('uses the member’s own limit in the footer of the exhausted reply', async () => {
    const quota = quotaFake({ limit: 2_500, used: 2_500 });
    const { service } = build({ quota, locale: 'en' });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(posted(sent)[0]).toBe(
      'You have used up your chatbot tokens for this month.\n-# remaining 0 / 2,500',
    );
  });

  it('answers exhausted, without a model call, when the allowance ran out between the check and the reservation', async () => {
    const quota = quotaFake();
    const { service, chat, finalize } = build({ quota });
    quota.reserve.mockImplementationOnce(() => {
      quota.state.used = LIMIT;
      return Promise.resolve({ exhausted: true as const, quota: quota.standing() });
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(chat).not.toHaveBeenCalled();
    expect(quota.settle).not.toHaveBeenCalled();
    expect(quota.refund).not.toHaveBeenCalled();
    expect(posted(sent)[0]).toBe(
      'Bạn đã dùng hết token chatbot của tháng này.\n-# còn lại 0 / 100.000',
    );
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      status: 'QUOTA_EXHAUSTED',
      question: 'Xin chào bot',
    });
  });

  it('says the chatbot is not set up, with the footer, and spends nothing', async () => {
    const quota = quotaFake({ used: 1_000 });
    const { service, chat, collectFrom, finalize } = build({ quota, target: null });
    const sent = fakeMessage();
    await service.handle(sent.message);

    expect(posted(sent)).toEqual([
      'Chatbot chưa có mô hình ngôn ngữ để hỏi. Quản trị viên cần cài đặt trước.\n-# còn lại 99.000 / 100.000',
    ]);
    expect(chat).not.toHaveBeenCalled();
    expect(collectFrom).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({ status: 'NOT_CONFIGURED', answer: null });
  });
});

describe('ChatbotService: a failed model call', () => {
  it('gives the reservation back once, apologises and shows the allowance as it was', async () => {
    const quota = quotaFake({ used: 10_000 });
    const { service, noteTurn, finalize } = build({
      quota,
      chat: () => Promise.reject(new LlmChatError('unreachable')),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    await service.onModuleDestroy();

    expect(quota.refund).toHaveBeenCalledTimes(1);
    expect(quota.settle).not.toHaveBeenCalled();
    expect(quota.state.used).toBe(10_000);
    expect(posted(sent)).toEqual([
      'Mình chưa lấy được câu trả lời lúc này. Bạn thử lại sau một lát nhé.\n-# còn lại 90.000 / 100.000',
    ]);
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'unreachable',
      answer: null,
      model: 'model-x',
      llmSource: 'global',
      replyMessageId: REPLY,
    });
    // The snapshot of what the model was given is kept for the failed turn too.
    expect(storedContext(finalize).system).toContain('Sabi');
    expect(noteTurn).not.toHaveBeenCalled();
  });

  it('treats an empty answer as a failure and refunds', async () => {
    const quota = quotaFake();
    const { service, finalize } = build({
      quota,
      chat: () => Promise.resolve({ text: '  \n ', usage: USAGE, cut: false }),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(quota.refund).toHaveBeenCalledTimes(1);
    expect(quota.settle).not.toHaveBeenCalled();
    expect(quota.state.used).toBe(0);
    expect(posted(sent)[0]).toContain('Mình chưa lấy được câu trả lời');
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'bad_response',
    });
  });

  it('never shows what the provider said', async () => {
    const { service } = build({
      chat: () => Promise.reject(new LlmChatError('bad_response')),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(posted(sent)[0]).not.toMatch(/bad_response|LlmChatError/u);
  });

  it('refunds exactly once, apologises with the footer and still raises a bug', async () => {
    const quota = quotaFake();
    const { service, finalize } = build({
      quota,
      chat: () => Promise.reject(new TypeError('boom')),
    });
    const sent = fakeMessage();
    await expect(service.handle(sent.message)).rejects.toThrow('boom');
    expect(quota.refund).toHaveBeenCalledTimes(1);
    expect(quota.state.used).toBe(0);
    expect(posted(sent)).toEqual([
      'Mình chưa lấy được câu trả lời lúc này. Bạn thử lại sau một lát nhé.\n-# còn lại 100.000 / 100.000',
    ]);
    // Closed, so a restart does not answer the same message a second time.
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      status: 'FAILED',
      answer: null,
      question: 'Xin chào bot',
      triggerMessageId: TRIGGER,
    });
  });

  it('raises the bug even when closing the turn fails too', async () => {
    silenceLogs();
    const { service, finalize } = build({ chat: () => Promise.reject(new TypeError('boom')) });
    finalize.mockRejectedValueOnce(new Error('db down'));
    await expect(service.handle(fakeMessage().message)).rejects.toThrow('boom');
  });

  it('raises the bug even when the apology cannot be sent', async () => {
    silenceLogs();
    const { service } = build({ chat: () => Promise.reject(new TypeError('boom')) });
    const sent = fakeMessage({ reply: () => Promise.reject(new Error('Missing Permissions')) });
    await expect(service.handle(sent.message)).rejects.toThrow('boom');
  });

  it('reserves nothing when the context cannot be read', async () => {
    const quota = quotaFake();
    const built = build({ quota });
    built.collectFrom.mockRejectedValueOnce(new Error('db down'));
    await expect(built.service.handle(fakeMessage().message)).rejects.toThrow('db down');
    expect(quota.reserve).not.toHaveBeenCalled();
    expect(quota.refund).not.toHaveBeenCalled();
  });

  it('still replies when the refund itself fails, and does not try it twice', async () => {
    const logs = silenceLogs();
    const quota = quotaFake();
    quota.refund.mockRejectedValue(new Error('db down'));
    const { service } = build({
      quota,
      chat: () => Promise.reject(new LlmChatError('unreachable')),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(quota.refund).toHaveBeenCalledTimes(1);
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(sent.reply).toHaveBeenCalledTimes(1);
  });

  it('still replies when settling fails, and keeps the reservation charged', async () => {
    const logs = silenceLogs();
    const quota = quotaFake();
    quota.settle.mockRejectedValue(new Error('db down'));
    const { service, finalize } = build({ quota });
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(quota.refund).not.toHaveBeenCalled();
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(posted(sent)[0]).toContain('Chào bạn!');
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({ status: 'OK' });
  });

  it('warns once per server about a rejected key', async () => {
    const logs = silenceLogs();
    const { service } = build({
      chat: () => Promise.reject(new LlmChatError('unauthorized')),
      target: { target: { ...TARGET, apiKey: SECRET_KEY }, source: 'guild' },
    });
    await service.handle(fakeMessage().message);
    await service.handle(fakeMessage().message);
    expect(logs.warn).toHaveBeenCalledTimes(1);
    const text = String(logs.warn.mock.calls[0]?.[0]);
    expect(text).toContain(GUILD);
    for (const call of [...logs.warn.mock.calls, ...logs.error.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(SECRET_KEY);
    }
  });
});

describe('ChatbotService: when the database fails around the reply', () => {
  it('sends the answer with the best figure at hand when settling and the lookup both fail', async () => {
    const logs = silenceLogs();
    const quota = quotaFake({ used: 1_000 });
    quota.settle.mockRejectedValue(new Error('db down'));
    quota.limitOf.mockResolvedValueOnce(quota.standing());
    const { service } = build({ quota });
    quota.limitOf.mockRejectedValue(new Error('db down'));
    const sent = fakeMessage();
    await service.handle(sent.message);
    // 99.000 were left before; the call cost 500.
    expect(posted(sent)).toEqual(['Chào bạn!\n-# còn lại 98.500 / 100.000']);
    expect(quota.refund).not.toHaveBeenCalled();
    expect(logs.error).toHaveBeenCalledTimes(2);
  });

  it('shows the figure from before the call when the lookup after a refund fails', async () => {
    silenceLogs();
    const quota = quotaFake({ used: 1_000 });
    const { service } = build({
      quota,
      chat: () => Promise.reject(new LlmChatError('unreachable')),
    });
    quota.limitOf.mockResolvedValueOnce(quota.standing());
    quota.limitOf.mockRejectedValue(new Error('db down'));
    const sent = fakeMessage();
    await service.handle(sent.message);
    expect(posted(sent)[0]).toContain('-# còn lại 99.000 / 100.000');
    expect(quota.refund).toHaveBeenCalledTimes(1);
  });
});

describe('ChatbotService: where the reply goes', () => {
  it('names the asker in a plain message when the question was deleted meanwhile', async () => {
    silenceLogs();
    const { service, finalize } = build();
    const gone = Object.assign(new Error('Invalid Form Body'), { code: 50035 });
    const sent = fakeMessage({ reply: () => Promise.reject(gone) });
    await service.handle(sent.message);
    expect(sent.send).toHaveBeenCalledTimes(1);
    const [options] = sent.send.mock.calls[0] ?? [];
    expect(options?.content).toBe(`<@${USER}> Chào bạn!\n-# còn lại 99.500 / 100.000`);
    // Only the asker can be pinged; the model's own text cannot.
    expect(options?.allowedMentions).toEqual({ parse: [], users: [USER] });
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      status: 'OK',
      replyMessageId: '500000000000000009',
    });
  });

  it('keeps the follow-up parts of a deleted-question reply ping-free', async () => {
    silenceLogs();
    const text = Array.from({ length: 60 }, () => 'y'.repeat(99)).join('\n');
    const { service } = build({
      chat: () => Promise.resolve({ text, usage: USAGE, cut: false }),
    });
    const gone = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const sent = fakeMessage({ reply: () => Promise.reject(gone) });
    await service.handle(sent.message);
    const calls = sent.send.mock.calls.map(([options]) => options);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls[0]?.allowedMentions.users).toEqual([USER]);
    for (const options of calls.slice(1)) expect(options.allowedMentions).toEqual({ parse: [] });
    for (const options of calls)
      expect(options.content.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
  });

  it('stores the question without the mention for a refusal, as for any other turn', async () => {
    const { service, finalize } = build({ target: null });
    await service.handle(fakeMessage().message);
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      status: 'NOT_CONFIGURED',
      question: 'Xin chào bot',
    });
  });

  it('stops showing "typing" before the reply goes out', async () => {
    vi.useFakeTimers();
    const { service } = build();
    let during = 0;
    let atReply = 0;
    const sent = fakeMessage({
      reply: async () => {
        atReply = sent.sendTyping.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30_000);
        during = sent.sendTyping.mock.calls.length;
        return { id: REPLY };
      },
    });
    await service.handle(sent.message);
    expect(during).toBe(atReply);
  });
});

describe('ChatbotService: after the reply', () => {
  it('records the turn even when the reply could not be sent, and then does not feed the memory', async () => {
    const logs = silenceLogs();
    const { service, finalize, noteTurn } = build();
    const sent = fakeMessage({ reply: () => Promise.reject(new Error('Missing Permissions')) });
    await expect(service.handle(sent.message)).resolves.toBeUndefined();
    await service.onModuleDestroy();
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(sent.send).not.toHaveBeenCalled();
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({ status: 'OK', replyMessageId: null });
    expect(noteTurn).not.toHaveBeenCalled();
  });

  it('only logs when the turn cannot be stored, and still feeds the memory', async () => {
    const logs = silenceLogs();
    const { service, finalize, noteTurn } = build();
    finalize.mockRejectedValueOnce(new Error('db down'));
    const sent = fakeMessage();
    await expect(service.handle(sent.message)).resolves.toBeUndefined();
    await service.onModuleDestroy();
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(noteTurn).toHaveBeenCalledTimes(1);
  });

  it('rewrites the memory in the background when the member’s round is due', async () => {
    const { service, summarize, noteTurn, calls } = build({ due: true });
    await service.handle(fakeMessage().message);
    await service.onModuleDestroy();
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: GUILD,
        channelId: CHANNEL,
        userId: USER,
        speakerName: 'Bình',
        question: 'Xin chào bot',
        answer: 'Chào bạn!',
        transcript: [{ authorName: 'Anna', text: 'tin nhắn của Anna' }],
      }),
    );
    // Counted before it is asked for, and only after the reply was stored.
    expect(calls.indexOf('finalize')).toBeLessThan(calls.indexOf('noteTurn'));
    expect(noteTurn.mock.invocationCallOrder[0]).toBeLessThan(
      summarize.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('leaves the memory alone when the round is not due', async () => {
    const { service, summarize, noteTurn } = build({ due: false });
    await service.handle(fakeMessage().message);
    await service.onModuleDestroy();
    expect(noteTurn).toHaveBeenCalledTimes(1);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('does not wait for the rewrite before returning, and a failing rewrite only logs', async () => {
    const logs = silenceLogs();
    const built = build({ due: true });
    let fail!: (error: Error) => void;
    built.summarize.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    await built.service.handle(fakeMessage().message);
    await vi.waitFor(() => expect(built.summarize).toHaveBeenCalledTimes(1));
    const draining = built.service.onModuleDestroy();
    fail(new Error('db down'));
    await draining;
    expect(logs.error).toHaveBeenCalledTimes(1);
  });
});

describe('ChatbotModule wiring', () => {
  it('resolves the service and the listener through the container', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ChatbotService, ChatbotListener],
    })
      .useMocker(() => ({}))
      .compile();
    expect(moduleRef.get(ChatbotService)).toBeInstanceOf(ChatbotService);
    expect(moduleRef.get(ChatbotListener)).toBeInstanceOf(ChatbotListener);
    await moduleRef.close();
  });

  it('declares every dependency to the container', () => {
    expect(Reflect.getMetadata('design:paramtypes', ChatbotService)).toEqual([
      ChatbotConfigService,
      ChatbotQuotaService,
      ChatbotContextService,
      ChatbotMemoryService,
      ChatbotHistoryService,
      LlmChatService,
      GuildLocaleService,
    ]);
    const listenerDeps = Reflect.getMetadata('design:paramtypes', ChatbotListener) as unknown[];
    expect(listenerDeps).toHaveLength(4);
    expect(listenerDeps.every((dep) => typeof dep === 'function' && dep !== Object)).toBe(true);
  });
});
