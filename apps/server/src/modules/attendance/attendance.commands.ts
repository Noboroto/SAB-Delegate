import { ErrorCode, type AttendanceMember } from '@sab/shared';
import { ChannelType } from 'discord.js';
import { ChannelOption, Context, RoleOption, SlashCommand, type SlashCommandContext } from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { rootCommandMeta } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { userMentionsIn } from '../../discord/helpers/allowed-mentions.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { AttendanceService } from './attendance.service.js';

const roleText = localizations('attendance.commands.roleOption.description');
const voiceText = localizations('attendance.commands.voiceChannelOption.description');

export class AttendanceOptions {
  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: true,
  })
  readonly role!: { readonly id: string };

  /** Left out, the voice channel the person is in is checked. */
  @ChannelOption({
    name: 'voice-channel',
    description: voiceText['en-US'],
    description_localizations: voiceText,
    channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
    required: false,
  })
  // discord.js answers null for an option the person left out.
  readonly voiceChannel?: { readonly id: string } | null;
}

/**
 * `/attendance-by-role`. Who may run it is decided by Discord; nothing is
 * checked here. The answer is public: the list is for the room.
 */
@DiscordCommands()
export class AttendanceCommands {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly locales: GuildLocaleService,
  ) {}

  @SlashCommand(rootCommandMeta('attendance-by-role'))
  async onCheck(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role, voiceChannel }: AttendanceOptions,
  ): Promise<void> {
    // The command is registered for servers only; this guards the type and a stale registration.
    const guildId = interaction.guildId;
    if (guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);

    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    // The cache holds voice states (the voice intent is on), so no call is needed to find the person.
    const voiceChannelId =
      voiceChannel?.id ?? interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channelId;
    if (voiceChannelId === undefined || voiceChannelId === null) {
      await replyInChunks(interaction, t('attendance.noVoiceChannel'), { ephemeral: true });
      return;
    }

    // Reading every member outlasts the 3 s window for a first reply.
    await interaction.deferReply();
    const result = await this.attendance.checkByRole(guildId, {
      roleId: role.id,
      voiceChannelId,
    });

    const absentIds = new Set(result.absent.map((member) => member.userId));
    const none = t('attendance.none');
    const listed = (members: readonly AttendanceMember[], line: (m: AttendanceMember) => string) =>
      members.length === 0 ? none : members.map(line).join('\n');
    await replyInChunks(
      interaction,
      t('attendance.report', {
        channel: `<#${result.voiceChannelId}>`,
        role: result.roleName,
        total: result.total,
        present: result.present.length,
        absent: result.absent.length,
        // Present people by name and absent ones as mentions, as before: the
        // mention is what makes the absent ones easy to find and call.
        presentList: listed(result.present, (member) => `@${member.username}`),
        absentList: listed(result.absent, (member) => `<@${member.userId}>`),
      }),
      {
        // The absent are mentioned to be called; each message pings the absent
        // members it names and nothing else (the role name is plain text).
        allowedMentions: (chunk) => userMentionsIn(chunk, absentIds),
      },
    );
  }
}
