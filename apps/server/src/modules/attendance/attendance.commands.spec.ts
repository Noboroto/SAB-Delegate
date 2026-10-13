import 'reflect-metadata';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { AttendanceCommands } from './attendance.commands.js';
import type { AttendanceService } from './attendance.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const ROLE = { id: '200000000000000001' };
const VOICE = '300000000000000001';
const OWN_VOICE = '300000000000000002';

function build(locale: 'vi' | 'en' = 'en') {
  const attendance = {
    checkByRole: vi.fn().mockResolvedValue({
      roleId: ROLE.id,
      roleName: 'Mentors',
      voiceChannelId: VOICE,
      total: 2,
      present: [{ userId: '400000000000000001', username: 'an' }],
      absent: [{ userId: '400000000000000002', username: 'binh' }],
    }),
  };
  const locales = { resolve: vi.fn().mockResolvedValue(locale) };
  const commands = new AttendanceCommands(
    attendance as unknown as AttendanceService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = (inVoice: string | null = OWN_VOICE, guildId: string | null = GUILD) => {
    const target = {
      guildId,
      locale: 'en',
      user: { id: USER },
      guild: { voiceStates: { cache: new Map(inVoice ? [[USER, { channelId: inVoice }]] : []) } },
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { commands, attendance, interaction };
}

const textOf = (mock: { mock: { calls: unknown[][] } }) =>
  (mock.mock.calls[0]?.[0] as { content: string }).content;

describe('/attendance-by-role', () => {
  it('checks the channel that was chosen, even when the caller is in another', async () => {
    const { commands, attendance, interaction } = build();
    const target = interaction();
    await commands.onCheck([target] as never, { role: ROLE, voiceChannel: { id: VOICE } });
    expect(attendance.checkByRole).toHaveBeenCalledWith(GUILD, {
      roleId: ROLE.id,
      voiceChannelId: VOICE,
    });
  });

  it('defaults to the voice channel the caller is in', async () => {
    const { commands, attendance, interaction } = build();
    await commands.onCheck([interaction()] as never, { role: ROLE, voiceChannel: null });
    expect(attendance.checkByRole).toHaveBeenCalledWith(GUILD, {
      roleId: ROLE.id,
      voiceChannelId: OWN_VOICE,
    });
  });

  it('asks privately for a channel when the caller is in none and named none', async () => {
    const { commands, attendance, interaction } = build();
    const target = interaction(null);
    await commands.onCheck([target] as never, { role: ROLE });
    expect(attendance.checkByRole).not.toHaveBeenCalled();
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledWith({
      content: MESSAGES.en.attendance.noVoiceChannel,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('lists the present by name and the absent as mentions, publicly', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onCheck([target] as never, { role: ROLE, voiceChannel: { id: VOICE } });
    expect(target.deferReply).toHaveBeenCalledWith();
    const content = textOf(target.editReply);
    expect(content).toContain(`<#${VOICE}>`);
    expect(content).toContain('**@Mentors**');
    expect(content).toContain('@an');
    expect(content).toContain('<@400000000000000002>');
    expect(content).not.toContain('<@400000000000000001>');
  });

  it('says "(none)" for an empty side instead of leaving a blank', async () => {
    const { commands, attendance, interaction } = build();
    attendance.checkByRole.mockResolvedValueOnce({
      roleId: ROLE.id,
      roleName: 'Mentors',
      voiceChannelId: VOICE,
      total: 0,
      present: [],
      absent: [],
    });
    const target = interaction();
    await commands.onCheck([target] as never, { role: ROLE, voiceChannel: { id: VOICE } });
    expect(textOf(target.editReply).split(MESSAGES.en.attendance.none)).toHaveLength(3);
  });

  it('splits a long roll into messages of at most 2000 characters', async () => {
    const { commands, attendance, interaction } = build();
    const absent = Array.from({ length: 300 }, (_, index) => ({
      userId: `4${String(index).padStart(17, '0')}`,
      username: `member${index}`,
    }));
    attendance.checkByRole.mockResolvedValueOnce({
      roleId: ROLE.id,
      roleName: 'Mentors',
      voiceChannelId: VOICE,
      total: absent.length,
      present: [],
      absent,
    });
    const target = interaction();
    await commands.onCheck([target] as never, { role: ROLE, voiceChannel: { id: VOICE } });
    const pieces = [
      textOf(target.editReply),
      ...target.followUp.mock.calls.map((call) => (call[0] as { content: string }).content),
    ];
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(2000);
  });

  it('has no server to check when run in a direct message', async () => {
    const { commands, interaction } = build();
    await expect(
      commands.onCheck([interaction(OWN_VOICE, null)] as never, { role: ROLE }),
    ).rejects.toEqual(
      expect.objectContaining({ name: 'ServiceError', code: ErrorCode.GUILD_NOT_FOUND }),
    );
  });
});
