import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { MESSAGES } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { GameChannelService } from '../game-core/game-channel.service.js';
import type { CountingService } from './counting.service.js';
import { MiniGameListener } from './mini-game.listener.js';
import type { CountingOutcome, ScrambleOutcome, WordleOutcome } from './mini-game.types.js';
import type { ScrambleService } from './scramble.service.js';
import type { WordleService } from './wordle.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const USER = '300000000000000001';
const EN = MESSAGES.en['mini-game'];

afterEach(() => {
  vi.restoreAllMocks();
});

type Setup = {
  game?: 'COUNTING' | 'SCRAMBLE' | 'WORDLE' | null;
  counting?: CountingOutcome;
  scramble?: ScrambleOutcome;
  wordle?: WordleOutcome;
  stopping?: boolean;
};

function build(setup: Setup = {}) {
  const routeOf = vi.fn().mockResolvedValue(setup.game === undefined ? 'COUNTING' : setup.game);
  const countingSubmit = vi.fn().mockResolvedValue(setup.counting ?? { status: 'NOTHING' });
  const scrambleSubmit = vi.fn().mockResolvedValue(setup.scramble ?? { status: 'NOTHING' });
  const wordleSubmit = vi.fn().mockResolvedValue(setup.wordle ?? { status: 'NOTHING' });
  const resolve = vi.fn().mockResolvedValue('en');
  const listener = new MiniGameListener(
    { routeOf } as unknown as GameChannelService,
    { submit: countingSubmit } as unknown as CountingService,
    { submit: scrambleSubmit } as unknown as ScrambleService,
    { submit: wordleSubmit } as unknown as WordleService,
    { resolve } as unknown as GuildLocaleService,
    { isStopping: () => setup.stopping ?? false } as unknown as DiscordReadyService,
  );
  const message = (overrides: Record<string, unknown> = {}) => ({
    guildId: GUILD,
    channelId: CHANNEL,
    content: '5',
    author: { id: USER, bot: false },
    react: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  return { listener, routeOf, countingSubmit, scrambleSubmit, wordleSubmit, resolve, message };
}

const send = (listener: MiniGameListener, incoming: unknown) =>
  listener.onMessageCreate([incoming] as never);

describe('MiniGameListener: which messages are moves', () => {
  it('never looks at bots, direct messages, or anything once shutdown has begun', async () => {
    const { listener, routeOf, message } = build();
    await send(listener, message({ author: { id: USER, bot: true } }));
    await send(listener, message({ guildId: null }));
    const stopping = build({ stopping: true });
    await send(stopping.listener, stopping.message());
    expect(routeOf).not.toHaveBeenCalled();
    expect(stopping.routeOf).not.toHaveBeenCalled();
  });

  it('does nothing in a channel that hosts no game', async () => {
    const { listener, countingSubmit, scrambleSubmit, wordleSubmit, message } = build({
      game: null,
    });
    const incoming = message();
    await send(listener, incoming);
    expect(countingSubmit).not.toHaveBeenCalled();
    expect(scrambleSubmit).not.toHaveBeenCalled();
    expect(wordleSubmit).not.toHaveBeenCalled();
    expect(incoming.react).not.toHaveBeenCalled();
    expect(incoming.reply).not.toHaveBeenCalled();
  });

  it('hands the raw message to the game of the channel and to no other', async () => {
    for (const [game, spy] of [
      ['COUNTING', 'countingSubmit'],
      ['SCRAMBLE', 'scrambleSubmit'],
      ['WORDLE', 'wordleSubmit'],
    ] as const) {
      const built = build({ game });
      await send(built.listener, built.message({ content: ' Raw ' }));
      expect(built[spy]).toHaveBeenCalledWith(GUILD, {
        channelId: CHANNEL,
        authorId: USER,
        content: ' Raw ',
      });
      const others = ['countingSubmit', 'scrambleSubmit', 'wordleSubmit'].filter((n) => n !== spy);
      for (const other of others) {
        expect(built[other as 'countingSubmit']).not.toHaveBeenCalled();
      }
    }
  });

  it('stays silent when the game says NOTHING', async () => {
    for (const game of ['COUNTING', 'SCRAMBLE', 'WORDLE'] as const) {
      const { listener, message } = build({ game });
      const incoming = message();
      await send(listener, incoming);
      expect(incoming.react).not.toHaveBeenCalled();
      expect(incoming.reply).not.toHaveBeenCalled();
    }
  });

  it('drops a queued move once shutdown has begun', async () => {
    let stopping = false;
    const countingSubmit = vi.fn(() => {
      stopping = true;
      return Promise.resolve({ status: 'NOTHING' });
    });
    const listener = new MiniGameListener(
      { routeOf: vi.fn().mockResolvedValue('COUNTING') } as unknown as GameChannelService,
      { submit: countingSubmit } as unknown as CountingService,
      {} as unknown as ScrambleService,
      {} as unknown as WordleService,
      { resolve: vi.fn() } as unknown as GuildLocaleService,
      { isStopping: () => stopping } as unknown as DiscordReadyService,
    );
    const { message } = build();
    await Promise.all([send(listener, message()), send(listener, message())]);
    expect(countingSubmit).toHaveBeenCalledTimes(1);
  });

  it('judges the messages of a channel in arrival order, however long each takes', async () => {
    const { listener, countingSubmit, message } = build();
    const order: string[] = [];
    countingSubmit.mockImplementation(async (_guild: string, input: { content: string }) => {
      await new Promise((resolve) => setTimeout(resolve, input.content === '1' ? 20 : 0));
      order.push(input.content);
      return { status: 'NOTHING' };
    });
    await Promise.all(['1', '2', '3'].map((content) => send(listener, message({ content }))));
    expect(order).toEqual(['1', '2', '3']);
  });

  it('gives up on a move stuck past ten seconds and judges the next one', async () => {
    vi.useFakeTimers();
    try {
      const { listener, countingSubmit, message } = build();
      countingSubmit.mockReturnValueOnce(new Promise(() => undefined));
      countingSubmit.mockResolvedValue({ status: 'COUNTED', count: 2 });
      const stuck = send(listener, message({ content: '1' }));
      const stuckSettled = expect(stuck).rejects.toThrow('Judging a game move timed out');
      const next = message({ content: '2' });
      const after = send(listener, next);
      await vi.advanceTimersByTimeAsync(10_000);
      await stuckSettled;
      await after;
      expect(next.react).toHaveBeenCalledWith('✅');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a failure of the service reach the exception filter', async () => {
    const { listener, countingSubmit, message } = build();
    countingSubmit.mockRejectedValue(new Error('db down'));
    const incoming = message();
    await expect(send(listener, incoming)).rejects.toThrow('db down');
    expect(incoming.react).not.toHaveBeenCalled();
  });
});

describe('MiniGameListener: counting', () => {
  it('reacts with a check mark to a counted number and says nothing else', async () => {
    const { listener, message, resolve } = build({
      counting: { status: 'COUNTED', count: 5 },
    });
    const incoming = message();
    await send(listener, incoming);
    expect(incoming.react).toHaveBeenCalledTimes(1);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    expect(incoming.reply).not.toHaveBeenCalled();
    // The common case costs no locale lookup.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('reacts with a cross and replies without a ping to a wrong number', async () => {
    const { listener, message } = build({
      counting: { status: 'WRONG_NUMBER', expected: 6, best: 12 },
    });
    const incoming = message({ content: '9' });
    await send(listener, incoming);
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(incoming.reply).toHaveBeenCalledWith({
      content: EN.counting.wrongNumber.replace('{expected}', '6').replace('{best}', '12'),
      allowedMentions: { parse: [], repliedUser: false },
      failIfNotExists: false,
    });
  });

  it('reacts with a cross and replies to the same player counting twice', async () => {
    const { listener, message } = build({ counting: { status: 'SAME_USER', best: 12 } });
    const incoming = message();
    await send(listener, incoming);
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(incoming.reply).toHaveBeenCalledWith({
      content: EN.counting.sameUser.replace('{best}', '12'),
      allowedMentions: { parse: [], repliedUser: false },
      failIfNotExists: false,
    });
  });

  it('still replies when the reaction fails, and does not throw', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { listener, message } = build({
      counting: { status: 'SAME_USER', best: 1 },
    });
    const incoming = message({ react: vi.fn().mockRejectedValue(new Error('Unknown Message')) });
    await expect(send(listener, incoming)).resolves.toBeUndefined();
    expect(incoming.reply).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('does not throw when the reply fails', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { listener, message } = build({ counting: { status: 'SAME_USER', best: 1 } });
    const incoming = message({ reply: vi.fn().mockRejectedValue(new Error('Missing Access')) });
    await expect(send(listener, incoming)).resolves.toBeUndefined();
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(warn).toHaveBeenCalled();
  });
});

describe('MiniGameListener: scramble', () => {
  const next = {
    game: 'SCRAMBLE' as const,
    answer: 'con mèo',
    letters: 'M / È / O / C / N / O',
    previous: 'học sinh',
  };

  it('reacts with a check mark and posts the win and the next puzzle as embeds', async () => {
    const { listener, message } = build({
      game: 'SCRAMBLE',
      scramble: { status: 'SOLVED', guess: 'học sinh', next },
    });
    const incoming = message({ content: 'học sinh' });
    await send(listener, incoming);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    const reply = incoming.reply.mock.calls[0]?.[0] as {
      embeds: Array<{ description: string }>;
      allowedMentions: unknown;
    };
    expect(reply.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(reply.embeds).toHaveLength(2);
    expect(reply.embeds[0]?.description).toBe(
      EN.scramble.solved.replace('{user}', `<@${USER}>`).replace('{answer}', 'học sinh'),
    );
    expect(reply.embeds[1]?.description).toContain('**M / È / O / C / N / O**');
  });
});

describe('MiniGameListener: scramble wrong guess', () => {
  it('reacts with a cross and does not reply', async () => {
    const { listener, message } = build({ game: 'SCRAMBLE', scramble: { status: 'WRONG' } });
    const incoming = message({ content: 'hoc sinh' });
    await send(listener, incoming);
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(incoming.reply).not.toHaveBeenCalled();
  });
});

describe('MiniGameListener: wordle', () => {
  const guessed: WordleOutcome = { status: 'GUESSED', guesses: ['crane'], answer: 'plumb' };

  it('replies to a guess with the board as an embed, no reaction, no ping', async () => {
    const { listener, message } = build({ game: 'WORDLE', wordle: guessed });
    const incoming = message({ content: 'crane' });
    await send(listener, incoming);
    expect(incoming.react).not.toHaveBeenCalled();
    const reply = incoming.reply.mock.calls[0]?.[0] as {
      embeds: Array<{ description: string; footer: { text: string } }>;
      allowedMentions: unknown;
      content?: string;
    };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.content).toBeUndefined();
    expect(reply.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(reply.embeds[0]?.description).toContain('`CRANE`');
    expect(reply.embeds[0]?.footer.text).toBe(
      EN.wordle.progress.replace('{count}', '1').replace('{max}', '6'),
    );
  });

  it.each([
    ['NOT_IN_LIST', 'notInList'],
    ['SAME_USER', 'sameUser'],
    ['ALREADY_GUESSED', 'alreadyGuessed'],
  ] as const)('reacts with a cross and replies in text for %s', async (status, key) => {
    const { listener, message } = build({ game: 'WORDLE', wordle: { status } });
    const incoming = message({ content: 'crane' });
    await send(listener, incoming);
    expect(incoming.react).toHaveBeenCalledWith('❌');
    expect(incoming.reply).toHaveBeenCalledWith({
      content: EN.wordle[key],
      allowedMentions: { parse: [], repliedUser: false },
      failIfNotExists: false,
    });
  });

  it('reacts with a check mark to a solved board and posts the final board with the new one', async () => {
    const { listener, message } = build({
      game: 'WORDLE',
      wordle: { status: 'SOLVED', guesses: ['crane', 'plumb'], answer: 'plumb' },
    });
    const incoming = message({ content: 'plumb' });
    await send(listener, incoming);
    expect(incoming.react).toHaveBeenCalledWith('✅');
    const reply = incoming.reply.mock.calls[0]?.[0] as {
      embeds: Array<{ description: string }>;
    };
    expect(reply.embeds).toHaveLength(2);
    expect(reply.embeds[0]?.description).toContain(`<@${USER}>`);
    expect(reply.embeds[0]?.description).toContain('PLUMB');
    expect(reply.embeds[1]?.description).toContain('5 letters');
  });

  it('posts a lost board with the answer and the new board, without a reaction', async () => {
    const { listener, message } = build({
      game: 'WORDLE',
      wordle: {
        status: 'LOST',
        guesses: ['crane', 'slate', 'about', 'other', 'fuzzy', 'ghost'],
        answer: 'plumb',
      },
    });
    const incoming = message({ content: 'ghost' });
    await send(listener, incoming);
    expect(incoming.react).not.toHaveBeenCalled();
    const reply = incoming.reply.mock.calls[0]?.[0] as {
      embeds: Array<{ description: string }>;
    };
    expect(reply.embeds).toHaveLength(2);
    expect(reply.embeds[0]?.description).toContain(EN.wordle.lost.replace('{answer}', 'PLUMB'));
  });
});
