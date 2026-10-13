import 'reflect-metadata';
import { ErrorCode, WORD_MAX_WORDS_DEFAULT } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { WordGameCommands } from './word-game.commands.js';
import type { WordGameService } from './word-game.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const CHANNEL = '200000000000000001';

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
  const assertChannelUsable = track('assertChannelUsable', undefined);
  const commands = new WordGameCommands(
    { configure, reset, announceStart } as unknown as WordGameService,
    { assertChannelUsable } as unknown as GuildConfigService,
    { resolve: vi.fn().mockResolvedValue(locale) } as unknown as GuildLocaleService,
  );

  const interaction = (guildId: string | null = GUILD) => {
    const target = {
      guildId,
      locale: 'vi',
      user: { id: USER },
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockImplementation(() => {
        calls.push('deferReply');
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockImplementation(() => {
        calls.push('editReply');
        return Promise.resolve();
      }),
      deleteReply: vi.fn().mockImplementation(() => {
        calls.push('deleteReply');
        return Promise.resolve();
      }),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { commands, configure, reset, announceStart, assertChannelUsable, interaction, calls };
}

const channel = { id: CHANNEL };

describe('/word set', () => {
  it('checks the channel, defers, saves, posts the opening message, then confirms', async () => {
    const { commands, calls, interaction } = build();
    await commands.onSet([interaction()] as never, { channel, maxWords: 400 });
    expect(calls).toEqual([
      'assertChannelUsable',
      'deferReply',
      'configure',
      'announceStart',
      'editReply',
    ]);
  });

  it('saves the channel and the limit as the person who ran the command', async () => {
    const { commands, configure, assertChannelUsable, announceStart, interaction } = build();
    await commands.onSet([interaction()] as never, { channel, maxWords: 400 });
    expect(assertChannelUsable).toHaveBeenCalledWith('wordChannelId', CHANNEL);
    expect(configure).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, maxWords: 400 },
      { source: 'DISCORD', userId: USER },
    );
    expect(announceStart).toHaveBeenCalledWith(GUILD, CHANNEL);
  });

  it('uses the default limit when none is given', async () => {
    const { commands, configure, interaction } = build();
    await commands.onSet([interaction()] as never, { channel });
    expect(configure).toHaveBeenCalledWith(
      GUILD,
      { channelId: CHANNEL, maxWords: WORD_MAX_WORDS_DEFAULT },
      expect.anything(),
    );
  });

  it('confirms publicly, in the language of the server, naming the channel', async () => {
    const vi_ = build('vi');
    const viTarget = vi_.interaction();
    await vi_.commands.onSet([viTarget] as never, { channel });
    const en = build('en');
    const enTarget = en.interaction();
    await en.commands.onSet([enTarget] as never, { channel });

    const viReply = viTarget.editReply.mock.calls[0]?.[0] as { content: string };
    const enReply = enTarget.editReply.mock.calls[0]?.[0] as { content: string };
    expect(viReply.content).toBe(`Đã chọn phòng chơi: <#${CHANNEL}>`);
    expect(enReply.content).toContain(`<#${CHANNEL}>`);
    expect(enReply.content).not.toBe(viReply.content);
    expect(viTarget.deferReply).toHaveBeenCalledWith();
  });

  it('refuses an unusable channel before deferring, so the exception filter can answer privately', async () => {
    const { commands, assertChannelUsable, configure, interaction } = build();
    const refusal = new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
    assertChannelUsable.mockRejectedValueOnce(refusal);
    const target = interaction();
    await expect(commands.onSet([target] as never, { channel })).rejects.toBe(refusal);
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(configure).not.toHaveBeenCalled();
  });

  it('does not confirm a game it could not start', async () => {
    const { commands, announceStart, interaction } = build();
    const failure = new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    announceStart.mockRejectedValueOnce(failure);
    const target = interaction();
    await expect(commands.onSet([target] as never, { channel })).rejects.toBe(failure);
    expect(target.editReply).not.toHaveBeenCalled();
  });

  it('refuses outside a server, where there is no game to set up', async () => {
    const { commands, configure, interaction } = build();
    await expect(commands.onSet([interaction(null)] as never, { channel })).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(configure).not.toHaveBeenCalled();
  });
});

describe('/word reset', () => {
  it('resets, posts the opening message in the game channel, then confirms publicly', async () => {
    const { commands, reset, announceStart, calls, interaction } = build();
    const target = interaction();
    await commands.onReset([target] as never);
    expect(reset).toHaveBeenCalledWith(GUILD, { source: 'DISCORD', userId: USER });
    expect(announceStart).toHaveBeenCalledWith(GUILD, CHANNEL);
    expect(calls).toEqual(['deferReply', 'reset', 'announceStart', 'editReply']);
    const reply = target.editReply.mock.calls[0]?.[0] as { content: string };
    expect(reply.content).toBe(`Đã chọn phòng chơi: <#${CHANNEL}>`);
    expect(target.deleteReply).not.toHaveBeenCalled();
  });

  it('tells privately that no game channel is chosen, and posts nothing', async () => {
    const { commands, reset, announceStart, interaction } = build();
    reset.mockResolvedValueOnce({
      status: 'NOT_CONFIGURED',
      channelId: null,
      clearedWords: 0,
      sample: [],
      dryRun: false,
    });
    const target = interaction();
    await commands.onReset([target] as never);
    expect(target.deleteReply).toHaveBeenCalledTimes(1);
    expect(target.followUp).toHaveBeenCalledWith({
      content: 'Chưa chọn phòng chơi!',
      flags: MessageFlags.Ephemeral,
    });
    expect(announceStart).not.toHaveBeenCalled();
    expect(target.editReply).not.toHaveBeenCalled();
  });

  it('refuses outside a server', async () => {
    const { commands, reset, interaction } = build();
    await expect(commands.onReset([interaction(null)] as never)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(reset).not.toHaveBeenCalled();
  });
});
