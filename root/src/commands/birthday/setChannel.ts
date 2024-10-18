import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from "discord.js";

import { happyBirthday } from "../../ultils";

const commandName = "birthday-channel";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Set channel birthday wishes will be sent to.")
      .addChannelOption((Option) =>
        Option.setName("channel")
          .addChannelTypes(ChannelType.GuildText)
          .addChannelTypes(ChannelType.GuildAnnouncement)
          .addChannelTypes(ChannelType.AnnouncementThread)
          .addChannelTypes(ChannelType.PublicThread)
          .addChannelTypes(ChannelType.PrivateThread)
          .setDescription("The channel you want to set")
          .setRequired(true)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const gid = interaction.guildId;
    const channel = interaction.options.getChannel("channel") as TextChannel;

    if (
      !interaction.guild.members.me.permissions.has([
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ViewChannel,
      ])
    ) {
      interaction.reply({
        content: "Bot cannot send message to this channel!",
        ephemeral: true,
      });
      return;
    }
		
		await happyBirthday.setChannel(`${gid}`, channel.id);
    interaction.reply({ content: `Select channel for birthday: ${channel}` });
  },
};
