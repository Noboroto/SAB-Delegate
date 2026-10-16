import 'reflect-metadata';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { ChatbotHistoryService } from './chatbot-history.service.js';
import type { ChatbotMemoryService } from './chatbot-memory.service.js';
import type { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotSelfCommands } from './chatbot-self.commands.js';

const GUILD = '100000000000000001';
const ME = '100000000000000002';
const CHANNEL = '100000000000000004';
const ACTOR = { source: 'DISCORD', userId: ME };

const TURN = {
  id: '0190a000-0000-7000-8000-0000000000aa',
  channelId: CHANNEL,
  userId: ME,
  triggerMessageId: '100000000000000010',
  replyMessageId: '100000000000000011',
  status: 'OK',
  failureReason: null,
  question: 'What is\n  the plan?',
  answer: 'Ship it.',
  model: 'model-x',
  llmSource: 'global',
  inputTokens: 1,
  outputTokens: 1,
  estimated: false,
  createdAt: '2026-10-16T03:00:00.000Z',
};

function build(locale: 'vi' | 'en' = 'en') {
  const memory = {
    getOwn: vi.fn().mockResolvedValue('Likes tea.'),
    clear: vi.fn().mockResolvedValue({ dryRun: false, userMemories: 1, channelMemories: 0 }),
  };
  const quota = {
    limitOf: vi.fn().mockResolvedValue({ used: 12_345, remaining: 87_655, total: 100_000 }),
  };
  const history = {
    list: vi.fn().mockResolvedValue({ items: [TURN], total: 1 }),
    delete: vi.fn().mockResolvedValue({ dryRun: false, count: 3 }),
  };
  const locales = { resolve: vi.fn().mockResolvedValue(locale) };
  const commands = new ChatbotSelfCommands(
    memory as unknown as ChatbotMemoryService,
    quota as unknown as ChatbotQuotaService,
    history as unknown as ChatbotHistoryService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = (guildId: string | null = GUILD) => {
    const target = {
      guildId,
      locale: 'en-US',
      user: { id: ME },
      replied: false,
      deferred: false,
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return new Proxy(target, {
      get(object, key, receiver) {
        if (key === 'memberPermissions' || key === 'member') {
          throw new Error(`the command read ${String(key)}`);
        }
        return Reflect.get(object, key, receiver) as unknown;
      },
    });
  };
  return { commands, memory, quota, history, interaction };
}

const sent = (target: { editReply: { mock: { calls: unknown[][] } } }, call = 0) =>
  (target.editReply.mock.calls[call]?.[0] as { content: string }).content;

describe('/chat', () => {
  it('memory shows the caller own summary only', async () => {
    const { commands, memory, interaction } = build();
    const target = interaction();
    await commands.onMemory([target] as never);
    expect(memory.getOwn).toHaveBeenCalledWith(GUILD, ME);
    expect(sent(target)).toContain('Likes tea.');
  });

  it('memory has an empty state', async () => {
    const { commands, memory, interaction } = build();
    memory.getOwn.mockResolvedValue(null);
    const target = interaction();
    await commands.onMemory([target] as never);
    expect(sent(target)).toBe(MESSAGES.en.chatbot.slash.memoryNone);
  });

  it('memory-clear clears the caller in this server and nothing else', async () => {
    const { commands, memory, interaction } = build();
    const target = interaction();
    await commands.onMemoryClear([target] as never);
    expect(memory.clear).toHaveBeenCalledWith(
      GUILD,
      { scope: 'user', userId: ME, dryRun: false },
      ACTOR,
    );
    expect(sent(target)).toBe(MESSAGES.en.chatbot.slash.selfMemoryCleared);
  });

  it('memory-clear says when there was nothing to forget', async () => {
    const { commands, memory, interaction } = build();
    memory.clear.mockResolvedValue({ dryRun: false, userMemories: 0, channelMemories: 0 });
    const target = interaction();
    await commands.onMemoryClear([target] as never);
    expect(sent(target)).toBe(MESSAGES.en.chatbot.slash.selfMemoryNothing);
  });

  it('usage shows remaining and total like the reply footer', async () => {
    const { commands, quota, interaction } = build();
    const target = interaction();
    await commands.onUsage([target] as never);
    expect(quota.limitOf).toHaveBeenCalledWith(GUILD, ME);
    expect(sent(target)).toBe('This month you used 12,345 tokens, remaining 87,655 / 100,000.');
  });

  it('usage groups digits by the language of the server', async () => {
    const { commands, interaction } = build('vi');
    const target = interaction();
    await commands.onUsage([target] as never);
    expect(sent(target)).toBe('Tháng này bạn đã dùng 12.345 token, còn lại 87.655 / 100.000.');
  });

  it('history reads the caller last five turns, rows only', async () => {
    const { commands, history, interaction } = build();
    const target = interaction();
    await commands.onHistory([target] as never);

    expect(history.list).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({ userId: ME, page: 1, pageSize: 5, order: 'desc' }),
    );
    const text = sent(target);
    expect(text).toContain('Q: What is the plan?');
    expect(text).toContain('A: Ship it.');
    expect(text).toContain(`<#${CHANNEL}>`);
    expect(text).toContain(`<t:${Date.parse(TURN.createdAt) / 1000}:f>`);
  });

  it('history names the state of a turn that has no answer', async () => {
    const { commands, history, interaction } = build();
    history.list.mockResolvedValue({
      items: [{ ...TURN, status: 'QUOTA_EXHAUSTED', answer: null }],
      total: 1,
    });
    const target = interaction();
    await commands.onHistory([target] as never);
    expect(sent(target)).toContain(MESSAGES.en.chatbot.slash.historyStatus.QUOTA_EXHAUSTED);
  });

  it('history clips long turns and splits the reply under the message limit', async () => {
    const { commands, history, interaction } = build();
    const long = { ...TURN, question: 'q'.repeat(5000), answer: 'a'.repeat(5000) };
    history.list.mockResolvedValue({ items: Array.from({ length: 5 }, () => long), total: 5 });
    const target = interaction();
    await commands.onHistory([target] as never);

    const messages = [
      sent(target),
      ...target.followUp.mock.calls.map((call) => (call[0] as { content: string }).content),
    ];
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(2000);
    expect(messages.join('')).not.toContain('q'.repeat(400));
  });

  it('history has an empty state', async () => {
    const { commands, history, interaction } = build();
    history.list.mockResolvedValue({ items: [], total: 0 });
    const target = interaction();
    await commands.onHistory([target] as never);
    expect(sent(target)).toBe(MESSAGES.en.chatbot.slash.historyEmpty);
  });

  it('history-clear deletes the caller turns in this server only', async () => {
    const { commands, history, interaction } = build();
    const target = interaction();
    await commands.onHistoryClear([target] as never);
    expect(history.delete).toHaveBeenCalledWith(
      GUILD,
      { scope: 'user', userId: ME, dryRun: false },
      ACTOR,
    );
    expect(sent(target)).toBe('Deleted 3 of your conversations in this server.');
  });

  it.each([
    ['memory', (c: ChatbotSelfCommands, t: never) => c.onMemory([t])],
    ['memory-clear', (c: ChatbotSelfCommands, t: never) => c.onMemoryClear([t])],
    ['usage', (c: ChatbotSelfCommands, t: never) => c.onUsage([t])],
    ['history', (c: ChatbotSelfCommands, t: never) => c.onHistory([t])],
    ['history-clear', (c: ChatbotSelfCommands, t: never) => c.onHistoryClear([t])],
  ])('%s in a direct message fails with GUILD_NOT_FOUND', async (_name, run) => {
    const { commands, memory, history, quota, interaction } = build();
    const target = interaction(null);
    await expect(run(commands, target as never)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(memory.getOwn).not.toHaveBeenCalled();
    expect(memory.clear).not.toHaveBeenCalled();
    expect(history.list).not.toHaveBeenCalled();
    expect(history.delete).not.toHaveBeenCalled();
    expect(quota.limitOf).not.toHaveBeenCalled();
  });

  it('answers every command privately, pinging nobody, and only ever names the caller', async () => {
    const { commands, memory, quota, history, interaction } = build();
    const runs = [
      (t: never) => commands.onMemory([t]),
      (t: never) => commands.onMemoryClear([t]),
      (t: never) => commands.onUsage([t]),
      (t: never) => commands.onHistory([t]),
      (t: never) => commands.onHistoryClear([t]),
    ];
    for (const run of runs) {
      const target = interaction();
      await run(target as never);
      expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      for (const call of target.editReply.mock.calls) {
        expect(call[0]).toMatchObject({ allowedMentions: { parse: [] } });
      }
      expect(target.reply).not.toHaveBeenCalled();
    }

    const arguments_ = [memory.getOwn, memory.clear, quota.limitOf, history.list, history.delete]
      .flatMap((mock) => mock.mock.calls)
      .map((call) => JSON.stringify(call));
    expect(arguments_.length).toBe(5);
    for (const text of arguments_) {
      const ids = text.match(/\d{17,20}/g) ?? [];
      expect(ids.every((id) => id === GUILD || id === ME)).toBe(true);
      expect(ids).toContain(ME);
    }
  });
});
