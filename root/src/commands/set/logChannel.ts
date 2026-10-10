import {
  ChannelType,
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { configManager } from "../../ultils";
import { botLacksChannelAccess } from "../_shared/botChannelAccess";

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
    const channel = interaction.options.getChannel("channel", true);

    if (await botLacksChannelAccess(interaction, channel.id, "send")) {
      await interaction.reply({
        content: "Bot cannot send message to this channel!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await configManager.setLogChannelId(gid, channel.id);
    await interaction.reply({ content: `Log channel is: ${channel}` });
  },
};
