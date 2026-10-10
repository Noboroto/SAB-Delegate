import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Role,
  ChannelType,
  VoiceChannel,
  InteractionContextType,
} from "discord.js";
import { replyInChunks } from "./_shared/chunkedReply";

export default {
  data: new SlashCommandBuilder()
    .setName("attendance-by-role")
    .setContexts(InteractionContextType.Guild)
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
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    //const guild = interaction.client.guilds.cache.get('Guild ID');
    await interaction.deferReply();
    const role = interaction.options.getRole("role") as Role;
    const voiceChannel = (await (
      interaction.options.getChannel("voice-channel") as VoiceChannel
    ).fetch()) as VoiceChannel;

    // role.members only reflects the cache; the full list needs a fetch.
    await interaction.guild.members.fetch();
    const members = role.members;
    const channelMembers = voiceChannel.members.map((member) => member.id);

    const absent = members.filter(
      (member) => channelMembers.find((id) => id === member.id) === undefined
    );
    const present = members.filter(
      (member) => channelMembers.find((id) => id === member.id) !== undefined
    );

    const content = `Channel ${voiceChannel}, role **@${role.name}** has **${
      members.size
    }** members\n**${present.size}** members are present\n**${
      absent.size
    }** members are absent\n\n**Present Members**\n${present
      .map((member) => `@${member.user.username}`)
      .join("\n")}\n\n**Absent Members**\n${absent
      .map((member) => `${member.user}`)
      .join("\n")}`;

    await replyInChunks(interaction, content);
  },
};
