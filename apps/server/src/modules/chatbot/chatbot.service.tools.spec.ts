import { CHATBOT_MAX_OUTPUT_TOKENS, CHATBOT_TURN_CONTEXT_MAX_BYTES } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  LIMIT,
  PERIOD,
  TARGET,
  USER,
  USAGE,
  build,
  fakeMessage,
  posted,
  quotaFake,
  silenceLogs,
} from './chatbot.service.test-fixtures.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T08:00:00.000Z'));
  silenceLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const CALLS = [
  { name: 'my_quota', args: '{}', resultBytes: 90 },
  { name: 'game_leaderboard', args: '{"game":"WORDLE"}', resultBytes: 400 },
];

describe('ChatbotService: tools', () => {
  it('builds the tools for this server, this asker, the guild language and the model answering', async () => {
    const { service, buildTools } = build({ locale: 'en' });
    await service.handle(fakeMessage().message);
    expect(buildTools).toHaveBeenCalledWith({
      guildId: GUILD,
      askerId: USER,
      held: expect.any(Number) as number,
      locale: 'en',
      model: { name: TARGET.model, source: 'global' },
    });
  });

  it('offers the tools with a cap of three steps', async () => {
    const { service, chat } = build();
    await service.handle(fakeMessage().message);
    const request = chat.mock.calls[0]?.[1] as { tools: object; maxSteps: number };
    expect(request.maxSteps).toBe(3);
    expect(request.tools).toEqual({});
  });

  it('holds one call, then settles the real total of every step', async () => {
    const quota = quotaFake();
    const total = 1_800;
    const { service, chat } = build({
      quota,
      chat: () =>
        Promise.resolve({
          text: 'Đã tra xong',
          // What the provider billed over three steps, far above one call's estimate.
          usage: { inputTokens: 1_500, outputTokens: 300, total, estimated: false },
          cut: false,
          toolCalls: CALLS,
        }),
    });
    const sent = fakeMessage();
    await service.handle(sent.message);

    const held = (await quota.reserve.mock.results[0]?.value) as { reserved: number };
    // One call's worth: extra steps may overshoot it and are charged at settling.
    expect(held.reserved).toBeGreaterThan(CHATBOT_MAX_OUTPUT_TOKENS);
    expect(held.reserved).toBeLessThan(2 * CHATBOT_MAX_OUTPUT_TOKENS);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(quota.settle).toHaveBeenCalledTimes(1);
    expect(quota.settle).toHaveBeenCalledWith(GUILD, USER, PERIOD, held.reserved, total);
    expect(quota.refund).not.toHaveBeenCalled();
    // The footer shows the month after settling: only the real total is spent.
    expect(quota.state.used).toBe(total);
    expect(posted(sent)[0]).toContain('còn lại 98.200 / 100.000');
  });

  it('reserves no more than the member has left', async () => {
    const quota = quotaFake({ used: LIMIT - 700 });
    const { service } = build({ quota });
    await service.handle(fakeMessage().message);
    const held = (await quota.reserve.mock.results[0]?.value) as { reserved: number };
    expect(held.reserved).toBe(700);
  });

  it('gives the whole hold back when the call fails after tools were offered', async () => {
    const quota = quotaFake();
    const { service } = build({
      quota,
      chat: () => Promise.reject(new Error('bug')),
    });
    await service.handle(fakeMessage().message).catch(() => undefined);
    expect(quota.state.used).toBe(0);
    expect(quota.settle).not.toHaveBeenCalled();
  });

  it('records the tool calls on the stored turn, never the results', async () => {
    const { service, finalize } = build({
      chat: () => Promise.resolve({ text: 'ok', usage: USAGE, cut: false, toolCalls: CALLS }),
    });
    await service.handle(fakeMessage().message);
    const stored = finalize.mock.calls[0]?.[0] as { context: { toolCalls?: unknown[] } };
    expect(stored.context.toolCalls).toEqual(CALLS);
  });

  it('records at most twenty tool calls so the snapshot stays small', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: 'my_quota',
      args: `{"n":${i}}`,
      resultBytes: 1,
    }));
    const { service, finalize } = build({
      chat: () => Promise.resolve({ text: 'ok', usage: USAGE, cut: false, toolCalls: many }),
    });
    await service.handle(fakeMessage().message);
    const stored = finalize.mock.calls[0]?.[0] as { context: { toolCalls?: unknown[] } };
    expect(stored.context.toolCalls).toHaveLength(20);
  });

  it('sheds tool calls from the end until the snapshot fits the history size cap', async () => {
    const fat = Array.from({ length: 20 }, (_, i) => ({
      name: 'list_commands',
      args: `${i}`.padEnd(8_000, 'x'),
      resultBytes: 1,
    }));
    const { service, finalize } = build({
      chat: () => Promise.resolve({ text: 'ok', usage: USAGE, cut: false, toolCalls: fat }),
    });
    await service.handle(fakeMessage().message);
    const stored = finalize.mock.calls[0]?.[0] as { context: { toolCalls?: { args: string }[] } };
    const kept = stored.context.toolCalls ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(20);
    expect(kept[0]?.args.startsWith('0')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(stored.context))).toBeLessThanOrEqual(
      CHATBOT_TURN_CONTEXT_MAX_BYTES,
    );
  });

  it('leaves the snapshot as before when no tool was called', async () => {
    const { service, finalize } = build();
    await service.handle(fakeMessage().message);
    const stored = finalize.mock.calls[0]?.[0] as { context: object };
    expect(stored.context).not.toHaveProperty('toolCalls');
  });
});
