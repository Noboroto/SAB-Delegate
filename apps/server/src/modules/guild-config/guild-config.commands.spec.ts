import 'reflect-metadata';
import { ErrorCode } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { GuildConfigCommands } from './guild-config.commands.js';
import type { GuildConfigService } from './guild-config.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const CHANNEL = '200000000000000001';

function build(locale: 'vi' | 'en' = 'vi') {
  const calls: string[] = [];
  const assertChannelUsable = vi.fn().mockImplementation(() => {
    calls.push('assertChannelUsable');
    return Promise.resolve();
  });
  const patch = vi.fn().mockImplementation(() => {
    calls.push('patch');
    return Promise.resolve({});
  });
  const resolve = vi.fn().mockResolvedValue(locale);
  const commands = new GuildConfigCommands(
    { patch, assertChannelUsable } as unknown as GuildConfigService,
    { resolve } as unknown as GuildLocaleService,
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
      followUp: vi.fn(),
    };
    return target;
  };
  return { commands, patch, assertChannelUsable, resolve, interaction, calls };
}

const channel = { channel: { id: CHANNEL } };

describe.each([
  ['onIntroChannel', 'introChannelId'],
  ['onLogChannel', 'logChannelId'],
  ['onBirthdayChannel', 'birthdayChannelId'],
] as const)('GuildConfigCommands.%s', (handler, field) => {
  it('sets the channel as the person who ran the command', async () => {
    const { commands, patch, interaction } = build();
    await commands[handler]([interaction()] as never, channel);
    expect(patch).toHaveBeenCalledWith(
      GUILD,
      { [field]: CHANNEL },
      { source: 'DISCORD', userId: USER },
    );
  });

  it('confirms in the server language, publicly, naming the channel', async () => {
    const vi_ = build('vi');
    const viInteraction = vi_.interaction();
    await vi_.commands[handler]([viInteraction] as never, channel);
    const en = build('en');
    const enInteraction = en.interaction();
    await en.commands[handler]([enInteraction] as never, channel);

    const viReply = viInteraction.editReply.mock.calls[0]?.[0] as { content: string };
    const enReply = enInteraction.editReply.mock.calls[0]?.[0] as { content: string };
    expect(viReply.content).toContain(`<#${CHANNEL}>`);
    expect(enReply.content).toContain(`<#${CHANNEL}>`);
    expect(viReply.content).not.toBe(enReply.content);
    // Public: the deferral carries no ephemeral flag, and the confirmation edits it in place.
    expect(viInteraction.deferReply).toHaveBeenCalledWith();
    expect(viInteraction.reply).not.toHaveBeenCalled();
  });

  it('checks the channel, then defers, then writes, then answers', async () => {
    const { commands, calls, assertChannelUsable, interaction } = build();
    await commands[handler]([interaction()] as never, channel);
    expect(calls).toEqual(['assertChannelUsable', 'deferReply', 'patch', 'editReply']);
    expect(assertChannelUsable).toHaveBeenCalledWith(field, CHANNEL);
  });

  it('refuses an unusable channel before deferring, so the exception filter can answer privately', async () => {
    const { commands, assertChannelUsable, patch, interaction } = build();
    const refusal = new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, {
      permission: 'send',
    });
    assertChannelUsable.mockRejectedValueOnce(refusal);
    const target = interaction();
    await expect(commands[handler]([target] as never, channel)).rejects.toBe(refusal);
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(target.reply).not.toHaveBeenCalled();
    expect(target.deferred).toBe(false);
  });

  it('does not confirm a change the service refused', async () => {
    const { commands, patch, interaction } = build();
    const refusal = Object.assign(new Error('no access'), {
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
    patch.mockRejectedValueOnce(refusal);
    const target = interaction();
    await expect(commands[handler]([target] as never, channel)).rejects.toBe(refusal);
    expect(target.reply).not.toHaveBeenCalled();
    expect(target.editReply).not.toHaveBeenCalled();
  });

  it('refuses outside a server, where there is nothing to configure', async () => {
    const { commands, patch, interaction } = build();
    await expect(commands[handler]([interaction(null)] as never, channel)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(patch).not.toHaveBeenCalled();
  });
});
