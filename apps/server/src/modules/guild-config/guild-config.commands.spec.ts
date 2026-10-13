import 'reflect-metadata';
import { ErrorCode } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { GuildConfigCommands } from './guild-config.commands.js';
import type { GuildConfigService } from './guild-config.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const CHANNEL = '200000000000000001';

function build(locale: 'vi' | 'en' = 'vi') {
  const patch = vi.fn().mockResolvedValue({});
  const resolve = vi.fn().mockResolvedValue(locale);
  const commands = new GuildConfigCommands(
    { patch } as unknown as GuildConfigService,
    { resolve } as unknown as GuildLocaleService,
  );
  const interaction = (guildId: string | null = GUILD) => ({
    guildId,
    locale: 'vi',
    user: { id: USER },
    replied: false,
    deferred: false,
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn(),
    followUp: vi.fn(),
  });
  return { commands, patch, resolve, interaction };
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

    const viReply = viInteraction.reply.mock.calls[0]?.[0] as { content: string; flags?: unknown };
    const enReply = enInteraction.reply.mock.calls[0]?.[0] as { content: string; flags?: unknown };
    expect(viReply.content).toContain(`<#${CHANNEL}>`);
    expect(enReply.content).toContain(`<#${CHANNEL}>`);
    expect(viReply.content).not.toBe(enReply.content);
    expect(viReply.flags).not.toBe(MessageFlags.Ephemeral);
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
  });

  it('refuses outside a server, where there is nothing to configure', async () => {
    const { commands, patch, interaction } = build();
    await expect(commands[handler]([interaction(null)] as never, channel)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(patch).not.toHaveBeenCalled();
  });
});
