import {
  ChannelType,
  SlashCommandSubcommandBuilder,
  TextChannel,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { configManager } from "../../ultils";

const commandName = "log-channel";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "Set the log channel for the bot to log messages and events"
      )
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
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ])
    ) {
      interaction.reply({
        content: "Bot cannot view message in this channel!",
        ephemeral: true,
      });
      return;
    }
    await configManager.setLogChannelId(gid, channel.id);
    interaction.reply({ content: `Introduction channel is: ${channel}` });
  },
};
