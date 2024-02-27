import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Role,
  ChannelType,
  VoiceChannel,
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("attendance-by-role")
    .setDescription("attendance check for many members by role")
    .addRoleOption((Option) =>
      Option.setName("role")
        .setDescription("Role you want to check")
        .setRequired(true)
    )
    .addChannelOption((Option) =>
      Option.setName("voice-channel")
        .addChannelTypes(ChannelType.GuildVoice)
        .addChannelTypes(ChannelType.GuildStageVoice)
        .setDescription("Voice channel you want to check")
        .setRequired(true)
    )

    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    //const guild = interaction.client.guilds.cache.get('Guild ID');
		await interaction.deferReply();
    const role = interaction.options.getRole("role") as Role;
    const voiceChannel = (await (
      interaction.options.getChannel("voice-channel") as VoiceChannel
    ).fetch()) as VoiceChannel;

    const members = role.members;
    const channelMembers = voiceChannel.members.map((member) => member.id);

    const absent = members.filter(
      (member) => channelMembers.find((id) => id === member.id) === undefined
    );
    const present = members.filter(
      (member) => channelMembers.find((id) => id === member.id) !== undefined
    );

    const message = {
      content: `Channel ${voiceChannel}, role **@${role.name}** has **${
        members.size
      }** members\n**${present.size}** members are present\n**${
        absent.size
      }** members are absent\n\n**Present Members**\n${present
        .map((member) => `@${member.user.username}`)
        .join("\n")}\n\n**Absent Members**\n${absent
        .map((member) => `${member.user}`)
        .join("\n")}`,
      ephemeral: false,
    };

    interaction.editReply(message);
  },
};
