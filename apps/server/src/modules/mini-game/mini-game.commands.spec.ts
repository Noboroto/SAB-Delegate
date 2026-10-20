import 'reflect-metadata';
import { ErrorCode, WORD_MAX_WORDS_DEFAULT } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { GameChannelService } from '../game-core/game-channel.service.js';
import type { WordGameService } from '../word-game/word-game.service.js';
import { GameCommands } from './mini-game.commands.js';
import type { MiniGameService } from './mini-game.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const CHANNEL = '200000000000000001';
const ACTOR = { source: 'DISCORD', userId: USER };

function build(locale: 'vi' | 'en' = 'vi') {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) =>
    vi.fn().mockImplementation(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  const configure = track('configure', {});
  const reset = track('reset', {
    status: 'RESET',
    channelId: CHANNEL,
    clearedWords: 3,
    sample: [],
    dryRun: false,
  });
  const announceStart = track('announceStart', undefined);
  const channelsSet = track('channels.set', { status: 'SET' });
  const restart = track('games.restart', null);
  const commands = new GameCommands(
    { restart } as unknown as MiniGameService,
    { set: channelsSet } as unknown as GameChannelService,
    { configure, reset, announceStart } as unknown as WordGameService,
    { resolve: vi.fn().mockResolvedValue(locale) } as unknown as GuildLocaleService,
  );

  const interaction = (guildId: string | null = GUILD) => ({
    guildId,
    locale: 'vi',
    user: { id: USER },
    deferReply: vi.fn().mockImplementation(() => {
      calls.push('deferReply');
      return Promise.resolve();
    }),
    editReply: vi.fn().mockImplementation(() => {
      calls.push('editReply');
      return Promise.resolve();
    }),
  });
  return {
    commands,
    configure,
    reset,
    announceStart,
    channelsSet,
    restart,
    interaction,
    calls,
  };
}

const channel = { id: CHANNEL };

describe('/game set game:WORD_CHAIN', () => {
  it('defers privately, saves, posts the opening message, then confirms', async () => {
    const { commands, calls, interaction } = build();
    const target = interaction();
    await commands.onSet([target] as never, { game: 'WORD_CHAIN', channel, maxWords: 400 });
    expect(calls).toEqual(['deferReply', 'configure', 'announceStart', 'editReply']);
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('saves the channel and the max-words limit as the person who ran the command', async () => {
    const { commands, configure, announceStart, channelsSet, interaction } = build();
    await commands.onSet([interaction()] as never, {
      game: 'WORD_CHAIN',
      channel,
      maxWords: 400,
    });
    expect(configure).toHaveBeenCalledWith(GUILD, { channelId: CHANNEL, maxWords: 400 }, ACTOR);
    expect(announceStart).toHaveBeenCalledWith(GUILD, CHANNEL);
    expect(channelsSet).not.toHaveBeenCalled();
  });

  it('uses the default limit when max-words is not given', async () => {
    const { commands, configure, interaction } = build();
    await commands.onSet([interaction()] as never, { game: 'WORD_CHAIN', channel });
    expect(configure).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, maxWords: WORD_MAX_WORDS_DEFAULT },
      expect.anything(),
    );
  });

  it('confirms in the language of the server, naming the channel', async () => {
    const vi_ = build('vi');
    const viTarget = vi_.interaction();
    await vi_.commands.onSet([viTarget] as never, { game: 'WORD_CHAIN', channel });
    const en = build('en');
    const enTarget = en.interaction();
    await en.commands.onSet([enTarget] as never, { game: 'WORD_CHAIN', channel });

    const viReply = viTarget.editReply.mock.calls[0]?.[0] as string;
    const enReply = enTarget.editReply.mock.calls[0]?.[0] as string;
    expect(viReply).toBe(`Đã chọn phòng chơi: <#${CHANNEL}>`);
    expect(enReply).toContain(`<#${CHANNEL}>`);
    expect(enReply).not.toBe(viReply);
  });

  it('posts nothing and does not confirm when the channel is refused', async () => {
    const { commands, configure, announceStart, interaction } = build();
    const refusal = new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    configure.mockRejectedValueOnce(refusal);
    const target = interaction();
    await expect(commands.onSet([target] as never, { game: 'WORD_CHAIN', channel })).rejects.toBe(
      refusal,
    );
    expect(announceStart).not.toHaveBeenCalled();
    expect(target.editReply).not.toHaveBeenCalled();
  });

  it('does not confirm a game it could not start', async () => {
    const { commands, announceStart, interaction } = build();
    const failure = new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    announceStart.mockRejectedValueOnce(failure);
    const target = interaction();
    await expect(commands.onSet([target] as never, { game: 'WORD_CHAIN', channel })).rejects.toBe(
      failure,
    );
    expect(target.editReply).not.toHaveBeenCalled();
  });

  it('refuses outside a server, where there is no game to set up', async () => {
    const { commands, configure, interaction } = build();
    await expect(
      commands.onSet([interaction(null)] as never, { game: 'WORD_CHAIN', channel }),
    ).rejects.toMatchObject({ code: ErrorCode.GUILD_NOT_FOUND });
    expect(configure).not.toHaveBeenCalled();
  });
});

