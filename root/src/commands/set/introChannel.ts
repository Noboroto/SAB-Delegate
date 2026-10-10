import {
  ChannelType,
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { configManager } from "../../ultils";
import { botLacksChannelAccess } from "../_shared/botChannelAccess";

const commandName = "intro-channel";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "Set the introduction channel for the bot to get introductions from"
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

    if (await botLacksChannelAccess(interaction, channel.id, "read")) {
      await interaction.reply({
        content: "Bot cannot view message in this channel!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await configManager.setIntroChannelId(gid, channel.id);
    await interaction.reply({ content: `Introduction channel is: ${channel}` });
  },
};
