import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { MESSAGES, WordStatus, type WordSubmitResult } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { WordGameListener } from './word-game.listener.js';
import type { WordGameService } from './word-game.service.js';

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
  options: { result?: WordSubmitResult; locale?: 'vi' | 'en'; stopping?: boolean } = {},
) {
  const submitWord = vi.fn().mockResolvedValue(options.result ?? outcome({}));
  const resolve = vi.fn().mockResolvedValue(options.locale ?? 'vi');
  const listener = new WordGameListener(
    { submitWord } as unknown as WordGameService,
    { resolve } as unknown as GuildLocaleService,
    { isStopping: () => options.stopping ?? false } as unknown as DiscordReadyService,
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
  return { listener, submitWord, resolve, message };
}

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

  it('never looks at bots or direct messages, and not at all during shutdown', async () => {
    const { listener, submitWord, message } = build();
    await listener.onMessageCreate([message({ author: { id: USER, bot: true } })] as never);
    await listener.onMessageCreate([message({ guildId: null })] as never);
    const stopping = build({ stopping: true });
    await stopping.listener.onMessageCreate([stopping.message()] as never);
    expect(submitWord).not.toHaveBeenCalled();
    expect(stopping.submitWord).not.toHaveBeenCalled();
  });

  it('puts a check mark on an accepted word, with no reply and no language lookup', async () => {
    const { listener, message, resolve } = build();
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    expect(incoming.reply).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('announces the end of the game on the word that reaches the limit', async () => {
    const { listener, message } = build({
      result: outcome({ count: 200, maxWords: 200, finished: true }),
    });
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    expect(incoming.reply).toHaveBeenCalledWith(
      'Trò chơi kết thúc do đã đạt 200 từ. Hãy reset nếu muốn chơi tiếp nhé',
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
    expect(incoming.reply).toHaveBeenCalledWith(text);
  });

  it('names the letter a linking word has to start with', async () => {
    const { listener, message } = build({
      result: outcome({ status: WordStatus.NOT_LINK, starter: 'k' }),
    });
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(incoming.reply).toHaveBeenCalledWith('Từ mới phải bắt đầu bằng `k`');
  });

  it('answers in the language of the server', async () => {
    const { listener, message, resolve } = build({
      result: outcome({ status: WordStatus.SAME_WORD }),
      locale: 'en',
    });
    const incoming = message();
    await listener.onMessageCreate([incoming] as never);
    expect(resolve).toHaveBeenCalledWith(GUILD);
    expect(incoming.reply).toHaveBeenCalledWith(MESSAGES.en['word-game'].reply.SAME_WORD);
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