describe('/game set for the other games', () => {
  it('ignores max-words and leaves the word chain alone', async () => {
    const { commands, configure, channelsSet, interaction } = build();
    await commands.onSet([interaction()] as never, { game: 'COUNTING', channel, maxWords: 400 });
    expect(channelsSet).toHaveBeenCalledWith(GUILD, 'COUNTING', CHANNEL, ACTOR);
    expect(configure).not.toHaveBeenCalled();
  });

  it('refuses a game that is not offered', async () => {
    const { commands, interaction } = build();
    await expect(
      commands.onSet([interaction()] as never, { game: 'CHESS', channel }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('/game reset game:WORD_CHAIN', () => {
  it('resets, posts the opening message in the game channel, then confirms privately', async () => {
    const { commands, reset, announceStart, calls, interaction } = build();
    const target = interaction();
    await commands.onReset([target] as never, { game: 'WORD_CHAIN' });
    expect(reset).toHaveBeenCalledWith(GUILD, ACTOR);
    expect(announceStart).toHaveBeenCalledWith(GUILD, CHANNEL);
    expect(calls).toEqual(['deferReply', 'reset', 'announceStart', 'editReply']);
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(target.editReply.mock.calls[0]?.[0]).toBe(`Đã chọn phòng chơi: <#${CHANNEL}>`);
  });

  it('tells that no game channel is chosen, and posts nothing', async () => {
    const { commands, reset, announceStart, interaction } = build();
    reset.mockResolvedValueOnce({
      status: 'NOT_CONFIGURED',
      channelId: null,
      clearedWords: 0,
      sample: [],
      dryRun: false,
    });
    const target = interaction();
    await commands.onReset([target] as never, { game: 'WORD_CHAIN' });
    expect(target.editReply).toHaveBeenCalledWith('Chưa chọn phòng chơi!');
    expect(announceStart).not.toHaveBeenCalled();
  });

  it('refuses outside a server', async () => {
    const { commands, reset, interaction } = build();
    await expect(
      commands.onReset([interaction(null)] as never, { game: 'WORD_CHAIN' }),
    ).rejects.toMatchObject({ code: ErrorCode.GUILD_NOT_FOUND });
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('/game reset for the other games', () => {
  it('restarts the game and leaves the word chain alone', async () => {
    const { commands, reset, restart, interaction } = build();
    await commands.onReset([interaction()] as never, { game: 'WORDLE' });
    expect(restart).toHaveBeenCalledWith(GUILD, 'WORDLE', ACTOR, 'reset');
    expect(reset).not.toHaveBeenCalled();
  });
});
