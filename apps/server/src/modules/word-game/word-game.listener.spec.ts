import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { MESSAGES, WordStatus, type WordSubmitResult } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { WordGameListener } from './word-game.listener.js';
import type { WordGameService } from './word-game.service.js';
import type { WordDefinition, WordDefinitionService } from './word-definition.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const USER = '300000000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

const outcome = (overrides: Partial<WordSubmitResult>): WordSubmitResult => ({
  status: WordStatus.SUCCESS,
  count: 2,
  maxWords: 1500,
  finished: false,
  ...overrides,
});

function build(
  options: {
    result?: WordSubmitResult;
    locale?: 'vi' | 'en';
    stopping?: boolean;
    definition?: WordDefinition;
  } = {},
) {
  const submitWord = vi.fn().mockResolvedValue(options.result ?? outcome({}));
  const resolve = vi.fn().mockResolvedValue(options.locale ?? 'vi');
  const define = vi.fn().mockResolvedValue(options.definition ?? null);
  const listener = new WordGameListener(
    { submitWord } as unknown as WordGameService,
    { resolve } as unknown as GuildLocaleService,
    { isStopping: () => options.stopping ?? false } as unknown as DiscordReadyService,
    { define } as unknown as WordDefinitionService,
  );
  const message = (overrides: Record<string, unknown> = {}) => ({
    guildId: GUILD,
    channelId: CHANNEL,
    content: ' Apple ',
    author: { id: USER, bot: false },
    react: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  return { listener, submitWord, resolve, define, message };
}

/** The reply pings only the player it answers, whatever the client-wide default is. */
const replyTo = (content: string) => ({ content, allowedMentions: { repliedUser: true } });

describe('WordGameListener', () => {
  it('hands the raw message to the service, which does the judging', async () => {
    const { listener, submitWord, message } = build();
    await listener.onMessageCreate([message()] as never);
    expect(submitWord).toHaveBeenCalledWith(GUILD, {
      channelId: CHANNEL,
      authorId: USER,
      content: ' Apple ',
    });
  });

  it('judges the messages of a channel in the order they arrived, however long each takes', async () => {
    const { listener, submitWord, message } = build();
    const order: string[] = [];
    submitWord.mockImplementation(async (_guild: string, input: { content: string }) => {
      // The first message is the slowest to judge; it must still go first.
      const delay = input.content === 'first' ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(input.content);
      return outcome({});
    });
    await Promise.all(
      ['first', 'second', 'third'].map((content) =>
        listener.onMessageCreate([message({ content })] as never),
      ),
    );
    expect(order).toEqual(['first', 'second', 'third']);
    // An emptied queue is dropped, so channels that went quiet hold no memory.
    expect(
      (listener as unknown as { channelQueues: Map<string, unknown> }).channelQueues.size,
    ).toBe(0);
  });

  it('gives up on a move stuck past ten seconds and judges the next one', async () => {
    vi.useFakeTimers();
    try {
      const { listener, submitWord, message } = build();
      submitWord.mockReturnValueOnce(new Promise(() => undefined));
      const stuck = listener.onMessageCreate([message({ content: 'stuck' })] as never);
      const stuckSettled = expect(stuck).rejects.toThrow('Judging a word timed out');
      const next = message({ content: 'next' });
      const after = listener.onMessageCreate([next] as never);

      await vi.advanceTimersByTimeAsync(10_000);
      await stuckSettled;
      await after;
      expect(next.react).toHaveBeenCalledWith('✅');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a queued move once shutdown has begun', async () => {
    let stopping = false;
    const { message } = build();
    const submitWord = vi.fn(() => {
      stopping = true;
      return Promise.resolve(outcome({}));
    });
    const listener = new WordGameListener(
      { submitWord } as unknown as WordGameService,
      { resolve: vi.fn() } as unknown as GuildLocaleService,
      { isStopping: () => stopping } as unknown as DiscordReadyService,
      { define: vi.fn().mockResolvedValue(null) } as unknown as WordDefinitionService,
    );
    const queued = message();
    await Promise.all([
      listener.onMessageCreate([message()] as never),
      listener.onMessageCreate([queued] as never),
    ]);
    expect(submitWord).toHaveBeenCalledTimes(1);
    expect(queued.react).not.toHaveBeenCalled();
  });

  it('does not make one channel wait for another', async () => {
    const { listener, submitWord, message } = build();
    const order: string[] = [];
    submitWord.mockImplementation(async (_guild: string, input: { channelId: string }) => {
      await new Promise((resolve) => setTimeout(resolve, input.channelId === CHANNEL ? 20 : 0));
      order.push(input.channelId);
      return outcome({});
    });
    const other = '200000000000000002';
    await Promise.all([
      listener.onMessageCreate([message()] as never),
      listener.onMessageCreate([message({ channelId: other })] as never),
    ]);
    expect(order).toEqual([other, CHANNEL]);
  });

  it('never looks at bots or direct messages, and not at all during shutdown', async () => {
    const { listener, submitWord, message } = build();
    await listener.onMessageCreate([message({ author: { id: USER, bot: true } })] as never);
    await listener.onMessageCreate([message({ guildId: null })] as never);
    const stopping = build({ stopping: true });
    await stopping.listener.onMessageCreate([stopping.message()] as never);
    expect(submitWord).not.toHaveBeenCalled();
    expect(stopping.submitWord).not.toHaveBeenCalled();
  });

  it('puts a check mark on an accepted word, with no reply when no meaning is found', async () => {
    const { listener, message, resolve, define } = build();
    const incoming = message({ content: 'Apple' });
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    expect(define).toHaveBeenCalledWith('apple');
    expect(incoming.reply).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('replies under an accepted word with its meaning, after the check mark and without a ping', async () => {
    const { listener, message } = build({
      definition: {
        english: { partOfSpeech: 'noun', definition: 'A fruit.', source: 'wiktionary' },
        vietnamese: { meaning: 'Quả táo.', source: 'wiktionary' },
      },
    });
    const order: string[] = [];
    const incoming = message({
      content: 'apple',
      react: vi.fn(() => {
        order.push('react');
        return Promise.resolve();
      }),
      reply: vi.fn(() => {
        order.push('reply');
        return Promise.resolve();
      }),
    });
    await listener.onMessageCreate([incoming] as never);
    expect(order).toEqual(['react', 'reply']);
    expect(incoming.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('**apple** · *noun* · 🇻🇳 Quả táo.') as unknown,
      allowedMentions: { parse: [], repliedUser: false },
      flags: MessageFlags.SuppressEmbeds,
    });
  });

  it('drops the meaning when shutdown began during the lookup', async () => {
    let stopping = false;
    const { listener, message, define, resolve } = build({
      definition: { vietnamese: { meaning: 'Quả táo.', source: 'wiktionary' } },
    });
    Object.assign(listener, { ready: { isStopping: () => stopping } });
    define.mockImplementationOnce(() => {
      stopping = true;
      return Promise.resolve({ vietnamese: { meaning: 'Quả táo.', source: 'wiktionary' } });
    });
    const incoming = message({ content: 'apple' });
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    expect(resolve).not.toHaveBeenCalled();
    expect(incoming.reply).not.toHaveBeenCalled();
  });

  it('does not throw when the meaning cannot be posted', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { listener, message } = build({
      definition: { vietnamese: { meaning: 'Quả táo.', source: 'machine' } },
    });
    const incoming = message({ reply: vi.fn().mockRejectedValue(new Error('Missing Access')) });
    await expect(listener.onMessageCreate([incoming] as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('announces the end of the game on the word that reaches the limit', async () => {
    const { listener, message } = build({
      result: outcome({ count: 200, maxWords: 200, finished: true }),
    });
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    expect(incoming.reply).toHaveBeenCalledWith(
      replyTo('Trò chơi kết thúc do đã đạt 200 từ. Hãy reset nếu muốn chơi tiếp nhé'),
    );
  });

  it.each([
    [WordStatus.NOT_EXIST, 'Từ này không tồn tại trong từ điển'],
    [WordStatus.SAME_AUTHOR, 'Bạn đã nối từ trước đó'],
    [WordStatus.SAME_WORD, 'Từ này đã được nối'],
  ] as const)('marks %s with a cross and the Vietnamese reply', async (status, text) => {
    const { listener, message } = build({ result: outcome({ status }) });
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(incoming.reply).toHaveBeenCalledWith(replyTo(text));
  });

  it('names the letter a linking word has to start with', async () => {
    const { listener, message } = build({
      result: outcome({ status: WordStatus.NOT_LINK, starter: 'k' }),
    });
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(incoming.reply).toHaveBeenCalledWith(replyTo('Từ mới phải bắt đầu bằng `k`'));
  });

  it('answers in the language of the server', async () => {
    const { listener, message, resolve } = build({
      result: outcome({ status: WordStatus.SAME_WORD }),
      locale: 'en',
    });
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(resolve).toHaveBeenCalledWith(GUILD);
    expect(incoming.reply).toHaveBeenCalledWith(replyTo(MESSAGES.en['word-game'].reply.SAME_WORD));
  });

  it.each([WordStatus.NOTHING, WordStatus.MAX_WORD] as const)(
    'stays silent for %s',
    async (status) => {
      const { listener, message } = build({ result: outcome({ status }) });
      const incoming = message();
      await listener.onMessageCreate([incoming] as never);
      expect(incoming.react).not.toHaveBeenCalled();
      expect(incoming.reply).not.toHaveBeenCalled();
    },
  );

  it('still replies when the reaction is refused, and does not throw when the reply is too', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { listener, message } = build({ result: outcome({ status: WordStatus.SAME_WORD }) });
    const incoming = message({
      react: vi.fn().mockRejectedValue(new Error('Missing Permissions')),
      reply: vi.fn().mockRejectedValue(new Error('Unknown Message')),
    });
    await expect(listener.onMessageCreate([incoming] as never)).resolves.toBeUndefined();
    expect(incoming.reply).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('lets a service failure reach the exception filter instead of swallowing it', async () => {
    const { listener, submitWord, message } = build();
    submitWord.mockRejectedValueOnce(new Error('database down'));
    const incoming = message();
    await expect(listener.onMessageCreate([incoming] as never)).rejects.toThrow('database down');
    expect(incoming.react).not.toHaveBeenCalled();
  });
});
